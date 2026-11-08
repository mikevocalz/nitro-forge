# P-font-glyph-backend-decision

2026-11-08. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Evaluated against the engine contracts in
`docs/ARCHITECTURE.md`, the deferred-op tables in `docs/ENGINE_OPS.md`, and
the current text handling in `packages/quill`, `packages/design`,
`packages/draft`, `packages/pitch` and `packages/motion`.

## Current state — where the glyph gate actually sits

- **quill**: `layout` is a read-only greedy-wrap estimate using an average
  glyph width of 0.5em (h1=1.4x, h2=1.25x, h3=1.1x) — explicitly not font
  metrics (`docs/ENGINE_OPS.md` quill `layout` row). `listToc`/`insertToc`
  entries carry `{level,title,block}` with **no page numbers by design** —
  "hosts map `block` to page/offset geometry themselves" because Quill has
  no pagination engine. H-15 (`NavigationOutline`) needs `renderPage`
  thumbnails and TOC page numbers; both sit in `QUILL_DEFERRED_OPS`
  (`packages/quill/src/office-cluster.ts:20-24`, `renderPage: "H-15"`).
  DOCX import already reads direct Latin run fonts (`rFonts`/`sz`,
  `docx.rs:254-265`) — font *names* exist in the model; metrics do not.
- **design**: text nodes are layout boxes only. Hug sizing is a
  deterministic stub — width = longest line × char count × font_size × 0.6,
  height = lines × font_size × 1.2 — and `renderFrame` draws the fill as a
  plain rect, marking text `renderable:false`, "skips all glyph work"
  (`docs/ENGINE_OPS.md:1960`). Real font metrics are named a "Prism/font
  gate".
- **draft**: dimension annotations draw open chevron arrowheads only —
  "there is no glyph/text backend, so numeric labels and filled
  arrowheads are deferred (same gate as Quill fonts)"
  (`docs/ENGINE_OPS.md:2042`). Paper space (sheets/viewports, A7) admits no
  text entities yet; dimension/paper text both wait on the same gate.
- **pitch**: text objects store `{content,font_size,color,bold,italic}`
  only; `slideScene` is a structured read that "returns no pixels or
  thumbnail bitmap" — actual pixel output is the host's job via the Prism
  `flatten` path (`docs/ENGINE_OPS.md:1572`). No text-fit/auto-layout
  claims exist to defend, but any real text layout (auto-fit, wrap,
  speaker-notes rendering) inherits the same metrics need.
- **motion**: layers rasterize through Prism; there is no text-layer
  raster path today. Text layers would need glyph coverage/masks from the
  same backend eventually, but nothing currently claims it.

## Contract constraints that decide the shape

- Engines are synchronous, single-threaded, `Send`-only, **I/O-free**
  (`docs/ARCHITECTURE.md`). No engine may open font files or query the OS
  font database. Font *bytes* must arrive through `binary_input_ops` /
  `nf_v1_apply_binary` (256 MiB cap) or per-op payloads — the same
  precedent as `processPreview` (photo) and `renderFrame` binary output.
- Determinism is the contract: snapshot→restore→render must produce
  identical results on every target. Platform text stacks (CoreText,
  DirectWrite, Minikin, FreeType, browser `measureText`) rasterize and
  hint differently per OS — they cannot be the engine's source of truth
  for any value that feeds layout, pagination, or `renderFrame` output.
- Large binary assets already have a precedent for staying **host-owned**:
  the photo catalog stores descriptors + sha256 identity while originals
  remain host bytes (`docs/ARCHITECTURE.md` §photo). Fonts fit the same
  model: the document references font identity; the host owns the bytes.
- Read ops are eventless; a metrics lookup must not mutate journal state.
  Font registration, if it mutates document state, needs its own op +
  undo story; if it is host-side caching keyed by content hash, engines
  stay pure.

## Candidates

### (a) Engine-side font parsing — pure Rust, font bytes via binary op

| Crate | Version (2026-11) | License | Role | Notes |
|---|---|---|---|---|
| `fontations` (`read-fonts` 0.46 / `skrifa` 0.49) | active, MSRV 1.85 | MIT OR Apache-2.0 | OpenType parse + metrics + outline scale | `#![forbid(unsafe_code)]`; Google Fonts/Chrome-Android backend; tested vs FreeType |
| `harfrust` 0.15 | active, MSRV 1.85 | MIT | HarfBuzz port shaping (UPE units) | No ICU/Graphite2/CoreText integration — pure, deterministic |
| `ttf-parser` 0.25 | stable | MIT OR Apache-2.0 | metrics/outline fallback | No shaping, no rasterizer |
| `ab_glyph` 0.2.32 | maintained | Apache-2.0 | rasterizer + simple metrics | No complex shaping; superseded by fontations+swash for new work |
| `rusttype` 0.9.3 | stale (2022) | MIT/Apache-2.0 | metrics + analytic raster | ttf-parser era; do not admit for new work |
| `swash` 0.2.10 | active | Apache-2.0 OR MIT | glyph cache/rasterization | Optional feature of cosmic-text |
| `cosmic-text` 0.19 / `parley` 0.12 | active | MIT/Apache-2.0 resp. Apache/MIT | full layout engines | Both now harfrust+skrifa-backed; heavyweight, own their own buffer model — wrong fit for bounded engine reads |

**Platform matrix**: identical everywhere — pure Rust compiles for
iOS/Android/macOS/Windows/Linux/WASM with no FFI. This is the only option
that covers WASM at all.

**Determinism**: total, provided the same pinned font bytes are supplied.
Metrics and outlines derive only from the font file; no system discovery,
no hinting variance beyond what the code implements (skrifa autohint
shaping is a feature flag — pin it).

