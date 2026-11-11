# P-font-shaping-slice — quill harfrust text shaping

2026-11-08. Second slice of `P-font-glyph-backend-decision.md` (hybrid c on
the fontations stack); branch `codex/w5-quill-shaping`, worktree
`forge-w5-quill-shape`. Slice 1 (`codex/w5-quill-font`) landed the session
font registry + unhinted `cmap`/`hmtx` measured layout; this slice adds real
shaping to `layout {font}`.

## Dependency admitted

- `harfrust 0.15.0` — MIT, MSRV 1.85, published 2026-10-22 (>7 days).
  Pinned `default-features = false` + `std`: the optional `icu` feature
  (icu_properties/icu_normalizer tables) stays out, so shaping uses
  harfrust's pinned builtin UCD — deterministic across builds, matching the
  skrifa pinning discipline (decision doc open point 6). No `tracing`,
  `libm`, or dev-only deps enter the build. harfrust's `font::Font` is
  `read_fonts::model::Font` — literally the same type as `skrifa::Font`
  (both re-export read-fonts 0.46.0), so the registry's parsed font is
  reused for shaping with zero extra byte copies.

## What `layout {font}` does now

Per block, once per call: `block_content_text` → `harfrust::Buffer` →
`guess_segment_properties` (direction/script/language from content) →
`shape` with default `ShapeOptions` (full default feature set: GSUB
required/`liga`/`clig`/complex-script shapers, GPOS `kern`/mark/cursive
positioning). The shape runs under `catch_unwind`; any error or panic
returns `None` and that block falls back to the slice-1 unshaped per-char
`advance_units` path — layout never fails because of shaping.

Shaped glyphs carry UTF-8 **byte-offset** clusters; `shape_char_advances`
folds each glyph's `x_advance` (font units, unscaled — harfrust's default
scale is the identity) onto the char index containing its cluster byte,
rebuilding the same per-char prefix `wrap_block_measured` already
consumed. Only horizontal advances survive; offsets, `y_advance`, glyph
IDs and visual order are computed then discarded — `layout` output shape
is unchanged (`{pages:[{lines:[{block,start,end}]}]}`).

## Honest scope — shaped vs not

- **Shaped**: kerning (GPOS), ligature/substitution effects on advance
  totals (GSUB), complex-script reordering where it changes which glyphs
  exist (advances are summed per char span, so bidi totals are correct
  even though glyph order is discarded).
- **Not exact**: no per-line re-shaping *in this slice* — wrap decisions
  used whole-block shaping context, so a kern/ligature could be
  influenced by characters that landed on the next line. **Superseded**:
  the deferred fix landed in `P-font-per-line-shaping.md`
  (`codex/w8-quill-perline`), which re-shapes each wrapped line
  independently in bounded passes. A multi-char
  cluster's advance is attributed wholly to its first char, so a
  hard-break inside a cluster misestimates by under one glyph advance.
- **Cost note (review follow-up — resolved)**: shaping is ~50-100x the
  slice-1 per-char advance cost and paragraph text has no length cap
  (only table cells do, `CELL_TEXT_MAX=8192`) — `layout {font}` on a
  hostile huge document is a hang-class slowdown that predates this
  slice in kind but not magnitude. Resolved in
  `P-font-per-line-shaping.md`: `MAX_SHAPED_CHARS_PER_BLOCK` = 131072
  chars routes larger blocks to the unshaped path.
- **Not done**: glyph positions/extents, per-line shaped output, mark
  positioning effects on width (offsets ignored), per-inline
  family/size resolution, fallback chains, rasterization, TOC page
  numbers, `renderPage`. (Per-line shaped output landed in
  `P-font-per-line-shaping.md`.)

## Verification

- `cargo test -p quill-engine`: 238 pass (2 new — shaped advance values
  for kern/ligature pairs, shaped-vs-stub wrap spans; 3 slice-1
  expectations updated for the kerned fixture).
- Fixture: `nftestmono.ttf` regenerated via new
  `tests/fixtures/make_nftestmono.py` (fontTools) — identical cmap/hmtx
  metrics, plus GPOS `kern W+W −300` and GSUB `liga f+i→f_i` (600u);
  97 glyphs. No third-party font bytes.
- `pnpm --filter @nitro-forge/quill test`: fonts.e2e extended (kerned
  wrap spans + ligature wrap case) via nf-cli.
- Snapshot/undo unchanged: fonts remain session state; shaping reads only
  registered faces.
