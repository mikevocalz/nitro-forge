//! Per-run font/style resolution for measured `layout` and `renderPage`
//! (renderPage decision `docs/completion/reports/
//! P-quill-renderpage-decision.md`, slice R2).
//!
//! R1 measured and drew every block with ONE face at ONE size
//! (`font_size * kind.font_mult()`). R2 resolves each inline run's
//! `Style.font_family`/`Style.font_size` against the session registry so
//! wrap measurement, line heights and glyph drawing can differ per run.
//!
//! Resolution rules (the decision doc's open point 5, resolved here):
//!
//! - `font_family`: exact-match lookup in the session `FontRegistry`
//!   (registration order, same as `FontRegistry::find`). An unset family
//!   uses the op's base `font` face. An UNREGISTERED family silently
//!   falls back to the base `font` face — never an error, never `.notdef`
//!   substitution — because `layout`/`renderPage` are read ops and a
//!   missing host font must not fail the read. Documented approximation:
//!   there is no nearest-family or per-script fallback chain.
//! - `font_size`: absolute points per the `applyStyle` grammar (1..1638,
//!   half-point steps — the DOCX `sz` semantic), NOT scaled by
//!   `kind.font_mult()`. Unset inherits the block default
//!   `font_size * kind.font_mult()`. A run-level size therefore opts out
//!   of the heading multiplier — the honest reading of an explicit point
//!   size.
//! - Table/toc/bibliography blocks serialize cell/entry text that has no
//!   inline runs: they resolve to a single run at the base face and block
//!   default size, exactly the R1 behavior.
//!
//! Shaping boundary: `layout`'s shaped path shapes each maximal
//! same-resolution piece independently (whole runs for the initial
//! measurement, `span ∩ run` pieces for the per-line passes). Context
//! never crosses a style-run boundary — the same "no context across a
//! break" rule the per-line passes already apply at wrap boundaries.
//! `renderPage` draws the identical `span ∩ run` pieces, so pixels and
//! spans still agree.
//!
//! Everything here is deterministic: resolution is a pure function of
//! the block, `font_size`, and the registry; no I/O, no clocks.

use crate::fonts::{shaping_budget_allows, FaceMeasure, FontFace, FontRegistry};
use crate::{block_content_text, Block, LINE_SPACING};
use std::collections::HashMap;
use std::sync::Arc;

/// Session-font context shared by `layout {font}` and `renderPage`:
/// the registry plus the op's base `font` face (the fallback for unset
/// or unregistered run families).
pub struct FontPlan<'a> {
    pub registry: &'a FontRegistry,
    pub base_face: Arc<FontFace>,
}

/// One inline run resolved to a concrete face and size.
pub struct ResolvedRun {
    /// Char range `[start, end)` into the block's serialized text
    /// (`block_content_text` — for a table block the cell-grid
    /// serialization, which never carries styles anyway).
    pub start: usize,
    pub end: usize,
    pub face: Arc<FontFace>,
    pub measure: FaceMeasure,
    /// Effective size in points (see module docs for the inheritance
    /// and `font_mult` rules).
    pub size_pt: f64,
    /// This run's line height in points: real `hhea`/`OS/2` metrics
    /// (`(ascent - descent + line_gap) * size/upem`) when the face
    /// exposes them, else the `LINE_SPACING` em-box estimate.
    pub line_height_pt: f64,
    /// Baseline offset from the line top in points: the font's ascender
    /// scaled to `size_pt`, or `size_pt` itself (one em) on the
    /// estimate fallback — the R1 baseline rule.
    pub ascent_pt: f64,
}

/// A block's serialized text plus its resolved runs — the shared input
/// `layout_pages` measures and `render_page_rgba` draws.
pub struct BlockRuns {
    pub text: String,
    /// `text.char_indices()` byte offsets, one per char.
    pub byte_offsets: Vec<usize>,
    /// Sorted, non-overlapping runs covering `0..char_count` (empty when
    /// the text is empty).
    pub runs: Vec<ResolvedRun>,
    /// `fonts::shaping_budget_allows(char_count)` — the identical gate
    /// `layout_pages` applies; when false every piece measures/draws
    /// through the unshaped `cmap`+`hmtx` path.
    pub may_shape: bool,
    /// Block-default line metrics (base face at `font_size *
    /// kind.font_mult()`) used for empty `(s == e)` spans and as the
    /// degenerate fallback when no run intersects a span.
    pub default_height_pt: f64,
    pub default_ascent_pt: f64,
}

