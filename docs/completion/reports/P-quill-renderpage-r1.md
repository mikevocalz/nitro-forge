# P-quill-renderpage-r1

2026-11-08. Implementation record for slice **R1** of
`P-quill-renderpage-decision.md` (branch `codex/w11-quill-render`, base
forge main `e71cabf`). R1 = text glyphs on pages: engine op + TS adapter +
dep admission. Verified: `cargo test -p quill-engine` (245 pass),
`cargo build -p nf-cli`, `pnpm install --prefer-offline`,
`pnpm --filter @nitro-forge/quill test` (58 pass),
`pnpm --filter @nitro-forge/quill typecheck` — all clean.

## What shipped

- **Dep admission.** `tiny-skia =0.12.0` + `tiny-skia-path 0.12.0`
  (BSD-3-Clause, published 2026-02-02 — far past the 7-day rule), pinned
  `default-features = false` + `std` in `packages/quill/rust/Cargo.toml`:
  the optional `png` dep and the `simd` feature are excluded so one
  scalar code path serves every target (same pinning discipline as
  skrifa/harfrust). Resolved transitives in `Cargo.lock`: `arrayref`,
  `arrayvec`, `strict-num`, `cfg-if`, `log` (+ already-present `bytemuck`).
  `packages/quill/THIRD_PARTY_NOTICES.md` gained a renderPage section
  with license, version pin, feature exclusions and checksum note.
- **`packages/quill/rust/src/glyphs.rs`** (new): `PathSink`→`PathBuilder`
  pen (`move`/`line`/`quad` pass through, `curve_to`→`cubic_to`, `close`),
  per-glyph `catch_unwind`-guarded outline draw via
  `skrifa::Font::outline_glyphs()` → `model::glyph::outline::
  OutlineGlyph::draw` with `DrawOptions::with_ppem`, and
  `render_page_rgba` — one `Pixmap`, background fill, per-line shaped
  glyph runs filled with anti-aliased winding paint, straight-alpha RGBA
  out via `take_demultiplied`.
- **`fonts.rs`**: `PositionedGlyph` (glyph id + `x_advance`/`x_offset`/
  `y_offset`, font units), `FaceMeasure::shape_line_glyphs` (keeps the
  positioned run `layout` discards; same harfrust call and
  `catch_unwind`/`None`-on-failure contract),
  `FaceMeasure::unshaped_line_glyphs` (cmap+`hmtx` fallback, zero
  offsets), `skrifa_font()` accessor for outline access.
- **`lib.rs`**: `layout`'s wrap+pagination extracted verbatim into
  `layout_pages` (returns `(block,start,end)` spans); `op_layout`
  re-serializes it, `op_render_page` consumes it — the decision's
  "same pagination routine" requirement is literal, not approximate.
  New op `renderPage` registered in `apply` and in `apply_long` (row-band
  `TaskContext` checkpoints every 32 emitted lines + final checkpoint).
- **TS**: `OPS.renderPage`, `RenderPageOptions`/`RenderPageResult`
  types, `QuillDocument.renderPage()` in `packages/quill/src/index.ts`.
  `QUILL_DEFERRED_OPS.renderPage` lifted (empty map remains for future
  deferrals) — per the decision, the deferred entry clears when the TS
  surface ships.
- **Docs**: `docs/ENGINE_OPS.md` quill ops-table row + dedicated
  `renderPage` paragraph + fonts-paragraph deferred-list correction;
  `docs/ROSTER.md` truthful counts (245 Rust / 58 vitest) + new slice row.
- **Fixture**: `nftestmono.ttf` regenerated with simple box outlines
  (`make_nftestmono.py` updated) — metrics, cmap, GPOS/GSUB tables
  unchanged, so all prior font assertions still hold; outlines exist so
  rasterization has real coverage.

## Open decision points — resolutions taken (per task instructions)

1. **tiny-skia admission** — admitted as recommended (option a).
2. **Output field shape** — `{page,width,height,format:"raw",size}` in
   `data` plus `pixels_b64`, or raw bytes in `CommandResult.output` under
   `binary_output` (design `renderFrame` duality). `format` is `"raw"`
   only; no `stride` field (always `width*4`, RGBA8 tightly packed).
3. **`dpi` default 96**; no `scale` alias (kept minimal — `dpi` is the
   documented unit, folio-render's `scale|dpi` union not copied).
4. **R1 scope** — engine op + TS adapter + `QUILL_DEFERRED_OPS` lift in
   one slice (the task's instruction; the decision left it open).
5. **`background`/`color` defaults** — opaque white page, opaque black
   text (the decision's proposed defaults). Accepted grammar:
   `#RRGGBB` (opaque) or `#RRGGBBAA`.
6. **`max_dim`** — interpreted as an optional per-side *pixel* cap:
   render rejects (Validation) when either side would exceed it, never
   downscales. Documented in ENGINE_OPS.md.

## Honest scope notes / known approximations

- Baseline = line top + `font_size_px` (em-box approximation). Real
  `hhea`/`OS/2` ascent/descent/line-gap is R2 and lands in `layout` and
  `renderPage` together so spans and pixels keep agreeing.
- Single face, single size per block kind (`font_size * kind.font_mult()`),
  single `color` — the same single-face simplification `layout` documents;
  per-run `Style` resolution is R2.
- Glyphs draw in harfrust buffer order with their pen offsets
  (`x_offset`/`y_offset` applied; `y_advance` dropped — horizontal text).
  Bidi/complex-script positioning is approximate in exactly the way
  `layout` measurement already is; not claimed beyond that.
- Outlines draw unhinted at `ppem = eff_pt * dpi/72`; no hinting, subpixel
  positioning, synthetic bold/italic, bitmap/color strikes (the recorded
  `swash` revisit).
- `apply` (non-task) path renders synchronously with no checkpoints;
  `apply_long` checkpoints per 32 lines. nf-cli's JSON-lines protocol
  carries `pixels_b64` (no binary sidecar over that transport — the
  `binary_output` channel exists for FFI/Nitro hosts).
- Table/toc/bibliography blocks render their `block_content_text`
  serialization as text lines, same as `layout` — no cell geometry.

## Tests added

- Rust (5): `line_glyph_runs_keep_positions` (shaped advances/ligature +
  unshaped fallback), `glyphs::tests::glyph_outline_path_and_missing_glyph`
  (path sanity, missing glyph id, degenerate ppem),
  `render_page_draws_glyph_pixels_deterministically` (non-empty ink,
  exact `w*h*4` length, byte-identical repeat, `binary_output` sidecar),
  `render_page_pages_match_layout_spans` (every layout page renders,
  out-of-range → OutOfBounds), `render_page_validates_params_and_bounds`
  (required `font`, unregistered family, 4096px bound, `max_dim`, dpi,
  color grammar, custom colors accepted).
- vitest e2e (2, `tests/render-page.e2e.test.ts` via nf-cli): non-empty
  deterministic RGBA + dimensions; layout↔renderPage page-count agreement,
  out-of-range/bounds/`font`-required rejections.
