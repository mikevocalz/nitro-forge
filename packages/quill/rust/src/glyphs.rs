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
//! Honest R1 scope: horizontal text with shaped pen offsets. `y_advance`
//! is dropped (horizontal text) exactly as the advance-folding path
//! drops it. NOT modeled (per the decision doc's deferral list): real
//! ascent/descent/line-gap metrics — the baseline is `line_top +
//! font_size_px`, the em-box approximation `LINE_SPACING` already
//! implies; R2 swaps real metrics into `layout` and `renderPage` together
//! — plus per-run styles, synthetic bold/italic, hinting, subpixel
//! positioning, bitmap/color strikes, vertical text, images,
//! decorations, headers/footers and TOC page numbers (R2/R3).

use crate::fonts::{FaceMeasure, PositionedGlyph};
use crate::{block_content_text, Block};
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

/// Per-block render context: the same serialized text `layout` measures
/// (`block_content_text`), its char→byte offsets, and the block's
/// effective font size in points (`font_size * kind.font_mult()`).
struct BlockText {
    text: String,
    byte_offsets: Vec<usize>,
    eff_pt: f64,
}

/// Checkpoint cadence for `renderPage` row bands (decision doc: "row-band
/// checkpoints"). One `TaskContext::checkpoint` per 32 emitted lines keeps
/// cancellation responsive on long documents without measurable cost.
const CHECKPOINT_STRIDE: usize = 32;

/// Render one page to straight-alpha RGBA8 (`w*h*4` bytes, row-major,
/// top-left origin). `lines` are the page's `(block, start, end)` char
/// spans exactly as `layout` reports them; `blocks` is the document.
///
/// Geometry: layout units are points; `px = pt * dpi/72`. Each line's
/// glyphs are shaped independently at `eff_pt * dpi/72` ppem and drawn
/// from the line's left edge; the baseline sits `font_size_px` below the
/// line top (the em-box approximation `LINE_SPACING` already implies —
/// see module docs). Glyph advances and offsets are font units scaled by
/// `ppem / units_per_em`. `y_px` accumulates per-line heights in page
/// order; lines arrive in document order so a running cursor is exact.
///
/// Read-only and deterministic: no journal, no events, no state.
pub fn render_page_rgba(
    measure: &FaceMeasure,
    blocks: &[Block],
    lines: &[(usize, usize, usize)],
    width_px: u32,
    height_px: u32,
    font_size: f64,
    dpi: f64,
    color: Color,
    background: Color,
    ctx: Option<&TaskContext>,
) -> Result<Vec<u8>, EngineError> {
    let scale = dpi / 72.0;
    let upem = measure.units_per_em();
    let font = measure.skrifa_font();
    let mut pixmap = Pixmap::new(width_px, height_px)
        .ok_or_else(|| EngineError::internal("renderPage pixmap allocation failed"))?;
    pixmap.fill(background);

    // Per-block text + offsets, computed once per call.
    let block_texts: Vec<BlockText> = blocks
        .iter()
        .map(|b| {
            let text = block_content_text(b);
            BlockText {
                byte_offsets: text.char_indices().map(|(i, _)| i).collect(),
                text,
                eff_pt: font_size * b.kind.font_mult(),
            }
        })
        .collect();

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
        let Some(bt) = block_texts.get(bi) else {
            continue;
        };
        let line_height_px = bt.eff_pt * crate::LINE_SPACING * scale;
        // Baseline = line top + one em in px (documented approximation).
        let baseline_y = y_px + bt.eff_pt * scale;
        let n = bt.byte_offsets.len();
        if start < end && start < n {
            let e = end.min(n);
            let byte_s = bt.byte_offsets[start];
            let byte_e = if e == n { bt.text.len() } else { bt.byte_offsets[e] };
            let line_text = &bt.text[byte_s..byte_e];

            let ppem = (bt.eff_pt * scale) as f32;
            let unit = ppem as f64 / upem; // font units → px
            let glyphs = measure
                .shape_line_glyphs(line_text)
                .unwrap_or_else(|| measure.unshaped_line_glyphs(line_text));
            let mut pen_x = 0.0f64;
            for g in &glyphs {
                let PositionedGlyph {
                    glyph_id,
                    x_advance,
                    x_offset,
                    y_offset,
                } = *g;
                let dx = pen_x + x_offset * unit;
                let dy = baseline_y - y_offset * unit;
                if let Some(path) = glyph_path(font, glyph_id, ppem) {
                    // Font coords are y-up; flip into pixmap y-down space.
                    let ts = Transform::from_row(1.0, 0.0, 0.0, -1.0, dx as f32, dy as f32);
                    pixmap.fill_path(&path, &paint, FillRule::Winding, ts, None);
                }
                pen_x += x_advance * unit;
            }
        }
        // Every emitted span occupies its line height, drawn or not —
        // `layout` counts (0,0) empty spans the same way.
        y_px += line_height_px;
    }

    if let Some(c) = ctx {
        c.checkpoint()?;
    }
    Ok(pixmap.take_demultiplied())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
