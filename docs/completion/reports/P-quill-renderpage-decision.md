# P-quill-renderpage-decision

2026-11-08. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Decides the architecture for Quill `renderPage`
(`QUILL_DEFERRED_OPS` H-15, `packages/quill/src/office-cluster.ts:20-24`)
against `docs/ARCHITECTURE.md`, `docs/ENGINE_OPS.md` (quill ops table and
fonts paragraph), the landed font slices
(`P-font-glyph-backend-decision.md`, `P-font-shaping-slice.md`), and the
host-service precedents (`P15-pdf-backend-decision.md`,
`P15-folio-render-admission.md`, `P-encoder-provider-decision.md`).
Docs-only: no builds, tests, or device runs were performed.

## Current state — what renderPage inherits and what is missing

Inherited and verified (ROSTER rows for `codex/w5-quill-font` and
`codex/w5-quill-shaping`):

- Session font registry: `registerFont`/`removeFont`/`listFonts`; ≤16 MiB
  per face, ≤64 faces, ≤256 MiB per session; the parsed `skrifa::Font`
  (`Arc`-backed owning value) is kept per face and re-parsed cheaply.
- `layout {font}`: one `harfrust` shape per block covering GSUB+GPOS, each
  glyph's `x_advance` folded onto its cluster's first char, greedy wrap
  into `{pages:[{lines:[{block,start,end}]}]}` char spans.
- Pagination exists but is minimal: a page is `page_height` of
  `LINE_SPACING = 1.4`-sized lines; a block splits across pages at line
  granularity when the next line does not fit the remaining height.
- `sections.rs` already stores real page geometry — `PageSetup` in points
  (US Letter 612×792 default, orientation, margins, columns, column gap,
  per-section start) plus optional header/footer bodies — but `layout`
  ignores it entirely.

Missing for pixels:

- **Positioned glyph runs.** `layout` folds advances onto chars and
  discards glyph ids, `x_offset`/`y_offset`, clusters, and direction.
  Rendering needs a shaping path that keeps them.
- **Glyph coverage.** `skrifa` exposes outline pens; nothing in the tree
  rasterizes (`Cargo.lock` has no tiny-skia/ab_glyph/rustybuzz/swash/
  fontdue; `prism-engine` deps are `ignition-core`+serde only and its
  `raster.rs` composites shapes and uploaded rasters, no glyphs).
- **Real line metrics.** `LINE_SPACING` is an estimate; `hhea`/`OS/2`
  ascent/descent/line-gap are unread.
- **Per-run resolution.** `Style` inlines carry `font_family`,
  `font_size`, `color`, `highlight`, `bold`, `italic`, `underline`,
  `strike`; layout and any v1 render use one face at one
  `font_size × kind.font_mult()`.
- **Output channel.** Quill's `binary_input_ops` lists only
  `importDocx`/`registerFont`; no op returns pixels yet.

## Contract constraints that decide the shape

- Engines are synchronous, single-threaded, `Send`-only, and I/O-free.
  `renderPage` reads document state plus the session font registry —
  both already in memory — and admits nothing new.
- Determinism is the contract: snapshot→restore→render must produce
  identical results on every target including WASM. Platform text stacks
  were already rejected as engine truth in
  `P-font-glyph-backend-decision.md` §(b); nothing here reopens that.
- Read ops record no journal entry and emit no `document:changed`
  (`layout`/`flatten` precedent). `renderPage` is the same class.
- Binary output exists: `Command.binary_output` →
  `CommandResult.output`, with `pixels_b64`/`{width,height}` JSON
  precedent in design `renderFrame`, prism `flatten`/`layerThumbnail`,
  and folio `getAttachment`.
- Long ops have a cancellation path: `apply_long` + `TaskContext`
  checkpoints (motion `renderFrame`, prism raster row-bands). A print-DPI
  page (~8 MP at 300 dpi letter) exceeds motion's 1 MP canvas cap, so
  `renderPage` needs its own pixel bound and row-band checkpoints.
- The folio-render boundary exists because pdfium is a native library
  whose objects are not `Send`, requires a runtime shared library, and
  rasterizes through non-deterministic binary builds. None of those
  properties apply to a pure-Rust glyph pipeline on already-admitted
  font bytes.

## Candidates — where glyph rasterization lives

### (a) Engine-side: skrifa outlines → pure-Rust rasterizer → RGBA

`skrifa` 0.49's outline API (`OutlineGlyph` + pen protocol) emits
`move`/`line`/`quad`/`cubic`/`close` — TrueType quadratics and CFF
cubics, no conics — which maps onto `tiny-skia-path` verbs one-to-one.
The open question is only which rasterizer fills those paths.

