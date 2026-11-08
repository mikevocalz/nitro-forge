//! Glyph rasterization for `renderPage` (decision
//! `docs/completion/reports/P-quill-renderpage-decision.md`, slice R1).
//!
//! Pipeline, all in-memory and deterministic:
//!
//! 1. `FaceMeasure::shape_line_glyphs` shapes each emitted layout line
//!    independently (same harfrust call `layout`'s per-line passes use),
//!    keeping glyph ids and `x_advance`/`x_offset`/`y_offset` in font
//!    units. Shape failure falls back to `unshaped_line_glyphs`
//!    (cmap + hmtx, zero offsets) — same fallback class `layout` uses.
//! 2. `skrifa`'s outline API (`Font::outline_glyphs()` →
//!    `model::glyph::outline::OutlineGlyph::draw`) emits `move`/`line`/
//!    `quad`/`curve`/`close` verbs through `PathSink`, which map 1:1 onto
//!    `tiny_skia::PathBuilder` (`curve_to` → `cubic_to`). No conic
//!    conversion, no second font parser — the outlines come from the same
//!    parsed `skrifa::Font` the metrics path holds.
//! 3. `tiny-skia` fills each glyph path into one RGBA `Pixmap` with
//!    anti-aliased winding fills. Glyph y is flipped (font y-up → pixmap
//!    y-down) by the draw transform; x advances accumulate in pixels.
//!
//! R2: each emitted line is drawn as its `span ∩ run` pieces from
//! `runs::resolve_block_runs` — the same per-run face/size resolution
//! `layout_pages` measured — at real `hhea`/`OS/2` line metrics where
//! the face exposes them (`LINE_SPACING` em-box fallback otherwise), with
//! the baseline at the line's max run ascender. `y_advance` is still
//! dropped (horizontal text) exactly as the advance-folding path drops
//! it. NOT modeled (per the decision doc's deferral list): per-run
//! `color`/`highlight`/`underline`/`strike`, synthetic bold/italic,
//! hinting, subpixel positioning, bitmap/color strikes, vertical text,
//! images, decorations, headers/footers and TOC page numbers (R2
//! remainder/R3).
//!
//! Safety budget: `layout`'s shaped path is gated by
//! `fonts::MAX_SHAPED_CHARS_PER_BLOCK` — over-budget blocks are measured
//! with unshaped `cmap`+`hmtx` advances. `renderPage` applies the SAME
//! gate ([`fonts::shaping_budget_allows`]) so drawn glyph positions
//! always match the spans `layout` reported; shaping an over-budget
//! line would also be the hostile-input hole the cap exists to close
//! (one harfrust call per emitted line, unbounded line length). Within
//! budget, total shaping per block is bounded by the block's char count
//! since emitted lines partition the block text.
//!
//! Cancellation: `TaskContext::checkpoint` runs once per
//! `CHECKPOINT_STRIDE` emitted lines AND once per `GLYPH_CHECKPOINT_STRIDE`
//! drawn glyphs, so `apply_long` can cancel mid-line. Residual: a single
//! `shape_line_glyphs` harfrust call is atomic — a pathological line up
//! to the 131072-char block cap cannot be interrupted mid-shape, but the
//! cap bounds that worst case.

use crate::fonts::PositionedGlyph;
use crate::runs::{resolve_block_runs, BlockRuns, FontPlan};
use crate::sections::{format_page_number, HeaderFooter, Section};
use crate::{block_line_spans, Block, BlockKind, Inline, Style, SectionPage};
use ignition_core::{EngineError, TaskContext};
use std::panic::{catch_unwind, AssertUnwindSafe};
use tiny_skia::{Color, FillRule, Paint, Pixmap, Transform};

/// Decision-doc hard bounds for `renderPage` output: ≤4096 px per side
/// and ≤32 MiB of decoded RGBA (8,388,608 px).
pub const MAX_RENDER_DIM_PX: u32 = 4096;
pub const MAX_RENDER_PIXELS: u64 = 32 * 1024 * 1024 / 4;

/// `PathSink` → `tiny_skia::PathBuilder`. The verbs map 1:1 per the
/// decision doc: `move_to`/`line_to`/`quad_to` pass through,
/// `curve_to` becomes `cubic_to`, `close` closes the contour.
struct PathPen {
    builder: tiny_skia::PathBuilder,
}

