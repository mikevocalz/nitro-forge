# P10/P11 engine prerequisites and first vertical slices

2026-11-07. The plan below records the original missing responsibilities. Subsequent source checkpoints now register Photo (tag 7) and implement Motion (tag 8); required phase/platform acceptance remains open.

2026-11-07 update (`codex/w14-consumers`): all four newer kinds (photo, motion, design, draft) are now adopted by real consumers — the console demo covers all 11 engines end-to-end via nf-cli, and `STUDIOS`/app manifests/`ForgeDocumentStage`/shared editor configs expose them in the Expo example and studio-preview apps (generic rows/actions pattern, no dedicated surfaces). The Nitro kind boundary (types.ts, contracts.ts, generated `ForgeEngineKind.hpp` tags 7–10, `HybridForgeFactory.cpp`) already carried all four kinds; no regeneration was needed. This is consumption evidence only — it does not satisfy the P10/P11 vertical-slice exit gates below.

Photo's bounded catalog is committed in `40bfd4c`, with shared owning snapshot admission, stable originals/versions, ratings/labels and atomic history. See [registered catalog source](reports/P10-registered-photo-catalog-source.md). Genuine LibRaw decode and a Prism pixel/snapshot roundtrip passed in an isolated macOS prototype (`d902db3`); see [RAW proof and limits](reports/P10-libraw-isolated-decode-source.md). This does not supply a production native RAW provider, durable original store or develop pipeline.

Motion's bounded 2D composition backend adds real Prism frame rendering, rational timing, scalar hold/linear/Bezier curves and atomic snapshots/history. See [independent source review](reports/P11-motion-independent-source-review.md). Native app integration, full compositing and encoded output remain open. Source registration does not make an older native factory support the new engine kind.

## Shared integration work

The `photo` and `motion` identifiers must remain coherent across the following boundaries. Their source registrations are additive; consumers need a rebuilt matching native factory before use.

| Boundary | Existing files to extend or reuse |
| --- | --- |
| Engine model and validation | New product crate under `packages/<product>/rust`, following [Prism model](../../packages/prism/rust/src/model.rs) and [engine](../../packages/prism/rust/src/lib.rs) |
| Kind parsing and factories | [engine.rs](../../rust/ignition-core/src/engine.rs), [nf-cli factory](../../rust/nf-cli/src/main.rs), [nf-sys factory](../../rust/nf-sys/src/lib.rs), both host Cargo manifests |
| TS and native public kinds | [types.ts](../../packages/ignition/src/types.ts), [contracts.ts](../../packages/ignition/src/contracts.ts), [factory spec](../../packages/ignition/src/specs/ForgeFactory.nitro.ts) and [C++ mapping](../../packages/ignition/cpp/HybridForgeFactory.cpp) |
| Binary data paths | [binary dispatch](../../rust/nf-sys/src/ffi_binary.rs) and the existing native document binary API; new kinds/ops must be admitted explicitly |
| Operation inventory | [ENGINE_OPS.md](../ENGINE_OPS.md), new typed TS document API and bindings |
| Snapshot, history and batches | [NFD1 envelope](../../rust/ignition-core/src/envelope.rs), [Engine contract](../../rust/ignition-core/src/engine.rs), existing Journal and atomic batch semantics |

Regenerate the pinned Nitro v1 specs through the repository's generator; do not hand-edit generated enum/conversion files. Keep the compatible Expo host boundary isolated and preserve platform manifest, framework, app window and orientation contracts. The native host still owns each exclusive document worker. C++ resources follow RAII and owner-thread cleanup; callbacks and JS work do not run under an unrelated global mutex.

New Rust product engines remain synchronous, I/O-free and Send-only. Validate complete commands before recording one undo entry or changing state. Read-only evaluation/render queries preserve history and redo. Restore builds and validates scratch state before replacement. NFD1 is an envelope, not an engine discriminator: new payloads need an explicit kind/schema field and must reject an incompatible payload. Original assets and external native resource handles must not be serialized as live pointers.

## P10 — Photo catalog and RAW

### Actual missing responsibilities

A catalog needs stable photo/original/version identities, durable original references, metadata/rating/filter state, non-destructive develop settings and restoreable edit history. RAW decoding, camera metadata, demosaic, working-space conversion, lens processing, masks, retouch and output encoding need actual processing providers. The inspected Prism API supplies raster/vector primitives, not this complete photo pipeline.

Original storage and derived cache have different lifetimes. A MediaCache entry can be evicted; it is not a durable original. The host must own or retain a recoverable original artifact, its content identity and access capability across relaunch. The document stores validated references/settings. Decoder instances, file handles and pixel buffers stay with their native owners above replaceable UI.

### Verified decoder candidate

