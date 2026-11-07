# P02–P11 implementation map

2026-11-07. Scope is the ten original phases P02 through P11 in [PLAN.md](PLAN.md), with their existing exit criteria. This source inspection ran no tests, native builds or runtime scenarios and changes no completion or acceptance field.

These phases contain **228 canonical IDs**. NYC-Tron's current ledger records **217/217 library-scope implementations**; the other **11 IDs are engine/native integration rows**. All 228 rows retain `acceptance: unverified` in that ledger. Forge's formal phase statuses remain P02/P03 in progress and P04–P11 pending. The library implementation review and the full product/platform exit criteria measure different work.

Counts were joined by canonical ID between [components.json](components.json) and [NYC-Tron library-progress.json](https://github.com/mikevocalz/NYC-Tron-UI/blob/codex/complete-all-components/docs/completion/library-progress.json). A source candidate or an older fixture pass was not promoted to current production acceptance.

| Original phase | Canonical IDs | Library implemented / scope | Outside library scope |
| --- | ---: | ---: | --- |
| P02 Infrastructure | 15 | 8/8 | N-10, N-11, N-13, N-14, N-15, N-16, N-18 |
| P03 Decoder/playback | 3 | 2/2 | N-19 |
| P04 Shell/GUI | 30 | 30/30 | None |
| P05 Canvas/vector | 27 | 27/27 | None |
| P06 Brush/ink | 11 | 8/8 | N-01, N-03, N-04 |
| P07 Color | 27 | 27/27 | None |
| P08 Video | 41 | 41/41 | None |
| P09 Audio/MIDI | 41 | 41/41 | None |
| P10 Photo/RAW | 18 | 18/18 | None |
| P11 Motion | 15 | 15/15 | None |
| Total | 228 | 217/217 | 11 integration IDs |

## Per-phase implementation and exit work

### P02 — Shared platform and document infrastructure

Exit criterion: complete task/cancellation/cache/binary APIs, autosave/recovery, atomic gesture transactions, collaboration, file/share, keyboard and accessibility infrastructure.

Real source includes [autosave](../../packages/ignition/src/autosave.ts), [transactions](../../packages/ignition/src/transactions.ts), [collaboration](../../packages/ignition/src/collaboration.ts), [transfer](../../packages/ignition/src/transfer.ts), [native task control](../../packages/ignition/cpp/NitroForgeV1/TaskControl.hpp), [cache](../../packages/ignition/cpp/NitroForgeV1/ByteCache.hpp) and [binary document ABI](../../packages/ignition/cpp/NitroForgeV1/HybridForgeDocument.hpp). [P02.md](reports/P02.md) records earlier bounded native/storage evidence and its remaining limits.

Remaining exit work includes connecting recovery and transfer delivery into actual product hosts, completing cancellation and resource-lifetime paths through every participating native operation, resolving collaboration/realtime scope, and the required keyboard/accessibility/provider/platform checks. N-10/N-11/N-13/N-14/N-15/N-16/N-18 remain separate integration responsibilities. A native wrapper declaration does not certify those end-to-end paths.

### P03 — Decoder and playback foundation

Exit criterion: real Android/iOS/web decoding, native playback and frame-accurate seek, including cancellation, bounds, codec failures and lifecycle.

NYC-Tron has [platform decoder source](https://github.com/mikevocalz/NYC-Tron-UI/tree/codex/complete-all-components/packages/platform-services/src/media) and native AVFoundation/Android decoder implementations. Forge's [media-ui video source](../../packages/media-ui/src/video) and the locally preserved native-cadence acceptance work are active integration work; their working-tree presence does not certify a committed or accepted consumer. [P03.md](reports/P03.md) explicitly leaves public cancellation/player integration unfinished after its earlier debug-native decoder checks.

Remaining exit work is the real player/decoder/session ownership path, media-time seek and frame presentation, cancellation/disposal/error recovery and codec/platform acceptance. N-19 is the engine/native integration row. Reuse the existing native-media work; do not substitute a timeline cursor for decoded playback.

### P04 — Studio shell and advanced GUI foundations

Exit criterion: complete shell controls, commands, bounded unit inputs, real import/export delivery, overlay coordination, clipboard/drag-drop and workspace/document continuity.

All 30 reusable rows have implementation reviews. Forge has the [workspace](../../packages/studio-workspace/src/index.tsx), [layout model](../../packages/studio-workspace/src/model.ts), [strict UI host](../../packages/studio-workspace/src/nyc-tron-host.tsx), [document operation admission](../../apps/studio-preview/src/surface-admission.ts) and [preview file host](../../apps/studio-preview/src/main.tsx).

Remaining exit work is complete adoption of these ports by the product hosts, actual destination/share/clipboard/drag-drop providers, lifecycle/focus continuity and the required native/platform matrix. The recent preview source checkpoints are narrower than the original phase exit.

### P05 — Canvas, selection, layers and vectors

Exit criterion: real rendering, transforms, selection, masks, crop/encode, artboards and vectors with atomic undo and stable snapshots.

Prism supplies real [canvas bindings](../../packages/prism/src/canvas-cluster.ts), [rendering](../../packages/prism/rust/src/render.rs), [selection](../../packages/prism/rust/src/select.rs), [vectors](../../packages/prism/rust/src/vector.rs) and [document model](../../packages/prism/rust/src/model.rs). Its canonical state is more extensive than the controls currently exposed in [PrismEditor](../../packages/studio-workspace/src/prism-editor.tsx).

Remaining exit work includes composing every supported operation into the intended host, tracing the actual presentation/encoding/delivery provider paths and validating native graphics, text/input scaling, snapshot/undo and resource ownership. Existing CPU RGBA rendering and typed callbacks do not by themselves establish every GPU, image-file or platform path.

### P06 — Brush, ink, pen and timelapse

Exit criterion: brush/dynamics/taper/stabilization, all erase modes, hardware input/prediction/Muse and actual timelapse encoding.

The [library brush/ink report](https://github.com/mikevocalz/NYC-Tron-UI/blob/codex/complete-all-components/docs/completion/P06-brush-and-ink-batch.md) explicitly describes eight implemented controls, measured-versus-unknown stylus data, host-rendered previews and a required real encoder. N-01 pointer routing, N-03 Muse integration and N-04 palm rejection/prediction remain outside library scope.

The inspected Forge Prism API exposes pixel/vector operations, not a complete production brush/prediction/timelapse subsystem. Remaining exit work includes the production brush transaction/render pipeline, verified hardware samples/SDK integration, erase processing per supported mode and a real encoder producing a delivered media artifact. Smoothing a UI preview is not prediction or palm-rejection acceptance.

### P07 — Color and image processing

Exit criterion: color spaces/gamut/ICC/proof, swatches/gradients/mesh, histograms/curves/grading/scopes and actual eyedropper sampling.

Prism has [palette bindings](../../packages/prism/src/color-cluster.ts), [palette state](../../packages/prism/rust/src/colors.rs), paints/vectors and raster operations. The empty `PRISM_COLOR_DEFERRED_OPS` table covers that adapter's small palette contract; it does not certify all 27 color rows. The [library color-management report](https://github.com/mikevocalz/NYC-Tron-UI/blob/codex/complete-all-components/docs/completion/P07-color-management.md) explicitly assigns ICC loading/conversion, proof rendering, ink separation and measured gamut results to the host.

Remaining exit work includes those real processing providers, document/profile fidelity, measurement-backed scopes/sampling and native gamut/display acceptance. No ICC/RAW processing dependency was identified in the inspected Forge Rust manifests/lockfile.

### P08 — Timeline and video production

Exit criterion: every video component against real decoded media, effects, tracking/stabilization/captions, cache and encoded export.

Splice provides a real [timeline adapter](../../packages/splice/src/timeline-cluster.ts), [timeline engine](../../packages/splice/rust/src/lib.rs), tracks, annotations, transitions and atomic batches. The engine itself describes `renderPlan` as data for a compositor/encoder to consume; it performs no media decoding. [Splice detail composition](../design/SPLICE_DETAIL_PHASE.md) adds only the supported document controls.

`SPLICE_DEFERRED` still identifies compositor/render cache, decoder-derived thumbnails/peaks/probes, encoder/export, effects, stickers and keyframed speed gaps. Its decoder wording predates the separate platform decoder source: decoder availability and integration into Splice are distinct. Remaining exit work includes connecting that real media pipeline, implementing the missing processing/export consumers and validating frame/lifecycle/platform behavior. A transition diagram or render plan is not a program image.

### P09 — Audio, MIDI and recording

Exit criterion: playback/recording/device routing, automation/comping, MIDI/sequencer, latency/surround, offline DSP/model-backed features and valid audio export.

Cadence has real [DSP](../../packages/cadence/rust/src/dsp.rs), [rendering](../../packages/cadence/rust/src/render.rs), [analysis](../../packages/cadence/rust/src/analysis.rs), [mixer bindings](../../packages/cadence/src/mixer-cluster.ts) and [instrument bindings](../../packages/cadence/src/instrument-adapter.ts). [audio-ui](../../packages/audio-ui/src/index.ts) owns source-recording/capture abstractions; it is not a complete DAW/export/device-routing implementation. The [analysis composition report](../design/CADENCE_ANALYSIS_PHASE.md) lists its bounded scope and remaining work.

Remaining exit work includes the real native output/input/device host and interruption/routing ownership, recording/comping/latency/surround paths, supported sequencer/automation windows and rational meter coverage, file encoding/delivery and actual live measurement/model providers where required. Offline render values cannot be relabelled live meters. Hardware/native acceptance remains open.

### P10 — Photo catalog and RAW development

Exit criterion: catalog/version metadata and genuine RAW/develop/lens/mask/retouch/batch-export processing, with selected and verified dependencies.

All 18 UI rows are controlled library implementations. The [develop report](https://github.com/mikevocalz/NYC-Tron-UI/blob/codex/complete-all-components/docs/completion/P10-photo-develop.md) explicitly claims no RAW decode or processing. The [workflow report](https://github.com/mikevocalz/NYC-Tron-UI/blob/codex/complete-all-components/docs/completion/P10-photo-workflows.md) requires real host rendering/encoding and preserves original identity.

The registered [Photo engine](../../packages/photo/README.md) now supplies bounded original/version identities, metadata, ratings/labels and atomic snapshot/history (`40bfd4c`). The [isolated LibRaw proof](reports/P10-libraw-isolated-decode-source.md) decodes a genuine RAW and verifies an actual Prism pixel/snapshot roundtrip (`d902db3`). Production native decoder integration, durable original storage, non-destructive develop/mask/retouch/lens processing, ICC handling and encoded batch delivery remain open. The prototype is not a product dependency admission or full phase exit.

### P11 — Motion and compositing

Exit criterion: composition state, keyframes/easing/graphs/paths, 3D/cameras/lights, mattes/effects, bounded expressions, particles, nodes and render queues.

All 15 UI rows have implementation reviews, including real UI-side graph/curve/expression models. The [motion settings report](https://github.com/mikevocalz/NYC-Tron-UI/blob/codex/complete-all-components/docs/completion/P11-motion-settings.md) assigns simulation/rendering/graph validity to the host. The [render queue report](https://github.com/mikevocalz/NYC-Tron-UI/blob/codex/complete-all-components/docs/completion/P11-render-and-easing.md) requires actual encoders, destination artifacts and real progress.

The new [Motion backend](../../packages/motion/README.md) supplies bounded persistent 2D shape composition, scalar curves, read-only evaluation and actual Prism-rendered frames with atomic history/snapshots. See [source review](reports/P11-motion-independent-source-review.md). Product/native host integration, broader asset/compositing support, simulations/nodes/expressions, 3D presentation and an actual render/encode queue remain open.

## Delivery and acceptance rules for these ten phases

For each phase, retain its original exit criterion, commit the concrete implementation checkpoint and link its exact evidence. Additive library-implementation fields can reconcile the stale baseline without changing `completion`, phase status or platform gates. A new backend needs its own authoritative operations, snapshot/undo contract and admitted dependency/license closure before a UI host can use it.

Source builds and typechecks remain separate from runtime/native/provider/hardware checks. The latest selection authorizes focused P02/P03 validation and affected backend checks; broad P19 acceptance remains after review. Historical proof retains its original scope and source identity; it cannot certify later changes. Unavailable hardware, SDKs or dependencies remain explicit gaps. No phase in this map is promoted to complete.