impl skrifa::PathSink for PathPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.builder.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.builder.line_to(x, y);
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.builder.quad_to(cx0, cy0, x, y);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.builder.cubic_to(cx0, cy0, cx1, cy1, x, y);
    }
    fn close(&mut self) {
        self.builder.close();
    }
}

/// Draw one glyph outline at `ppem` pixels-per-em into a tiny-skia path
/// in *font pixel space* (origin at the glyph's pen position, y-up).
/// `None` when the glyph id has no outline or the draw fails — the caller
/// skips it, matching the metrics path's `.notdef`-only honesty.
fn glyph_path(font: &skrifa::Font, glyph_id: u32, ppem: f32) -> Option<tiny_skia::Path> {
    // Hostile-input guard, same class as the parse/shape guards: a
    // corrupt-but-parseable font must not panic the session mid-render.
    catch_unwind(AssertUnwindSafe(|| {
        let outlines = font.outline_glyphs();
        let glyph = outlines.get(skrifa::GlyphId::new(glyph_id))?;
        let options =
            skrifa::raw::model::glyph::outline::DrawOptions::new().with_ppem(Some(ppem));
        let mut pen = PathPen {
            builder: tiny_skia::PathBuilder::new(),
        };
        glyph
            .draw(&options, skrifa::DrawMemory::Scratch, &mut pen)
            .ok()?;
        pen.builder.finish()
    }))
    .ok()
    .flatten()
}

/// Checkpoint cadence for `renderPage` row bands (decision doc: "row-band
/// checkpoints"). One `TaskContext::checkpoint` per 32 emitted lines keeps
/// cancellation responsive on long documents without measurable cost.
const CHECKPOINT_STRIDE: usize = 32;

/// Intra-line checkpoint cadence: one `TaskContext::checkpoint` per this
/// many drawn glyphs, so a single very long line (up to the
/// `MAX_SHAPED_CHARS_PER_BLOCK` budget) still cancels promptly. Glyph
/// outline+fill is the per-glyph hot loop; 256 keeps overhead negligible.
const GLYPH_CHECKPOINT_STRIDE: usize = 256;

/// Render one page to straight-alpha RGBA8 (`w*h*4` bytes, row-major,
/// top-left origin). `lines` are the page's `(block, start, end)` char
/// spans exactly as `layout` reports them; `blocks` is the document.
///
/// Geometry: layout units are points; `px = pt * dpi/72`. R2: each
/// block's inline runs are resolved through [`resolve_block_runs`] — the
/// SAME resolution `layout_pages` measured — so every `span ∩ run`
/// piece draws with its own face, size, real line height and baseline
/// (`BlockRuns::line_height`/`line_ascent`: `hhea`/`OS/2` metrics where
/// the face exposes them, the `LINE_SPACING` em-box estimate otherwise).
/// Each piece is shaped independently at `size_pt * dpi/72` ppem and
/// drawn from the line's running pen position; the baseline is the
/// line's max run ascender. `y_px` accumulates per-line heights in page
/// order; lines arrive in document order so a running cursor is exact.
///
/// Read-only and deterministic: no journal, no events, no state.
pub fn render_page_rgba(
    plan: &FontPlan,
    font_size: f64,
    blocks: &[Block],
    lines: &[(usize, usize, usize)],
    width_px: u32,
    height_px: u32,
    dpi: f64,
    color: Color,
    background: Color,
    ctx: Option<&TaskContext>,
) -> Result<Vec<u8>, EngineError> {
    let scale = dpi / 72.0;
    let mut pixmap = Pixmap::new(width_px, height_px)
        .ok_or_else(|| EngineError::internal("renderPage pixmap allocation failed"))?;
    pixmap.fill(background);

    // Per-block run resolution, computed lazily on first reference —
    // identical inputs to `layout_pages`' resolution (same blocks,
    // font_size, registry, base face), so heights and advances agree.
    let mut block_runs: Vec<Option<BlockRuns>> = (0..blocks.len()).map(|_| None).collect();

    let paint = Paint {
        shader: tiny_skia::Shader::SolidColor(color),
        anti_alias: true,
        ..Default::default()
    };

    let mut y_px = 0.0f64;
    for (line_index, &(bi, start, end)) in lines.iter().enumerate() {
        if line_index % CHECKPOINT_STRIDE == 0 {
            if let Some(c) = ctx {
                c.checkpoint()?;
            }
        }
        if bi >= blocks.len() {
            // `layout` never emits an out-of-range block index; skip
            // defensively without advancing the cursor — there is no
            // line height to account for.
            continue;
        }
        if block_runs[bi].is_none() {
            block_runs[bi] = Some(resolve_block_runs(&blocks[bi], font_size, plan));
        }
        let br = block_runs[bi].as_ref().expect("resolved above");
        let line_height_px = br.line_height(start, end) * scale;
        // Baseline = line top + the line's max run ascender (real
        // metrics, or the em-box estimate — `runs.rs`).
        let baseline_y = y_px + br.line_ascent(start, end) * scale;
        draw_line_runs(
            &mut pixmap,
            &paint,
            br,
            start,
            end,
            0.0,
            baseline_y,
            scale,
            ctx,
        )?;
        // Every emitted span occupies its line height, drawn or not —
        // `layout` counts (0,0) empty spans the same way.
        y_px += line_height_px;
    }

    if let Some(c) = ctx {
        c.checkpoint()?;
    }

    Ok(pixmap_straight_alpha(&pixmap, background))
}