| Crate | Version / date | License | Role | Verdict |
|---|---|---|---|---|
| `tiny-skia` (+`tiny-skia-path`) | 0.12.0, 2026-02-02 | BSD-3-Clause | CPU-only 2D fills/strokes/blends; **no text by design** — we supply paths | **Recommended.** Permissive, pure Rust, all targets incl. WASM, huge install base (resvg/linebender ecosystem). Deps `arrayref`, `arrayvec`, `bytemuck`, `cfg-if`, `log` are MIT/Apache/Zlib-class; optional `png` and `simd` features excludable via `default-features = false`. |
| `swash` | 0.2.10 | Apache-2.0 OR MIT | Purpose-built glyph scaler: hinting, subpixel, embedded bitmap strikes, COLR/CPAL emoji | Rejected for v1. Its `skrifa` bound is `<=0.44` while quill admits `skrifa 0.49` — admitting swash pulls a **second** fontations/read-fonts stack whose `Font` type does not unify with the registry's parsed font, plus `yazi`/`zeno` deps. Revisit only if hinting, subpixel positioning, or bitmap/color strikes become requirements. |
| `fontdue` | 0.9/0.10 | MIT OR Apache-2.0 | Standalone TTF→coverage bitmap | Rejected: a second font parser beside skrifa (ttf-parser), bitmap-only metrics, weaker coverage. |
| `ab_glyph` | 0.2.x | Apache-2.0 | Metrics + analytic raster | Rejected: aging; `P-font-glyph-backend-decision.md` already marks it superseded by the fontations-era stack. |
| In-repo coverage rasterizer | n/a | repo | Flatten cubics → scanline fill in `fonts.rs`/`glyphs.rs` | Viable fallback. Matches the `prism/raster.rs` precedent of owning pixel math and adds zero deps, but cubic flattening tolerance and coverage correctness are real surface area for a first slice. Hold unless tiny-skia admission is declined. |

### (b) Host-side platform text APIs — rejected

CoreText/DirectWrite/Minikin/FreeType rasterize and hint differently per
OS; WASM has no system stack at all. Engines cannot call them anyway
(I/O-free), so platform numbers would enter ops as inputs and the engine
becomes a passive receiver of non-deterministic values — the exact shape
`P-font-glyph-backend-decision.md` §(b) rejected. Retained only for
host-side preview chrome where snapshot parity is not claimed.

### (c) Hand glyph runs to Prism — rejected as stated; one variant survives

Prism has no glyph/text pipeline: `raster.rs` composites shapes and
uploaded rasters, and motion/design stage pixels through
`addRasterLayer` + `drawPixels` + `flatten`. Handing positioned runs to
Prism would force a second font stack inside `prism-engine` or a new
inter-engine glyph protocol — both worse than rasterizing in quill.