LibRaw is a candidate for RAW ingestion, not an admitted dependency. Its official documentation describes RAW reading/unpacking and metadata retrieval. The project states that its inherited basic conversion path is not intended as its production-quality rendering scope; a full develop engine still needs an explicit processing design. [Official overview](https://www.libraw.org/), [API documentation](https://www.libraw.org/docs).

The upstream distribution offers a choice of LGPL 2.1 or CDDL 1.0, with additional component notices in COPYRIGHT. Before integration, pin an exact source revision/archive hash, choose and record the distribution's license route, preserve the complete notice/dependency closure and review the selected linking/distribution configuration. This document does not grant license admission. [Upstream COPYRIGHT](https://github.com/LibRaw/LibRaw/blob/master/COPYRIGHT).

The documented C++ API includes `open_buffer`, `unpack`, memory-output operations, cleanup and cancellation/progress hooks. A proposed decoder should accept owned bounded bytes, run on its processing owner, return actual decoded metadata/pixels and report native errors. Verify cancellation behavior against the pinned implementation before mapping it to TaskControl. [Official C++ API](https://www.libraw.org/docs/API-CXX.html).

Use one decoder instance on its owner thread and bound decoded dimensions, working buffers and aggregate task memory before allocation. Cancellation must suppress stale publication and free temporary resources; a running native decode is only called cancelled when the decoder cooperates. [Official thread-safety and memory notes](https://www.libraw.org/docs/API-notes.html).

Official build documentation supplies Unix and Windows recipes and lists optional codec/color dependencies. That is not iOS/Android/WASM/Quest/PICO build proof. Target-specific compilation, ABI, C++ runtime, threading, optional OpenMP/codec configuration, artifact packaging and licensing need explicit validation. [Official build documentation](https://www.libraw.org/docs/Install-LibRaw-eng.html).

### First real vertical slice

1. Add a bounded photo-document crate/API with stable original/photo/version IDs, rating and metadata updates, a versioned develop-settings schema and atomic snapshot/undo/redo. Unsupported develop operations return explicit errors.
2. Admit and build the decoder provider for one initially declared target. Expose it through a generated Nitro processing contract and the existing owned binary transport. Keep original file acquisition/storage outside the pure Rust engine; do not send full RAW files as giant JSON/base64 payloads.
3. Import one licensed RAW fixture into durable original storage. Derive metadata and a real bounded preview from those bytes, record the original identity, and make the catalog point at that original. The preview must retain its declared channel format/profile semantics.
4. Connect existing PhotoLibraryGrid, metadata/rating and version controls to this actual document and preview provider. Save/reopen and undo preserve original identity; changing selection cancels publication from the previous import. A decoded preview may be a bounded pixel artifact before an output encoder is admitted. It is not batch-export completion.
5. After user review, run real fixture decode, corrupt/unsupported input, memory-limit, cancel/disposal, snapshot/restore and relaunch scenarios on the declared target. Then extend to the required platform matrix and additional formats/processing.

This slice establishes real original/catalog/decode ownership. It leaves production develop quality, ICC proof, lens profiles, masking/retouch, batch file encoding and broad camera/platform acceptance open. A settings-only catalog implementation may be a prerequisite checkpoint, but cannot be reported as this decoded-image slice or full P10 completion.

## P11 — Motion and compositing

### Actual missing responsibilities

The engine needs a persistent composition graph, stable layer/track/property IDs, rational frame timing, bounded keyframe/interpolation/expression rules, evaluator results and atomic history. Rendering, cameras/lights/3D, mattes/effects/particles/nodes, caches and encoder-backed render queues need execution providers. The existing reusable controls do not execute those systems by themselves.

Prism's [rendering](../../packages/prism/rust/src/render.rs), [geometry](../../packages/prism/rust/src/geom.rs) and immutable raster ownership are concrete implementation assets. Extract or expose a narrow renderer contract where appropriate; preserve source provenance and the existing engine behavior. Do not copy a second UI renderer or drive motion by editing a live global Prism document behind the composition engine's journal.

### First real vertical slice

1. Add a pure Rust composition document/API with bounded canvas dimensions, rational frame rate, duration and ordered solid/raster layers. Persist explicit kind/schema and asset identities. Add finite 2D position/opacity keyframes with initially declared hold/linear interpolation; unsupported curves/types remain explicit.
2. Implement read-only `evaluateFrame(frame)` over immutable document state. Use exact frame/rate conversion and deterministic ordering; cap graph depth, layers, keys and work. Evaluation cannot mutate the document or create history.
3. Render that evaluated 2D scene through a real bounded CPU raster path derived from the existing renderer. The first output is an actual declared-format frame buffer, not an inspector diagram or an animation of UI values. No new third-party renderer is required for this limited solid/raster path.
4. Connect CompositionTree, keyframe controls and a preview surface to the document. A minimal acceptance scene moves a solid between two positions over a known frame span; the evaluated midpoint and actual rendered pixels must agree before and after snapshot/restore. Undo changes the keyframe document, not only the displayed label.
5. After user review, validate malformed graph/snapshot rejection, missing assets, bounds, deterministic frame output, cancellation during multi-frame work and native presentation lifetime. Expand into curves, masks/effects, expressions, nodes, 3D and real encoded output as explicit later capabilities.

This slice deliberately does not enable unsupported particle, 3D, expression or encoder callbacks. A render queue becomes actionable only when its renderer/encoder produces a delivered artifact and truthful progress. Preserve real frame counts and cancellation ownership; do not synthesize completion timers.

## Entry gates and reporting

Both slices need reviewed op/schema limits, cross-engine restore rejection, one gesture/one undo semantics and direct typed bindings before the corresponding controls become enabled. New dependencies need exact source/license/build admission first. Source builds/types remain separate from later runtime/platform evidence. No P10/P11 phase or component is marked complete by this plan. The linked source and prototype reports define which backends and artifacts now exist and their remaining limits.