/// Draw one `(start,end)` char span of `br`'s text as its `span ∩ run`
/// pieces — the same segmentation `layout_pages` shaped for its final
/// measurement pass — starting at pen position `origin_x_px` with the
/// baseline at `baseline_y_px` (both pixels). Shared by
/// [`render_page_rgba`] (origin 0, running `y_px`) and
/// [`render_page_rgba_sectioned`] (margin/column origins).
fn draw_line_runs(
    pixmap: &mut Pixmap,
    paint: &Paint,
    br: &BlockRuns,
    start: usize,
    end: usize,
    origin_x_px: f64,
    baseline_y_px: f64,
    scale: f64,
    ctx: Option<&TaskContext>,
) -> Result<(), EngineError> {
    let n = br.byte_offsets.len();
    if start >= end || start >= n {
        return Ok(());
    }
    // The same `span ∩ run` pieces `layout_pages` shaped for its
    // final measurement pass — drawing them in order keeps pen
    // positions identical to the measured advances.
    let pieces = br.span_pieces(&[(start, end)]);
    let mut pen_x = origin_x_px;
    let mut since_checkpoint = 0usize;
    for (ri, s, e) in pieces {
        let run = &br.runs[ri];
        let byte_s = br.byte_offsets[s];
        let byte_e = if e == n { br.text.len() } else { br.byte_offsets[e] };
        let seg = &br.text[byte_s..byte_e];
        let font = run.measure.skrifa_font();
        let ppem = (run.size_pt * scale) as f32;
        let unit = ppem as f64 / run.measure.units_per_em(); // font units → px
        // Same shaping gate `layout` applies per block: over-budget
        // blocks draw with the unshaped advances layout measured.
        let glyphs = if br.may_shape {
            run.measure
                .shape_line_glyphs(seg)
                .unwrap_or_else(|| run.measure.unshaped_line_glyphs(seg))
        } else {
            run.measure.unshaped_line_glyphs(seg)
        };
        for g in &glyphs {
            let PositionedGlyph {
                glyph_id,
                x_advance,
                x_offset,
                y_offset,
            } = *g;
            let dx = pen_x + x_offset * unit;
            let dy = baseline_y_px - y_offset * unit;
            if let Some(path) = glyph_path(font, glyph_id, ppem) {
                // Font coords are y-up; flip into pixmap y-down space.
                let ts = Transform::from_row(1.0, 0.0, 0.0, -1.0, dx as f32, dy as f32);
                pixmap.fill_path(&path, paint, FillRule::Winding, ts, None);
            }
            pen_x += x_advance * unit;
            since_checkpoint += 1;
            if since_checkpoint >= GLYPH_CHECKPOINT_STRIDE {
                since_checkpoint = 0;
                if let Some(c) = ctx {
                    c.checkpoint()?;
                }
            }
        }
    }
    Ok(())
}