/// Line metrics for one face at one size, in points. Real metrics come
/// from `FaceMeasure::line_box_units` (read-fonts' FreeType-style
/// hhea/OS/2 selection); degenerate or missing metrics fall back to the
/// `LINE_SPACING` estimate so a hostile/odd font can never produce a
/// non-positive or non-finite line height.
fn run_line_metrics(measure: &FaceMeasure, size_pt: f64) -> (f64, f64) {
    let fallback = (size_pt * LINE_SPACING, size_pt);
    let Some((asc, desc, gap)) = measure.line_box_units() else {
        return fallback;
    };
    if !(asc.is_finite() && desc.is_finite() && gap.is_finite()) {
        return fallback;
    }
    let scale = size_pt / measure.units_per_em();
    let height = (asc - desc + gap) * scale;
    let ascent = asc * scale;
    if height.is_finite() && height > 0.0 && ascent.is_finite() && ascent >= 0.0 {
        (height, ascent)
    } else {
        fallback
    }
}

/// Resolve one block's inline runs against the session registry.
/// See module docs for the family/size/fallback rules. Cheap: no
/// shaping, no rasterization — `FaceMeasure::open` is an `Arc` bump.
pub fn resolve_block_runs(
    b: &Block,
    font_size: f64,
    plan: &FontPlan,
) -> BlockRuns {
    let text = block_content_text(b);
    let byte_offsets: Vec<usize> = text.char_indices().map(|(i, _)| i).collect();
    let n = byte_offsets.len();
    let base_size = font_size * b.kind.font_mult();

    let base_measure = FaceMeasure::open(&plan.base_face);
    let (default_height_pt, default_ascent_pt) = match &base_measure {
        Some(m) => run_line_metrics(m, base_size),
        None => (base_size * LINE_SPACING, base_size),
    };

    // (start, end, face, size_pt) triples in char-index space.
    let mut pieces: Vec<(usize, usize, Arc<FontFace>, f64)> = Vec::new();
    if b.table.is_some() || b.inlines.is_empty() {
        // Serialized non-inline content (table cell grid, or a block with
        // no runs): one run at the base face and block default size —
        // identical to R1's single-face behavior.
        if n > 0 {
            pieces.push((0, n, plan.base_face.clone(), base_size));
        }
    } else {
        let mut pos = 0usize;
        for inl in &b.inlines {
            let len = inl.text.chars().count();
            if len == 0 {
                continue;
            }
            let end = (pos + len).min(n);
            if end <= pos {
                break;
            }
            // Family: explicit style family resolved exactly, else the
            // op's base `font` face; unregistered names take the same
            // fallback (documented — read ops never fail on a missing
            // host font).
            let face = match &inl.style.font_family {
                Some(fam) => plan
                    .registry
                    .find(fam)
                    .cloned()
                    .unwrap_or_else(|| plan.base_face.clone()),
                None => plan.base_face.clone(),
            };
            // Size: explicit `font_size` is absolute points (applyStyle
            // grammar); unset inherits `font_size * kind.font_mult()`.
            let size_pt = inl.style.font_size.unwrap_or(base_size);
            pieces.push((pos, end, face, size_pt));
            pos = end;
            if pos >= n {
                break;
            }
        }
    }

    // Merge adjacent pieces that resolve to the same face and size —
    // fewer shaping calls, identical output (line metrics derive from
    // face+size alone).
    let mut runs: Vec<ResolvedRun> = Vec::with_capacity(pieces.len());
    for (start, end, face, size_pt) in pieces {
        if let Some(last) = runs.last_mut() {
            if Arc::ptr_eq(&last.face, &face) && last.size_pt.to_bits() == size_pt.to_bits() {
                last.end = end;
                continue;
            }
        }
        let measure = FaceMeasure::open(&face)
            .or_else(|| base_measure.clone())
            .expect("registered faces re-parse; base measure opened above");
        let (line_height_pt, ascent_pt) = run_line_metrics(&measure, size_pt);
        runs.push(ResolvedRun {
            start,
            end,
            face,
            measure,
            size_pt,
            line_height_pt,
            ascent_pt,
        });
    }

    BlockRuns {
        may_shape: shaping_budget_allows(n),
        byte_offsets,
        text,
        runs,
        default_height_pt,
        default_ascent_pt,
    }
}

