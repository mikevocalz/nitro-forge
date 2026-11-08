# P-quill-renderpage-r2

2026-11-08. Implementation record for slice **R2** of
`P-quill-renderpage-decision.md` (branch `codex/w13-quill-r2`, base forge
main `d581a17`). R2 scope per the decision: real line metrics in `layout`
and `renderPage` together, plus per-run `font_family`/`font_size`
resolution with an explicit unregistered-family fallback policy
(decision open point 5). Verified: `cargo test -p quill-engine` (259
pass), `cargo build -p nf-cli`, `pnpm install --prefer-offline`,
`pnpm --filter @nitro-forge/quill test` (60 pass),
`pnpm --filter @nitro-forge/quill typecheck` — all clean. **No new
dependencies** — R2 uses only already-admitted `skrifa`/`read-fonts`
APIs; `THIRD_PARTY_NOTICES.md` is unchanged.

## What shipped

- **Real vertical metrics.** `FaceMeasure::line_box_units()`
  (`fonts.rs`) exposes `(ascent, descent, line_gap)` in font units from
  `read_fonts::model::Font::metrics().h_line()` — the FreeType-style
  selection already inside the admitted read-fonts 0.46.0: OS/2 typo
  metrics when `USE_TYPO_METRICS` is set, else nonzero `hhea`, else
  nonzero typo, else the OS/2 Windows clipping line with zero gap.
  `runs::run_line_metrics` scales by `size_pt / units_per_em` and falls
  back to the `LINE_SPACING` em-box estimate when the font has no usable
  metrics or the result would be non-positive/non-finite — a hostile or
  odd font can never produce a broken line height.
- **Per-run resolution** (`runs.rs`, new module). `resolve_block_runs`
  maps each inline run's `Style.font_family`/`Style.font_size` onto the
  session registry once per block per op; `layout_pages` and
  `render_page_rgba` consume the same `BlockRuns`, so measurement,
  pagination and pixels cannot drift.
  - `font_family`: exact registry match (registration order, same as
    `FontRegistry::find`). **Fallback policy (open point 5, resolved):
    unset or unregistered families fall back to the op's base `font`
    face** — never an error, never `.notdef` substitution, no
    nearest-family or per-script chain. Read ops must not fail on a
    missing host font.
  - `font_size`: absolute points per the `applyStyle` grammar (1..1638,
    half-point steps — the DOCX `sz` semantic). Explicit sizes do NOT
    take `kind.font_mult()`; unset inherits `font_size *
    kind.font_mult()`. Documented choice: an explicit point size is the
    run's own size.
  - Table/toc/bibliography serialized text has no inline runs → one
    base-face/base-size run (R1 behavior preserved). Adjacent
    same-face/same-size runs merge.
- **Shared measurement path.** `layout_pages` now takes
  `Option<&runs::FontPlan>` (`None` = the untouched 0.5em/`LINE_SPACING`
  estimate path, still ignoring run styles). The real path shapes each
  resolved run for the initial pass and each `span ∩ run` piece for the
  bounded per-line passes (`BlockRuns::shaped_advances`), folding
  advances to per-char POINT widths; the unshaped path caches
  `(face_ptr, char)` advance units. Pagination consumes per-line
  heights (`BlockRuns::line_height` = max over intersecting runs;
  empty spans take the block default). `renderPage` re-resolves the
  same `BlockRuns` per block and draws each line's `span ∩ run` pieces
  at `size_pt * dpi/72` ppem with the line's max-ascender baseline —
  the identical segmentation `layout`'s final pass measured.
- **Dead code removed.** `FaceMeasure::shape_span_char_advances` (the
  R1 single-face per-line entry point) is superseded by
  `BlockRuns::shaped_advances` and deleted with its unit test;
  `layout`'s per-line pass budget (`MAX_LINE_SHAPE_PASSES`) is unchanged.
- **Docs.** `docs/ENGINE_OPS.md` layout row, fonts paragraph and
  `renderPage` paragraph rewritten for R2 semantics; `index.ts` doc
  comments updated (no API change — resolution is automatic).

## Open decision points — resolutions taken

1. **Unregistered-family fallback (decision open point 5):** base `font`
   face, silently. Applies identically in `layout {font}` and
   `renderPage`; without `font`, `layout` keeps the estimate path and
   ignores run styles entirely (there is no face to resolve against).
2. **`font_size` semantics:** absolute points, no `kind.font_mult()` on
   explicit sizes (heading multiplier applies only to inherited size).
3. **Mixed-metric lines:** line height = max over intersecting runs'
   line heights; baseline = max over intersecting runs' ascents.
   Real typesetters take the per-line union of extents — max-of-each is
   the deterministic v1 approximation; a run with an unusually deep
   descent can overlap the next line's ascenders (documented, bounded).
4. **Shaping boundary:** context stops at style-run boundaries in
   addition to wrap boundaries — a kern/ligature never crosses a
   `font_family`/`font_size` change even within one face. Same rule the
   per-line passes already applied at breaks.

## Honest scope notes / remaining R2 work

- Per-run `color`/`highlight`/`underline`/`strike`/`bold`/`italic` are
  NOT resolved — every glyph still draws in the single `color` param;
  no decorations, no synthetic styles. `Style.color` parsing exists
  (`parse_render_color` grammar) but is not wired per run.
- Font fallback chains beyond the base-face rule (nearest family,
  per-script fallback, weight/style matching within a family) remain
  deferred — `FontRegistry::find` is still first-registered-face-per-
  family-name.
- `layout` without `font` is unchanged: 0.5em estimate + `LINE_SPACING`,
  run styles ignored.
- Bidi/complex-script positioning approximation is unchanged (buffer
  order + pen offsets); run boundaries now additionally bound shaping
  context.
- Real fonts' line metrics can make lines shorter OR taller than the
  1.4em estimate (fixture: exactly 1.0em); pagination therefore differs
  from R1 whenever `font` is passed — intended, and `layout`/`renderPage`
  still agree because they share `layout_pages` + `BlockRuns`.

## Tests added

- Rust (9): `runs::tests` ×5 (real hhea metrics 1.0em/0.8em baseline,
  family+size resolution + merge + max-extent line metrics, explicit
  size vs `font_mult`, span∩run pieces + per-run shaping + malformed
  piece rejection, empty-block defaults); lib tests ×4
  (`layout_uses_real_font_line_metrics` — 2/2/1 pagination vs the
  estimate's 1-per-page contrast, `layout_resolves_per_run_font_size`,
  `layout_unregistered_run_family_falls_back_to_base`,
  `render_page_per_run_size_and_family_fallback` — byte-identical
  fallback pixels, differing deterministic styled pixels). One existing
  test retuned (`render_page_pages_match_layout_spans` page_height
  40→30 for the tighter real line height).
- vitest e2e (2): fonts.e2e real-metrics pagination + per-run size +
  family fallback; render-page.e2e per-run size pixels + fallback
  byte-identity + determinism.
