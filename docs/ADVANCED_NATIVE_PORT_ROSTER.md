# Advanced native ports — 2026-11-04

NYC-Tron UI is the ONLY shared visual component owner. Nitro Forge owns document state, Rust/FFI/native processing, reliable media operations, saves and undo. This PR adds one real binding to existing Cadence Rust operations and records the remaining source-port integration work. Reference [NYC-Tron PR #2](https://github.com/mikevocalz/NYC-Tron-UI/pull/2).

## Actually implemented in this branch

- `@nitro-forge/cadence/instrument-adapter`: bounds-checked native UI binding from `InstrumentKnob` gain/pan to `CadenceDocument.setTrackGain` and `setTrackPan`. Exactly one engine mutation per completed control commit. UI never copies the engine's value.
- Vitest mock checks single-call routing and invalid value rejection. Real Rust and device validation must still be run in a consuming app.

## Upstream study and source-admission register

| Source | Target | Backend authority | Gate |
| --- | --- | --- | --- |
| AudioKit/Controls | Knob, XY pad, pitch/fine control | Cadence Rust / Prism Rust | Match platform gestures and semantics before copying MIT code |
| AudioKit/Flow | Typed cable PatchGraph GPU backend | Cadence/Materials processing core | Validate ports, undo/redo, cycle policy, high-edge rendering; not implemented |
| AudioKit/PianoRoll + AudioKit/Waveform | MIDI grid, waveform | Cadence + react-native-audio-api | Precise sample/beat mapping, actual audio data; not implemented |
| google/ink | Brush/ink prediction, palm rejection | Board/Skia native + device APIs | Muse stylus and PencilKit coexistence, real device tests; not implemented |
| MetalPetal + OpenColorIO | GPU images, LUT/proof | Prism/Splice engine backend | ICC/wide gamut correctness and crossplatform parity; not implemented |
| Mantis + uCrop | Crop UI and pixel operations | Prism engine, NOT UI preview | Real Prism crop op, immutable source, undo, encode; not implemented |
| Vico | Native charts | Tally Rust, consumer data model | Virtualized native chart, gesture and responsive card behavior; not implemented |
| google/filament | 3D viewer, PBR, rig/splat | Dedicated renderer SDK, external 3D model | iOS, Android, desktop and Viro interoperability; not implemented |
| CommunityToolkit/Windows + Win2D | WinUI/Fluent + graphics adapters | Windows platform adapter | File-level license and real WinUI build required; not implemented |
| ProCraft / FilmCraft / LightCraft | Brush, timeline, color | Existing Forge editors | Pin source file SHAs, notice review, actual native parity; not implemented |
| CapCraft | Optional speed curves and video FX | Splice native media backend | **AGPL-3.0** licensing, combined-work disclosure, corresponding source/build scripts; do not ingest into proprietary consumer until reviewed |

Top-level GitHub license badges alone are not file-level clearance. Mantis MIT, AudioKit MIT, google/ink Apache-2, OpenColorIO BSD-3, MetalPetal MIT, Filament Apache-2 are candidates; uCrop, CommunityToolkit, and Win2D require verification of actual license files and dependencies. No external source is copied in this branch.

## Critical missing engine operations

- Prism: implement a true layer-aware crop with explicit source vs output bounds and atomic undo. The UI's ImageCropOverlay only generates a normalized rectangle; `resize()` is NOT a substitute for arbitrary offset crop.
- Cadence: transaction/batch op for XY pad gain+pan; routing matrix and graph document, MIDI piano roll edit semantics, live audio lifecycle via react-native-audio-api.
- Splice: native decoder/seek/thumbnail/export transport using platform media APIs or Nitro; timeline pointer gestures must commit Rust edit commands, no expo-video.
- Tally: native frozen panes, keyboard and clipboard integration with source Rust workbook; Tally PR #39 already handles bounded visible grid windows. Do not duplicate.
- Board: native ink engine, source hardware Muse integration and cross-platform drawing parity; see existing Board and Muse draft PRs.
- Spatial: actual Viro/PICO/visionOS hand/gaze binding; NYC-Tron spatial ray math alone is not a compositor.
- Desktop: WinUI/AppKit/native popup adapters owned by NYC-Tron UI; Forge consumes, does not recreate.

## Prioritized merge gates

1. Review source licenses and SHAs, preserve AUTHORS/third-party notices and generated-source obligations.
2. Source and engine tests pass; no duplicate visual control implementations in Nitro Forge.
3. Device smoke on Android/iOS, genuine input gesture/multitouch/stylus and foldable hinge.
4. Native Windows/macOS, web/WASM and XR adapters validated per supported target.
5. API stability and separate editor package size recorded; stage a consumer app and release only after acceptance.