/// `(run_index, char_start, char_end)` pieces tiling `0..n` for the
/// given line spans — the `span ∩ run` intersections both `layout`'s
/// per-line shaping passes and `renderPage`'s per-line drawing use, so
/// measurement and pixels segment identically. Two-pointer merge:
/// spans and runs are both sorted and together cover the text.
fn span_run_pieces(
    runs: &[ResolvedRun],
    spans: &[(usize, usize)],
) -> Vec<(usize, usize, usize)> {
    let mut out = Vec::new();
    let mut ri = 0usize;
    for &(s, e) in spans {
        if s >= e {
            continue;
        }
        while ri < runs.len() && runs[ri].end <= s {
            ri += 1;
        }
        let mut j = ri;
        while j < runs.len() && runs[j].start < e {
            let cs = s.max(runs[j].start);
            let ce = e.min(runs[j].end);
            if cs < ce {
                out.push((j, cs, ce));
            }
            j += 1;
        }
    }
    out
}

impl BlockRuns {
    /// Initial whole-run pieces `(run_index, start, end)` for the block's
    /// first shaping pass.
    fn run_pieces(&self) -> Vec<(usize, usize, usize)> {
        self.runs
            .iter()
            .enumerate()
            .filter(|(_, r)| r.start < r.end)
            .map(|(i, r)| (i, r.start, r.end))
            .collect()
    }

    /// The `span ∩ run` pieces for `spans` — public wrapper over
    /// [`span_run_pieces`] for `renderPage`.
    pub fn span_pieces(&self, spans: &[(usize, usize)]) -> Vec<(usize, usize, usize)> {
        span_run_pieces(&self.runs, spans)
    }

    /// Shape `pieces` — `(run_index, char_start, char_end)` ranges that
    /// must each lie inside one run — with each piece's own face and
    /// fold the shaped advances onto per-char POINT widths
    /// (`units * size_pt / units_per_em`). One harfrust call per piece;
    /// context never crosses a run boundary (module docs). `None` on any
    /// shape failure/panic so the caller falls back to
    /// [`BlockRuns::unshaped_advances`] — the same contract
    /// `FaceMeasure::shape_char_advances` documents.
    pub fn shaped_advances(&self, pieces: &[(usize, usize, usize)]) -> Option<Vec<f64>> {
        let n = self.byte_offsets.len();
        let mut out = vec![0.0f64; n];
        for &(ri, s, e) in pieces {
            let Some(run) = self.runs.get(ri) else {
                return None;
            };
            if s >= e || e > n || s < run.start || e > run.end {
                return None;
            }
            let byte_s = self.byte_offsets[s];
            let byte_e = if e == n { self.text.len() } else { self.byte_offsets[e] };
            let seg = &self.text[byte_s..byte_e];
            let rel: Vec<usize> = self.byte_offsets[s..e]
                .iter()
                .map(|&o| o - byte_s)
                .collect();
            let units = run.measure.shape_char_advances(seg, &rel)?;
            let scale = run.size_pt / run.measure.units_per_em();
            for (i, u) in units.iter().enumerate() {
                out[s + i] = u * scale;
            }
        }
        Some(out)
    }