**Cost**: font bytes must be admitted per document (bounded, hashed);
engines gain a metrics service trait or a per-read font table passed in
the op payload. No I/O, no unsafe, snapshot stays font-identity-only.

### (b) Host-provided glyph metrics service — platform text stacks

CoreText (iOS/macOS), DirectWrite (Windows), Android Minikin via NDK,
FreeType (Linux/embedded), browser canvas/`measureText` (WASM/web).

**License**: system frameworks are fine; FreeType is FTL **or GPL-2** —
the GPL route contaminates; FTL is BSD-style and usable, but still a C
dependency per platform.

**Platform matrix**: N divergent implementations × 5 targets; WASM has
no system stack at all, so a pure-Rust fallback is mandatory anyway —
the matrix never converges to one implementation.

**Determinism**: fails the contract. CoreText vs DirectWrite vs FreeType
produce different advances, line breaks and raster output for the same
text. Acceptable for *host preview chrome* (what the user sees while
typing) but not for engine-owned pagination, TOC page numbers, or any
`renderFrame`/`renderPage` pixel that must match a snapshot.

**Cost**: per-platform native adapters, FFI boundary per engine consumer,
plus a WASM implementation regardless. Engines still cannot call it
directly (I/O-free) — it would feed values *into* ops, making the engine
a passive receiver of platform-dependent numbers. Rejected as the
source of truth; retained as an optional host-side preview accelerator.

### (c) Hybrid — host resolves fonts, engine owns layout

Host font service maps family name → font file bytes + metrics cache
(content-hash keyed, like the photo original store). Bytes enter engines
through binary ops; the engine runs deterministic layout/metrics with
the (a) stack on those exact bytes and returns structured results
(line spans, advances, positioned glyph runs, pagination). Rasterization
splits by need: glyph *outlines* from skrifa can rasterize through the
existing Prism path deterministically, or the host may rasterize for
display-only surfaces where parity is not claimed.

**License**: same pure-Rust stack as (a); platform rasterizers never enter
the engine.

**Determinism**: engine outputs are byte-identical across platforms for
the same font bytes. Host display may still diverge (OS text stack for
editing chrome) — that divergence is honest and already the pattern for
photo previews vs engine state.

**Cost**: one shared `FontService`/metrics contract + per-engine op
surface; bounded font admission; the largest single new subsystem, but
the only shape that satisfies every listed consumer.

## Decision

**Adopt (c), built on (a)'s stack**: `skrifa`/`read-fonts` + `harfrust`
(MIT/Apache-2.0 family) for metrics and shaping, font bytes host-supplied
through the existing binary-input channel, font *identity* (family +
content hash + face index) stored in document state — never the bytes.
Reject (b) as engine truth; allow platform stacks only for host-side
preview where snapshot parity is not claimed.

Per consumer, in dependency order:

1. **Shared metrics contract first** (unblocks design hug stub, draft
   dimension labels, pitch text fit): a read-path font table —
   `{family → [font bytes descriptors]}` supplied per call or registered
   once per session — feeding advance/line-height queries. Design's
   `renderable:false` and the 0.6/1.2 stub get replaced by real metrics;
   draft dimension text and paper-space text get a label-placement model;
   pitch gets measurable text boxes for `slideScene` consumers.
2. **quill `layout` + `renderPage` + TOC page numbers** (H-15): real
   greedy/knuth wrap on metrics, then pagination (page size already
   exists via `layout` params and section `page_setup`), then
   `renderPage` thumbnails via glyph outlines → Prism. Largest lift;
   `QUILL_DEFERRED_OPS.renderPage` is the tracking flag.
3. **design `renderFrame` glyph output**: text nodes stop being
   `renderable:false`; outlines → Prism strokes/fills. Deterministic
   because both the metrics and the rasterizer are pinned Rust.
4. **motion text layers**: last — needs glyph coverage as alpha masks;
   reuse the same outline path, defer until 1–3 land.

`cosmic-text`/`parley` are **not** admitted: they own buffer/layout state
and font discovery that violates the engine model; `harfrust`+`skrifa`
give the same shaping quality as composable primitives.

## Open decision points — need user sign-off

1. **Font licensing / redistribution** (blocking): which font files may
   ship embedded or be cached host-side. Options: open-licensed faces
   only (e.g. OFL families — bundling permitted with notice), user-supplied
   fonts only (no redistribution, user owns license), or system-font
   references by name with per-platform resolution (breaks determinism —
   not recommended for engine truth). This needs an explicit policy before
   any font bytes are admitted.
2. **Font storage boundary**: confirm font bytes stay host-owned with
   documents storing `{family, sha256, face_index}` descriptors only
   (photo-catalog precedent), vs embedding subsets into the NFD1 snapshot
   (snapshot bloat, licensing surface inside saved files).
3. **Shaping scope**: Latin-only first slice vs full `harfrust` coverage
   (bidi, Indic, Arabic). Recommend full harfrust — it is already the
   dependency cost of skrifa-era shaping; scoping it down saves nothing.
4. **Rasterization owner for `renderFrame`/`renderPage`**: engine-side
   skrifa outlines → Prism (deterministic, recommended) vs host-side
   platform raster (nicer hinting, breaks parity). Decide before design
   slice 3 and quill `renderPage`.
5. **Budgets**: proposed caps needing approval — ≤16 MiB per font face,
   ≤64 faces per document, ≤256 MiB total admitted font bytes per session,
   font table passed per read op ≤32 MiB (command JSON cap is separate;
   bytes go through the binary channel).
6. **Hinting/autohinting pin**: skrifa `autohint_shaping` feature and any
   stem-darkening/embolden parameters must be pinned in the dependency
   spec so two builds never disagree on metrics.
