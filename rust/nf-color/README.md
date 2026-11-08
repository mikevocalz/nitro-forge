# nf-color — host-side ICC color-management provider

Provider crate for the P07 color pipeline, per
`docs/completion/reports/P07-icc-color-management-decision.md`. It wraps
**moxcms 0.8.1** (pure Rust, BSD-3-Clause OR Apache-2.0) and serves
bounded, synchronous CPU transforms over in-memory pixel buffers. It is
**not** an `ignition_core::Engine`: no `EngineKind`, no `Command`/`Journal`,
no `NFD1` snapshot, no document I/O — same contract class as `nf-raw`
(LibRaw) and `folio-render` (pdfium). Engines keep `rgba8-straight-sRGB`
as their single working space; this crate is the host-side provider the
NYC-Tron UI color controls (`ColorSpaceChooser`, `GamutWarning`,
`SoftProofControls`, `WideGamutChannels`, `PrintColorChannels`) call.

## API

```rust
pub struct Profile;               // built-in or Profile::from_icc(bytes)
pub struct Transform;             // cached src→dst transform, one intent
pub struct SoftProof;             // doc → proof → display chained transform
pub struct GamutMeter;            // src → proof gamut measurement
pub struct GamutReport;           // pixel counts + method descriptor
```

- `Profile::srgb() / display_p3() / rec2020() / adobe_rgb() / prophoto()` —
  moxcms-synthesized matrix/TRC profiles.
- `Profile::from_icc(&[u8])` — host-supplied ICC bytes, bounded by
  `MAX_PROFILE_BYTES` (8 MiB) with moxcms's CLUT/TRC parse caps. This is
  the untrusted-input surface; hostile profiles are rejected, never
  panicked on (see `src/tests.rs::mutated_profiles_never_panic`).
- `Transform::new(&src, &dst, src_channels, dst_channels, intent)` —
  channels are `Rgb`/`Rgba`/`Cmyk`/`Gray`/`GrayAlpha`, validated against
  each profile's declared colour space. `transform_u8` (interleaved
  `[0,255]`) and `transform_f32` (normalized `[0,1]` nominal, may emit
  extended-range values) return pixel counts.
- `SoftProof::new(doc, proof, display, intent)` then `transform_u8` /
  `transform_f32` — the C-25 chained transform; paper/ink simulation is
  profile-driven, no bespoke ink model.
- `GamutMeter::new(src, proof, src_channels, intent)` then
  `measure_f32(src, dst_scratch)` — C-10 measurement.

Rendering intents: `Perceptual` (default), `RelativeColorimetric`,
`Saturation`, `AbsoluteColorimetric`. Profiles lacking a requested intent's
LUT tags fail transform construction with `ColorError::Unsupported` /
`Transform` — moxcms maps AbsoluteColorimetric onto the colorimetric tags
and has no gamut-check flag, both documented behaviors.

## Bounds (fail-closed)

| Bound | Value |
|---|---|
| `MAX_PROFILE_BYTES` | 8 MiB per ICC profile (tighter than moxcms's 10 MiB default) |
| `MAX_TRANSFORM_PIXELS` | 16,777,216 px per call |
| `MAX_TRANSFORM_BYTES` | 64 MiB per buffer (f32 counted as 4 B/sample) |
| `GAMUT_EPSILON` | 1/255 f32 out-of-range tolerance |
| `GAMUT_ROUNDTRIP_DELTA` | 2/255 round-trip mismatch threshold |

## Gamut method (contract)

`GamutReport` counts pixels flagged by either of two methods on the f32
path (`extended_range` enabled so matrix-shaper transforms can emit
out-of-range values):

1. **out-of-range** — proof-space channel outside
   `[-GAMUT_EPSILON, 1+GAMUT_EPSILON]`.
2. **round-trip** — proof → source re-transform differs from the original
   by more than `GAMUT_ROUNDTRIP_DELTA` in any channel.

This is an approximation of lcms `cmsFLAGS_GAMUTCHECK`, not an equivalent;
the `method` string on every report states the thresholds. Measured
behavior on this host: Rec.2020 saturated primaries → sRGB proof flags 4/6
synthetic pixels via out-of-range; sRGB → sRGB measures clean; counts are
stable across intents within a small boundary tolerance (asserted in
tests).

## Not in v1 (per the decision record)

- No ICC-aware `encodePng`; no embedded profile chunk anywhere.
- No document-embedded color space, spot/ink model, or device-link /
  abstract / named-color profile support.
- No JSON-lines/binary host protocol yet — library API only; add one
  mirroring `nf-cli`/`folio-render` if a separate process is needed.
- No WASM measurement; moxcms is pure Rust so it should compile, but LUT
  build cost and bundle size are unmeasured.

## Fixtures & licenses

`tests/fixtures/` vendors real ICC profiles (see `THIRD_PARTY_NOTICES.md`
for per-file provenance): Compact-ICC-Profiles (CC0-1.0) matrix-shaper
profiles for sRGB/P3/Rec.2020/Gray, the moxcms project's own test assets
(`srgb_perceptual.icc` LUT profile, `hostile-*.icc` non-conforming cases),
and the LittleCMS testbed CMYK output profile `test1.icc`.

## Tests

```bash
cargo test -p nf-color     # 21 tests: parse bounds, hostile rejection,
                           # mutation fuzz-lite, all intents, RGB/CMYK/Gray
                           # transforms, determinism, soft-proof chains,
                           # gamut measurement, perf sanity
```