/// Straight-alpha RGBA8 (`w*h*4`, row-major, top-left origin) out of a
/// premultiplied tiny-skia pixmap. Unpremultiplies manually instead of
/// `Pixmap::take_demultiplied`: premultiplied storage zeroes the RGB
/// channels of fully transparent pixels, so a `#RRGGBB00` background
/// would come back as (0,0,0,0) and lose its hidden color.
/// Straight-alpha output keeps the background's RGB under alpha 0 —
/// the same hidden-RGB honesty `readRasterAsset` gives stored
/// straight-alpha input. Fully transparent output pixels can only
/// exist where the background itself is fully transparent and no glyph
/// coverage landed (any drawn contribution with alpha > 0 raises the
/// pixel's alpha), so the background RGB is the right hidden color for
/// every one of them.
fn pixmap_straight_alpha(pixmap: &Pixmap, background: Color) -> Vec<u8> {
    let bg = [
        (background.red() * 255.0).round() as u8,
        (background.green() * 255.0).round() as u8,
        (background.blue() * 255.0).round() as u8,
    ];
    let mut out = Vec::with_capacity(pixmap.width() as usize * pixmap.height() as usize * 4);
    for px in pixmap.pixels() {
        let c = px.demultiply();
        if c.alpha() == 0 {
            out.extend_from_slice(&[bg[0], bg[1], bg[2], 0]);
        } else {
            out.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
        }
    }
    out
}

/// A plain-text block for header/footer bodies: one `para` block with a
/// single unstyled inline. `resolve_block_runs` then treats it exactly
/// like any other block (base face, `font_size`, real line metrics).
fn hf_text_block(text: &str) -> Block {
    Block {
        kind: BlockKind::Para,
        list: None,
        style_id: None,
        inlines: vec![Inline {
            text: text.to_string(),
            style: Style::default(),
        }],
        table: None,
        toc: None,
        bibliography: None,
        format: None,
    }
}

/// Pick the header (or footer) body for one page under the section's
/// `HeaderFooter` flags. Priority: `different_first` on the section's
/// first OWNED page, then `different_odd_even` on even physical page
/// indices (`index % 2 == 1` — index 0 is printed page 1, i.e. odd).
/// The selected slot is authoritative: a `None` body draws nothing —
/// there is no link-previous inheritance (`link_previous` is a consumer
/// concern, per the section model docs).
fn hf_body<'a>(
    hf: &'a HeaderFooter,
    first_in_section: bool,
    even_index: bool,
    header: bool,
) -> Option<&'a str> {
    let pick = |first: &'a Option<String>, even: &'a Option<String>, normal: &'a Option<String>| {
        if first_in_section && hf.different_first {
            first.as_deref()
        } else if even_index && hf.different_odd_even {
            even.as_deref()
        } else {
            normal.as_deref()
        }
    };
    if header {
        pick(&hf.first_header, &hf.even_header, &hf.header)
    } else {
        pick(&hf.first_footer, &hf.even_footer, &hf.footer)
    }
}