    /// Unshaped per-char advances in points: `cmap`+`hmtx` on each
    /// char's own run face, scaled by that run's size. `cache` is keyed
    /// `(face_ptr, char)` → advance units so repeated chars across runs
    /// sharing a face measure once; declared at the `layout_pages` call
    /// site so it persists across blocks of one op.
    pub fn unshaped_advances(
        &self,
        cache: &mut HashMap<(usize, char), f64>,
    ) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.byte_offsets.len());
        let mut ri = 0usize;
        for (i, c) in self.text.chars().enumerate() {
            while ri + 1 < self.runs.len() && self.runs[ri].end <= i {
                ri += 1;
            }
            let run = self
                .runs
                .get(ri)
                .filter(|r| r.start <= i && i < r.end);
            match run {
                Some(r) => {
                    let key = (Arc::as_ptr(&r.face) as usize, c);
                    let units = *cache
                        .entry(key)
                        .or_insert_with(|| r.measure.advance_units(c));
                    out.push(units * r.size_pt / r.measure.units_per_em());
                }
                // Unreachable for resolved blocks (runs cover the text);
                // a zero advance keeps the wrap deterministic rather than
                // failing the read.
                None => out.push(0.0),
            }
        }
        out
    }

    /// Initial shaping pieces for the block's first measurement pass.
    pub fn initial_pieces(&self) -> Vec<(usize, usize, usize)> {
        self.run_pieces()
    }

    /// Line height in points for char span `(s, e)`: the max over
    /// intersecting runs (real typesetters take the per-line union of
    /// extents; max-of-each is the deterministic v1 approximation —
    /// documented in the R2 report). Empty spans and spans no run
    /// intersects use the block default.
    pub fn line_height(&self, s: usize, e: usize) -> f64 {
        if s >= e {
            return self.default_height_pt;
        }
        let mut h = self.default_height_pt;
        let mut ri = self
            .runs
            .partition_point(|r| r.end <= s);
        while ri < self.runs.len() && self.runs[ri].start < e {
            h = h.max(self.runs[ri].line_height_pt);
            ri += 1;
        }
        h
    }

    /// Baseline offset from the line top in points: the max ascender
    /// over intersecting runs (same max-extent approximation as
    /// [`BlockRuns::line_height`]).
    pub fn line_ascent(&self, s: usize, e: usize) -> f64 {
        if s >= e {
            return self.default_ascent_pt;
        }
        let mut a = 0.0f64;
        let mut ri = self
            .runs
            .partition_point(|r| r.end <= s);
        while ri < self.runs.len() && self.runs[ri].start < e {
            a = a.max(self.runs[ri].ascent_pt);
            ri += 1;
        }
        if a > 0.0 {
            a
        } else {
            self.default_ascent_pt
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BlockKind, Inline, Style};

    fn registry() -> FontRegistry {
        let bytes = include_bytes!("../tests/fixtures/nftestmono.ttf");
        let mut reg = FontRegistry::default();
        reg.register("NFTestMono", 0, bytes.to_vec()).unwrap();
        reg
    }

    fn plan<'a>(reg: &'a FontRegistry) -> FontPlan<'a> {
        FontPlan {
            registry: reg,
            base_face: reg.find("NFTestMono").unwrap().clone(),
        }
    }

    fn block(inlines: Vec<Inline>) -> Block {
        Block {
            kind: BlockKind::Para,
            list: None,
            style_id: None,
            inlines,
            table: None,
            toc: None,
            bibliography: None,
            format: None,
        }
    }

    fn inline(text: &str, style: Style) -> Inline {
        Inline {
            text: text.to_string(),
            style,
        }
    }

    /// The fixture's hhea line is (800,-200,0) over upem 1000: real line
    /// height is exactly 1.0em and the baseline sits at 0.8em — the R2
    /// replacement for the 1.4em/1.0em-baseline LINE_SPACING estimates.
    #[test]
    fn real_line_metrics_from_hhea() {
        let reg = registry();
        let p = plan(&reg);
        let br = resolve_block_runs(&block(vec![inline("hi", Style::default())]), 10.0, &p);
        assert_eq!(br.runs.len(), 1);
        let r = &br.runs[0];
        assert!((r.line_height_pt - 10.0).abs() < 1e-9);
        assert!((r.ascent_pt - 8.0).abs() < 1e-9);
        assert!((br.default_height_pt - 10.0).abs() < 1e-9);
        assert!((br.default_ascent_pt - 8.0).abs() < 1e-9);
        // Empty spans take the block default.
        assert_eq!(br.line_height(0, 0), br.default_height_pt);
        assert_eq!(br.line_ascent(0, 0), br.default_ascent_pt);
    }

    /// Resolution rules: explicit `font_size` is absolute points (no
    /// kind multiplier), unset inherits `font_size * font_mult`, an
    /// unregistered `font_family` falls back to the base face, and
    /// adjacent same-resolution runs merge.
    #[test]
    fn per_run_family_and_size_resolution() {
        let reg = registry();
        let p = plan(&reg);
        let styled = Style {
            font_size: Some(20.0),
            font_family: Some("NotRegistered".to_string()),
            ..Style::default()
        };
        let br = resolve_block_runs(
            &block(vec![
                inline("AB", Style::default()),
                inline("CD", styled.clone()),
                inline("EF", styled), // same resolution → merges with CD
            ]),
            10.0,
            &p,
        );
        assert_eq!(br.text, "ABCDEF");
        assert_eq!(br.runs.len(), 2);
        assert_eq!((br.runs[0].start, br.runs[0].end), (0, 2));
        assert_eq!(br.runs[0].size_pt, 10.0);
        assert_eq!((br.runs[1].start, br.runs[1].end), (2, 6));
        assert_eq!(br.runs[1].size_pt, 20.0);
        // Missing family resolved to the base face (ptr equality).
        assert!(Arc::ptr_eq(&br.runs[1].face, &p.base_face));
        assert!(Arc::ptr_eq(&br.runs[0].face, &p.base_face));
        // Line height tracks each run's own size.
        assert_eq!(br.line_height(0, 2), 10.0);
        assert_eq!(br.line_height(2, 6), 20.0);
        // A span crossing both runs takes the max extent.
        assert_eq!(br.line_height(0, 6), 20.0);
        assert_eq!(br.line_ascent(0, 6), 16.0);
    }

    /// Heading kinds scale only the inherited size, never an explicit
    /// run `font_size`.
    #[test]
    fn explicit_run_size_ignores_kind_multiplier() {
        let reg = registry();
        let p = plan(&reg);
        let mut b = block(vec![
            inline("AB", Style::default()),
            inline(
                "CD",
                Style {
                    font_size: Some(20.0),
                    ..Style::default()
                },
            ),
        ]);
        b.kind = BlockKind::H1; // font_mult 1.4
        let br = resolve_block_runs(&b, 10.0, &p);
        assert_eq!(br.runs[0].size_pt, 14.0, "inherited: 10 * 1.4");
        assert_eq!(br.runs[1].size_pt, 20.0, "explicit stays absolute");
    }

    /// `span ∩ run` pieces tile the text for both layout's per-line
    /// shaping passes and renderPage's drawing; `shaped_advances`
    /// measures each piece with its own face/size and rejects malformed
    /// pieces.
    #[test]
    fn span_pieces_and_per_run_shaping() {
        let reg = registry();
        let p = plan(&reg);
        let br = resolve_block_runs(
            &block(vec![
                inline("W", Style::default()),
                inline(
                    "W",
                    Style {
                        font_size: Some(20.0),
                        ..Style::default()
                    },
                ),
            ]),
            10.0,
            &p,
        );
        assert_eq!(br.runs.len(), 2);
        // Initial pieces = whole runs; each 'W' is 1000 units.
        let adv = br.shaped_advances(&br.initial_pieces()).unwrap();
        assert_eq!(adv, vec![10.0, 20.0], "per-run sizes, no cross-run kern");
        // Line spans partition differently → different pieces, same
        // per-char totals (each piece still one char).
        let pieces = br.span_pieces(&[(0, 1), (1, 2)]);
        assert_eq!(pieces, vec![(0, 0, 1), (1, 1, 2)]);
        let adv2 = br.shaped_advances(&pieces).unwrap();
        assert_eq!(adv2, vec![10.0, 20.0]);
        // Malformed pieces (wrong run, out of range, empty) → None.
        assert!(br.shaped_advances(&[(2, 0, 1)]).is_none());
        assert!(br.shaped_advances(&[(0, 0, 3)]).is_none());
        assert!(br.shaped_advances(&[(0, 1, 1)]).is_none());
        // Unshaped path agrees on advances (single chars shape trivially).
        let mut cache = HashMap::new();
        assert_eq!(br.unshaped_advances(&mut cache), vec![10.0, 20.0]);
    }

    /// A block with no inline text resolves to no runs; empty spans fall
    /// back to the block-default metrics. (Serialized non-inline content
    /// — table cell grids — takes the same single-base-run branch in
    /// `resolve_block_runs`.)
    #[test]
    fn empty_block_resolves_to_defaults() {
        let reg = registry();
        let p = plan(&reg);
        let br = resolve_block_runs(&block(vec![]), 12.0, &p);
        assert!(br.runs.is_empty() && br.text.is_empty());
        assert_eq!(br.default_height_pt, 12.0);
        assert!(!br.may_shape);
    }
}