The viable variant: quill owns text→pixels end to end and MAY stage the
finished page through an ephemeral `prism-engine` scene (motion and
design already take the `prism-engine` path dependency) when page
decorations later need real compositing — transforms, images, blending.
Not needed for v1; see page model. This keeps the (c) intuition (reuse
the suite's compositor) without inventing a glyph handoff protocol.

## Decision

1. **`renderPage` is an engine op producing RGBA, not a host service.**
   Determinism is achievable in pure Rust on font bytes the engine
   already holds; the I/O-free/`Send` contract is satisfied; the binary
   output channel exists; WASM is covered for free. The folio-render
   boundary is for backends that cannot meet those properties. The op is
   read-only: no journal entry, no `document:changed`, no snapshot
   change — same class as `layout` and `flatten`.
2. **Rasterization: admit `tiny-skia` for glyph outline fills; `skrifa`
   supplies the outlines** from the already-parsed session fonts. No
   second font parser, no platform text stack, no inter-engine glyph
   protocol. `swash` stays on record for the hinting/subpixel/bitmap-
   strike future; the in-repo rasterizer stays the fallback if the dep
   admission is declined.
3. **Shaping for render keeps positions, per emitted line.** `layout`'s
   whole-block fold exists because it must return char spans cheaply;
   pixels need glyph ids, offsets, and clusters. `renderPage` re-wraps
   internally (same pagination routine, so spans and pixels cannot
   drift) then shapes **each emitted line independently** — intra-line
   positioning is then exact, and a kern across a break is absent exactly
   as in real typesetting. Cost is one shape per line, bounded by the
   same hostile-document caveat the shaping slice already documents.
4. **Page model v1 mirrors `layout`.** `renderPage` accepts the layout
   parameters verbatim (`page_width`, `font_size`, optional
   `page_height`, required `font` naming a registered family — without
   `font` there are no glyphs to draw, so it rejects rather than falling
   back to the 0.5em estimate) plus `{page, dpi?, color?, background?,
   max_dim?}`. Layout units are points de facto (sections `PageSetup` is
   points; US Letter default 612×792); `px = pt × dpi/72`, `dpi` default
   96. `format:"raw"` RGBA8 only in v1 — PNG output needs a `png`/flate2
   admission and is deferred (same class as the encoder decision's
   `prism:png` note). Proposed hard bounds, matching the folio-render
   §5 precedent: ≤4096 px per side, ≤32 MiB decoded RGBA, page index
   within the computed page count; `apply_long` row-band checkpoints.
   v1 renders the full layout page, origin top-left, no margins —
   `sections` `page_setup` binding is R3, and saying otherwise would
   claim geometry the engine does not model.
5. **Deferred honestly:** per-run `font_family`/`font_size`/`color`/
   `highlight`/`underline`/`strike` resolution (v1 uses the single
   `font` face and one `color` param — the same single-face
   simplification `layout` already documents); real line metrics
   (`LINE_SPACING` stays; R2 swaps `hhea`/`OS/2` metrics into BOTH
   `layout` and `renderPage` together so spans and pixels keep agreeing);
   sections `page_setup` binding — margins, columns, orientation,
   per-section pagination, headers/footers; synthetic bold/italic (no
   fake emboldening); TOC page numbers (the `{block,start,end}`→page
   mapping `layout` already returns makes them feasible once pagination
   is real — R3, not blocked on pixels); glyph caching; PNG output;
   hinting/subpixel/COLR bitmap strikes (the `swash` revisit);
   vertical text; embedded images/drawings; the paragraph-length
   shaping-cost follow-up from the shaping slice.

## Phased slice plan

- **R1 — pixels:** `glyphs.rs` positioned per-line shaping +
  skrifa-outline → tiny-skia coverage masks + `renderPage` engine op
  (raw RGBA, single face, `color`, `dpi`, bounds, checkpoints) + TS
  adapter method. Dep admission: `tiny-skia` +
  `packages/quill/THIRD_PARTY_NOTICES.md` update. `QUILL_DEFERRED_OPS.
  renderPage` lifts when the TS surface ships, per the folio-render
  precedent that the deferred map clears on adapter availability, not
  on engine admission.
- **R2 — fidelity:** real line metrics in `layout` and `renderPage`
  together; per-run `font_family`/`font_size` resolution with an
  explicit unregistered-family fallback policy (needs sign-off —
  propose: fall back to the first registered face and document it,
  since `layout` already requires an explicit `font`); run `color`,
  `highlight`, `underline`, `strike`; synthetic bold/italic decision.
- **R3 — document geometry:** `sections` `page_setup` binding
  (margins, columns, orientation, per-section pagination), headers/
  footers, TOC page numbers — completes H-15 including
  `NavigationOutline` thumbnails.
- **Beyond:** `swash` revisit for hinting/subpixel/bitmap strikes, PNG
  output, glyph caches, hostile-document cost caps, images, PDF export.

## Licensing

`tiny-skia` 0.12.0 is BSD-3-Clause — permissive, notice-only.
Transitives: `tiny-skia-path` (BSD-3-Clause, same repo), `arrayref`/
`arrayvec`/`bytemuck`/`cfg-if`/`log` (MIT/Apache-2.0/Zlib-class). The
optional `png` dep is excluded by `default-features = false`; the `simd`
feature is likewise pinned out so one scalar code path serves every
target — the same pinning discipline as skrifa's `autohint_shaping` and
harfrust's `icu`. Published 2026-02-02, far past the 7-day rule.
`skrifa`/`harfrust`/`sha2` notices already exist in
`packages/quill/THIRD_PARTY_NOTICES.md`; admission adds a tiny-skia
section there recording the resolved version, feature pin, and checksum
per the existing pattern. No GPL/AGPL enters this path.

## Open decision points — need user sign-off

1. **`tiny-skia` admission** (dep + feature pin) — recommended above;
   the in-repo rasterizer is the fallback if declined.
2. **Output field shape** — propose mirroring design `renderFrame`:
   `{page,width,height,pixels_b64?}` plus `CommandResult.output` when
   `binary_output` is set. Confirm names at admission.
3. **`dpi` default 96** and whether a `scale` alias is wanted
   (folio-render uses `scale|dpi`).
4. **R1 scope** — engine op + TS adapter + `QUILL_DEFERRED_OPS` lift in
   one slice, or engine-only first (folio-render admitted service and
   TS lift separately).
5. **Unregistered-family fallback policy** for R2 per-run resolution.
6. **`background`/`color` params** — proposed defaults: opaque white
   page, opaque black text; confirm before the op is written.
