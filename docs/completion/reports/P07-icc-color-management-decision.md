# P07 ICC color-management decision

2026-11-08. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Evaluated against `packages/prism/rust` and the
P07 ledger rows C-08 (`WideGamutChannels`), C-09 (`ColorSpaceChooser`),
C-10 (`GamutWarning`) and C-25 (`SoftProofControls`), all `blocked` on
"color pipeline" / "ICC profile handling (absent)".

## Current state

`prism-engine` rasterizes, composites, samples and encodes pixels entirely
in one declared space: packed straight-alpha sRGB RGBA8. `flatten` /
`samplePixels` return that space, and `encodePng` emits 8-bit RGBA PNG with
no ICC/gAMA/tEXt chunks by contract (`docs/ENGINE_OPS.md`). Raster assets
declare `rgba8-straight-srgb`; the develop recipe's white balance is an
explicitly non-ICC approximation. There is no profile storage, no transform
op, and no gamut/soft-proof surface anywhere in the engine.

The UI side is already further along than the ledger implies. The NYC-Tron
UI library ships C-07, C-08, C-09, C-10, C-14, C-15 and C-25 controls as
host-bound components; its color-management report
(`tron-complete/docs/completion/P07-color-management.md`) assigns ICC
loading/conversion, proof rendering, ink separation and measured gamut
results to the host. `ColorSpaceChooser` requests a profile change from
host-provided choices; `GamutWarning` displays actual engine-produced
counts; `SoftProofControls` requires a selected proof profile. What is
missing is the provider those controls call.

Engine constraints that bound the design (`AGENTS.md`,
`docs/ARCHITECTURE.md`): product engines are synchronous, single-threaded,
I/O-free `Send` state machines with `#![forbid(unsafe_code)]`; unsafe and
native FFI are confined to `rust/nf-sys` (engine FFI) and to explicitly
non-engine provider crates — `nf-raw` wraps LibRaw for RAW decode and
`folio-render` wraps pdfium for PDF rendering, both host-side services
outside `packages/*/rust`. `image` 0.25 (via `folio-render`) already pulls
`moxcms` 0.8.1 into the workspace lockfile.

## Candidates

| Approach | License | ICC coverage | Unsafe/FFI | Platforms |
|---|---|---|---|---|
| **moxcms** (direct dep) | BSD-3-Clause OR Apache-2.0 | Full ICC parse + transforms: RGB↔RGB, CMYK↔RGB/Lab, Gray↔RGB, any Display-class profile up to 16 inks; all four rendering intents (`Perceptual`, `RelativeColorimetric`, `Saturation`, `AbsoluteColorimetric`) | Pure Rust API; crate itself contains SIMD `unsafe` internally — acceptable as a dependency, not inside engine source | All Rust targets incl. WASM; zero native deps |
| **lcms2-sys** | MIT (lcms2) | Reference implementation: transforms, gamut-check flag (`cmsFLAGS_GAMUTCHECK`), proofing, named colors, thread/plugin model | C FFI — `unsafe` at every call site; requires vendored build via `cc`/`cmake` | All desktop + iOS/Android via vendored build; WASM needs emscripten port — heavy |
| **`color` crate** | MIT/Apache-2.0 | Fixed built-in spaces only; no ICC profile parsing | None | All — but insufficient: C-09 needs embedded/host ICC |
| **Host platform APIs** (CoreGraphics ColorSync, Windows WCS, Android ColorSpace) | System | Real ICC on OS, but divergent APIs and no uniform gamut/proof contract | FFI per platform | Rejected: N divergent implementations, no WASM story — same reasoning as the P15 platform-renderer rejection |
| **TS/JS color lib** (e.g. color.js) | Varies | ICC via `icc` WASM or pure JS | Runs in JS heap | Rejected for bulk pixels: per-pixel transform cost on megapixel rasters; keep for UI-only swatch math |

## Decision

**New host-side provider crate `nf-color` under `rust/`, wrapping
`moxcms` — engines stay untouched in v1.**