/// Draw one header/footer band (R3): the plain-text body wrapped at the
/// full text width (`page.width - margin_left - margin_right`, columns
/// ignored), plus — header band only — the formatted page number
/// right-aligned on the band's last line when `page_numbers` is set.
/// Header blocks bottom-align to `margin_top` (just above the text
/// area); footer blocks top-align at `height - margin_bottom` (just
/// below it). Bodies taller than their margin overflow toward the page
/// center — deterministic, never rejected.
#[allow(clippy::too_many_arguments)]
fn draw_hf_band(
    pixmap: &mut Pixmap,
    paint: &Paint,
    plan: &FontPlan,
    font_size: f64,
    page: &SectionPage,
    hf: &HeaderFooter,
    body: Option<&str>,
    is_header: bool,
    scale: f64,
    ctx: Option<&TaskContext>,
) -> Result<(), EngineError> {
    let text_w = page.width - page.margin_left - page.margin_right;
    if text_w <= 0.0 {
        return Ok(());
    }
    let mut advance_cache: std::collections::HashMap<(usize, char), f64> =
        std::collections::HashMap::new();

    // Body lines: (char span, height pt) via the SAME wrap/measure
    // routine blocks use — HF text gets real shaping/metrics too.
    let mut lines: Vec<(usize, usize, f64)> = Vec::new();
    let mut body_br: Option<BlockRuns> = None;
    if let Some(text) = body {
        if !text.is_empty() {
            let blk = hf_text_block(text);
            let br = resolve_block_runs(&blk, font_size, plan);
            let (spans, heights) =
                block_line_spans(&blk, text_w, font_size, Some(plan), &mut advance_cache);
            for (i, &(s, e)) in spans.iter().enumerate() {
                lines.push((s, e, heights[i]));
            }
            body_br = Some(br);
        }
    }
    // ^ heights come from block_line_spans; spans index into br.text.

    // Page number (header band only): its own single-line block,
    // measured for right-alignment.
    let number_str = if is_header && hf.page_numbers {
        Some(format_page_number(page.number, hf.number_format))
    } else {
        None
    };
    let mut num_br: Option<BlockRuns> = None;
    let mut num_w_pt = 0.0f64;
    let mut num_h_pt = 0.0f64;
    if let Some(ns) = &number_str {
        let blk = hf_text_block(ns);
        let br = resolve_block_runs(&blk, font_size, plan);
        let n = br.byte_offsets.len();
        num_h_pt = br.line_height(0, n);
        // Width of the unwrapped number: shaped advances when allowed
        // (same gate as everywhere), unshaped fallback otherwise.
        let advances = if br.may_shape {
            br.shaped_advances(&br.initial_pieces())
        } else {
            None
        }
        .unwrap_or_else(|| br.unshaped_advances(&mut advance_cache));
        num_w_pt = advances.iter().sum();
        num_br = Some(br);
    }

    let body_h_pt: f64 = lines.iter().map(|&(_, _, h)| h).sum();
    let total_h_pt = body_h_pt + num_h_pt;
    // Band placement: header bottom-aligns to the top margin's inner
    // edge; footer top-aligns at the bottom margin's outer edge.
    let y_start_pt = if is_header {
        (page.margin_top - total_h_pt).max(0.0)
    } else {
        page.height - page.margin_bottom
    };

    let mut y_pt = y_start_pt;
    let mut hf_lines = 0usize;
    if let Some(br) = &body_br {
        for &(s, e, h) in &lines {
            if hf_lines % CHECKPOINT_STRIDE == 0 {
                if let Some(c) = ctx {
                    c.checkpoint()?;
                }
            }
            hf_lines += 1;
            let baseline_y_px = (y_pt + br.line_ascent(s, e)) * scale;
            draw_line_runs(
                pixmap,
                paint,
                br,
                s,
                e,
                page.margin_left * scale,
                baseline_y_px,
                scale,
                ctx,
            )?;
            y_pt += h;
        }
    }
    if let Some(br) = &num_br {
        let n = br.byte_offsets.len();
        let baseline_y_px = (y_pt + br.line_ascent(0, n)) * scale;
        // Right-align within the text area: right edge is
        // `width - margin_right` in points.
        let right_edge_px = (page.width - page.margin_right) * scale;
        let x_px = (right_edge_px - num_w_pt * scale).max(page.margin_left * scale);
        draw_line_runs(pixmap, paint, br, 0, n, x_px, baseline_y_px, scale, ctx)?;
    }
    Ok(())
}