- `nf-color` is NOT an engine (same contract as `nf-raw`/`folio-render`):
  no Journal, no snapshot format, no document I/O. It owns profile bytes
  in memory, builds cached transforms, and serves bounded RGBA/CMYK buffer
  transforms over the existing host boundary (library API now, JSON-lines
  binary protocol later if a separate process is needed — mirroring
  `nf-cli`/`folio-render` host patterns).
- `prism-engine` keeps `rgba8-straight-sRGB` as the single document
  working space. No new `apply` op, no profile field in the NFD1
  envelope, no change to `samplePixels`/`encodePng` semantics in v1.
  Color-managed preview is a host-side transform of engine output
  pixels, exactly the boundary the NYC-Tron UI controls already assume.
- Profile scope v1: built-in sRGB, Display-P3, Rec.2020, Adobe RGB and
  ProPhoto (matrix/TRC profiles moxcms synthesizes) plus host-supplied ICC
  profile bytes for input/display/proof. CMYK transforms via ICC CMYK
  profiles (SWOP/FOGRA class) for C-07 PrintColorChannels preview.
- Gamut (C-10): moxcms has no `cmsFLAGS_GAMUTCHECK` equivalent; measure
  out-of-gamut by transforming into the proof/output space and flagging
  clipped/out-of-range channels, optionally cross-checked by a
  round-trip (proof → source) delta. Thresholds and method must be stated
  in the op contract — `GamutWarning` already distinguishes "unknown"
  from measured results.
- Soft-proof (C-25): chained transform document-sRGB → proof profile →
  display/sRGB with the control's selected rendering intent; paper/ink
  simulation is profile-driven (output profile encodes it) — no bespoke
  ink model in v1.
- Monitor/display profile: host supplies the OS display profile where the
  platform exposes one; absent that, transforms target sRGB and the UI
  labels the assumption. Web has no ICC display access — sRGB fallback is
  the honest default.
- `lcms2-sys` remains the fallback if moxcms gaps block a row (gamut-check
  fidelity, exotic device-link/abstract profiles, named-color support);
  it would live in `nf-color` behind the same Rust API, confined to the
  provider crate per the `nf-raw` precedent.

## What v1 must NOT claim

- No ICC-aware `encodePng` (still no embedded profile chunk); exporting a
  profiled PNG is a host-side concern until/unless a decided need exists.
- No document-embedded color space or spot/ink model (C-14/C-15 schema
  work stays separate; moxcms CMYK is process CMYK, not spot separations).
- No in-engine grading/levels/curves dependency on ICC — those filters
  operate in the declared working space; profile conversion brackets them
  host-side.
- No absolute colorimetric paper-white handling beyond what the intent
  flags provide; verify against moxcms behavior in the implementation
  spike before UI copy claims intent fidelity.

## Hard sub-problems flagged

- **moxcms version**: lockfile pins 0.8.1 transitively via `image` 0.25;
  pin the direct dep to the same version to avoid two copies, and re-check
  API/intent coverage on upgrade to 0.9.x (MSRV 1.89, edition-2024-era
  deps possible — verify workspace toolchain).
- **Gamut measurement correctness**: round-trip clipping detection is an
  approximation, not lcms gamut-check; P07 exit needs "measured gamut
  results" — the spike must demonstrate counts stable across intents and
  document the error bound.
- **Profile provenance**: host-supplied ICC bytes need size/parse limits
  and a declared trust posture (untrusted profile parsing is a fuzz
  surface; moxcms has fuzz targets — run them or vendor-corpus test).
- **Transform cost**: per-pixel ICC LUT transforms are heavier than the
  current byte pipeline; `nf-color` needs a budget (pixels/sec or
  megapixel cap) and possibly cached 8-bit LUT transforms — measure before
  wiring live preview.
- **WASM**: moxcms is pure Rust so web works, but LUT build cost and
  bundle size need measurement on the web target; keep TS-side fallback
  for swatch-only math.