/// `renderPage {use_sections:true}` rasterizer (R3): the same RGBA8
/// contract as [`render_page_rgba`], but `page` carries its owning
/// section's `PageSetup` geometry — body lines draw inside the margin
/// box, column-major (`column` indexes `column_width`/`column_gap`
/// bands), and the section's header/footer bodies plus optional page
/// number draw in the margin bands. Read-only and deterministic like
/// the uniform path.
#[allow(clippy::too_many_arguments)]
pub fn render_page_rgba_sectioned(
    plan: &FontPlan,
    font_size: f64,
    blocks: &[Block],
    sections: &[Section],
    page: &SectionPage,
    width_px: u32,
    height_px: u32,
    dpi: f64,
    color: Color,
    background: Color,
    ctx: Option<&TaskContext>,
) -> Result<Vec<u8>, EngineError> {
    let scale = dpi / 72.0;
    let mut pixmap = Pixmap::new(width_px, height_px)
        .ok_or_else(|| EngineError::internal("renderPage pixmap allocation failed"))?;
    pixmap.fill(background);

    let mut block_runs: Vec<Option<BlockRuns>> = (0..blocks.len()).map(|_| None).collect();
    let paint = Paint {
        shader: tiny_skia::Shader::SolidColor(color),
        anti_alias: true,
        ..Default::default()
    };

    // Body lines: column-major order, per-column running y cursor
    // (points) starting at the top margin.
    let mut col_y = vec![page.margin_top; page.columns];
    for (line_index, line) in page.lines.iter().enumerate() {
        if line_index % CHECKPOINT_STRIDE == 0 {
            if let Some(c) = ctx {
                c.checkpoint()?;
            }
        }
        let bi = line.block;
        if bi >= blocks.len() || line.column >= page.columns {
            continue;
        }
        if block_runs[bi].is_none() {
            block_runs[bi] = Some(resolve_block_runs(&blocks[bi], font_size, plan));
        }
        let br = block_runs[bi].as_ref().expect("resolved above");
        let col = line.column;
        let line_height_pt = br.line_height(line.start, line.end);
        let baseline_y_px = (col_y[col] + br.line_ascent(line.start, line.end)) * scale;
        let x_px =
            (page.margin_left + col as f64 * (page.column_width + page.column_gap)) * scale;
        draw_line_runs(
            &mut pixmap,
            &paint,
            br,
            line.start,
            line.end,
            x_px,
            baseline_y_px,
            scale,
            ctx,
        )?;
        col_y[col] += line_height_pt;
    }

    // Header/footer bands (R3): body selection honors
    // different_first/different_odd_even on physical page-index parity.
    if let Some(section) = sections.get(page.section) {
        let hf = &section.header_footer;
        let even_index = page.index % 2 == 1;
        let header = hf_body(hf, page.first_in_section, even_index, true);
        let footer = hf_body(hf, page.first_in_section, even_index, false);
        // The header band also carries the page number when
        // `page_numbers` is set, so it draws even with no header body;
        // the footer band only ever shows its body text.
        if header.is_some() || hf.page_numbers {
            draw_hf_band(
                &mut pixmap, &paint, plan, font_size, page, hf, header, true, scale, ctx,
            )?;
        }
        if footer.is_some() {
            draw_hf_band(
                &mut pixmap, &paint, plan, font_size, page, hf, footer, false, scale, ctx,
            )?;
        }
    }

    if let Some(c) = ctx {
        c.checkpoint()?;
    }
    Ok(pixmap_straight_alpha(&pixmap, background))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BlockKind, Inline, Style};

    fn para_block(text: &str) -> Block {
        Block {
            kind: BlockKind::Para,
            list: None,
            style_id: None,
            inlines: vec![Inline {
                text: text.to_string(),
                style: Style::default(),
            }],
            table: None,
            toc: None,
            bibliography: None,
            format: None,
        }
    }

    fn test_registry() -> crate::fonts::FontRegistry {
        let bytes = include_bytes!("../tests/fixtures/nftestmono.ttf");
        let mut reg = crate::fonts::FontRegistry::default();
        reg.register("NFTestMono", 0, bytes.to_vec()).unwrap();
        reg
    }

    fn test_plan<'a>(reg: &'a crate::fonts::FontRegistry) -> FontPlan<'a> {
        FontPlan {
            registry: reg,
            base_face: reg.find("NFTestMono").unwrap().clone(),
        }
    }

    /// Rasterization sanity: the fixture's 'W' glyph produces a real
    /// outline path at render size, and an out-of-range glyph id draws
    /// nothing rather than failing.
    #[test]
    fn glyph_outline_path_and_missing_glyph() {
        let bytes = include_bytes!("../tests/fixtures/nftestmono.ttf");
        let font = skrifa::Font::new(bytes.to_vec(), 0).unwrap();
        let w = font.charmap().map_unicode('W').unwrap();
        let path = glyph_path(&font, w.to_u32(), 12.0).expect("W has an outline");
        // A real glyph path has segments; bounds stay near the em box.
        let bounds = path.bounds();
        assert!(bounds.width() > 0.0 && bounds.height() > 0.0);
        assert!(glyph_path(&font, 65_535, 12.0).is_none());
        // Degenerate sizes still return a path or None, never panic.
        let _ = glyph_path(&font, w.to_u32(), 0.0);
    }

    /// The render shaping gate is the SAME predicate `layout_pages`
    /// applies: boundary values and the per-block `may_shape` flag must
    /// agree, so over-budget blocks can never draw shaped advances that
    /// layout never measured.
    #[test]
    fn shaping_budget_gate_matches_layout() {
        use crate::fonts::{shaping_budget_allows, MAX_SHAPED_CHARS_PER_BLOCK as CAP};
        assert!(shaping_budget_allows(1));
        assert!(shaping_budget_allows(CAP));
        assert!(!shaping_budget_allows(0));
        assert!(!shaping_budget_allows(CAP + 1));

        let reg = test_registry();
        let plan = test_plan(&reg);
        let small = resolve_block_runs(&para_block("hi"), 12.0, &plan);
        assert!(small.may_shape);
        let at_cap = resolve_block_runs(&para_block(&"x".repeat(CAP)), 12.0, &plan);
        assert!(at_cap.may_shape);
        let over = resolve_block_runs(&para_block(&"x".repeat(CAP + 1)), 12.0, &plan);
        assert!(!over.may_shape);
        let empty = resolve_block_runs(&para_block(""), 12.0, &plan);
        assert!(!empty.may_shape);
    }

    /// Over-budget blocks render through `unshaped_line_glyphs` — the
    /// same advances `layout` measured. 'W'+'W' kerns -300 units under
    /// shaping (second W at 700 units) vs 1000 unshaped; at font_size 12
    /// / dpi 96 (ppem 16, upem 1000) that is a 4.8px pen difference, so
    /// the second glyph's ink column distinguishes the two paths.
    #[test]
    fn over_budget_block_draws_unshaped_advances() {
        let reg = test_registry();
        let plan = test_plan(&reg);
        // "WW" + padding past the char budget → may_shape == false.
        let huge_text = format!(
            "WW{}",
            "i".repeat(crate::fonts::MAX_SHAPED_CHARS_PER_BLOCK - 1)
        );
        assert_eq!(
            huge_text.chars().count(),
            crate::fonts::MAX_SHAPED_CHARS_PER_BLOCK + 1
        );
        let huge = vec![para_block(&huge_text)];
        let small = vec![para_block("WW")];
        let ink = |px: &[u8], x: usize, y: usize| px[(y * 40 + x) * 4];
        let args = (
            Color::from_rgba8(0, 0, 0, 255),
            Color::from_rgba8(255, 255, 255, 255),
        );
        // Line span (0,2) covers exactly "WW" in both blocks.
        let huge_px = render_page_rgba(
            &plan, 12.0, &huge, &[(0, 0, 2)], 40, 20, 96.0, args.0, args.1, None,
        )
        .unwrap();
        let small_px = render_page_rgba(
            &plan, 12.0, &small, &[(0, 0, 2)], 40, 20, 96.0, args.0, args.1, None,
        )
        .unwrap();
        assert_ne!(huge_px, small_px, "shaped and unshaped runs must differ");
        // y=10 sits inside the glyph band (R2 baseline = 0.8em ascent =
        // 12.8px at ppem 16; box top ≈1.6px, bottom ≈12.8px).
        // x=14: shaped second W spans 11.2..20.8px (inked); unshaped
        // second W starts at 16px (background shows through).
        assert!(
            ink(&small_px, 14, 10) < 100,
            "under-budget 'WW' should shape (kerned) and ink x=14"
        );
        assert!(
            ink(&huge_px, 14, 10) > 200,
            "over-budget 'WW' must draw unshaped: second W starts at 16px"
        );
        // Sanity: the first W inks identically in both renders.
        assert!(ink(&huge_px, 4, 10) < 100);
        assert!(ink(&small_px, 4, 10) < 100);
    }

    /// `apply_long` cancellation reaches inside `render_page_rgba`: a
    /// pre-cancelled context fails at the first line checkpoint instead
    /// of returning pixels.
    #[test]
    fn render_cancels_at_line_checkpoint() {
        let reg = test_registry();
        let plan = test_plan(&reg);
        let blocks = vec![para_block("hi")];
        let ctx = TaskContext::new();
        ctx.cancel();
        let err = render_page_rgba(
            &plan,
            12.0,
            &blocks,
            &[(0, 0, 2)],
            20,
            10,
            96.0,
            Color::from_rgba8(0, 0, 0, 255),
            Color::from_rgba8(255, 255, 255, 255),
            Some(&ctx),
        )
        .unwrap_err();
        assert_eq!(err.code, ignition_core::ErrorCode::Cancelled);
    }

    /// Fully transparent output keeps the background's hidden RGB
    /// channels (straight-alpha honesty, `readRasterAsset` precedent)
    /// instead of zeroing them through premultiplied unpremultiply.
    #[test]
    fn transparent_background_preserves_hidden_rgb() {
        let reg = test_registry();
        let plan = test_plan(&reg);
        let blocks = vec![para_block("")];
        let px = render_page_rgba(
            &plan,
            12.0,
            &blocks,
            &[],
            4,
            3,
            96.0,
            Color::from_rgba8(0, 0, 0, 255),
            Color::from_rgba8(0x12, 0x34, 0x56, 0),
            None,
        )
        .unwrap();
        // Every pixel: alpha 0 with the background's RGB intact.
        for p in px.chunks_exact(4) {
            assert_eq!(p, &[0x12, 0x34, 0x56, 0]);
        }
    }
}
