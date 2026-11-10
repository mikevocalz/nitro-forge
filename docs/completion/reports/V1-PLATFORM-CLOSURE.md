# V1 platform closure

Updated 2026-11-10. The user approved finishing all twelve platform/service rows
alongside the NYC-Tron v1 candidate. The frozen 341-ID roster and all eight required
platforms remain unchanged. Source ownership and fully accepted delivery are
recorded independently.

## Candidate revisions and evidence

- [Forge PR #70](https://github.com/mikevocalz/nitro-forge/pull/70) builds on Board PR #69; native/MMKV source checkpoint `cc4893b29f6182c71705a64785a41f5bbf3f5507` (following the first checkpoint `23f08c3b050c766222e5a8f33386fcca7bb8b6ac`).
- [NYC-Tron PR #57](https://github.com/mikevocalz/NYC-Tron-UI/pull/57), source/API/runtime-gate checkpoint `2449fe53f84ef4822e7eb8d275b0c1a6e440560f`.
- [Viro PR #86](https://github.com/mikevocalz/viro/pull/86), actual Muse pose provider `e84a1a9a37168a835f7730e09016917b9d49c6ef`.

The synced NYC-Tron inventory now records 332 local implementations and nine
pinned external implementations: all 341 original IDs have reviewed source
ownership. N-10 includes the actual MMKV 4.3.2 binding port to Nitro 120,
including SwiftPM/JNI registration and the public all-engine
`@nitro-forge/ignition/autosave/mmkv` adapter. Native compilation and two-process
runtime acceptance remain separate checks. Component completion stays
in-progress until every mandatory gate has its own passing evidence.

The source synchronization tool checks committed inventory bytes, exact 341 IDs,
original baseline hash, names/phases, safe owner paths and immutable revisions.
It copies source ownership only. Regression tests verify that supplied acceptance
claims cannot change component, phase or platform acceptance records.

See [native service evidence](../../recovery/V1_INFRASTRUCTURE_ACCEPTANCE.md) for
actual Rust/C++/TypeScript commands and limits. The
[native runtime workflow](../../../.github/workflows/cadence-native-consumer.yml)
launches the generated native Factory on iOS/Android and retains revision-bound
reports, logs and screenshots. All fourteen non-native source/adapter/ledger
workflows passed at the MMKV checkpoint; the native consumer install/type/port
job and both native app jobs passed in [run 42759521341](https://github.com/mikevocalz/nitro-forge/actions/runs/42759521341).
The tested merge was `aa11c3b3b3b9170a48c4ecfef8ae2a1ad3ed0533`, distinct from
the candidate head. [Android receipts](../evidence/v1-native-cc4893b/android/provenance.json)
and [iOS receipts](../evidence/v1-native-cc4893b/ios/provenance.json) retain the
three initial write checks and fifteen final checks, all eleven engine kinds,
a common run nonce and distinct process identities across OS termination/relaunch.
The actual generated objects also passed binary ownership, cache bounds/LRU,
FIFO close, task cancellation and snapshot lifetime checks. This proves those
scoped emulator/simulator behaviors; it does not establish sudden-power-loss
durability or the complete eight-platform matrix.

The later [native run 42765520077](https://github.com/mikevocalz/nitro-forge/actions/runs/42765520077)
also passed all three jobs at `f5469d03cf2153a8f694ae61d911861264e9216d`,
with tested merge `7cc6c15805b20ae69804be9cbf526ae48a4f1a63`. Both mobile jobs
completed the three write checks, OS restart and fifteen final checks for all
eleven engines. Its [original receipts and artifact verification](https://github.com/mikevocalz/NYC-Tron-UI/tree/e2b65dd5e9288b193b6bfd807d6003b184b8c642/docs/completion/evidence/v1-forge-f5469d0)
are retained in the coordinated NYC-Tron candidate. All fourteen non-native
workflows passed at the same head. The optional iOS screenshot was unavailable;
this receipt establishes native runtime behavior without a visual acceptance claim.

## Ownership and scope

NYC-Tron owns generic native input, presentation and platform media. Forge owns
engines, authoritative documents, transactions, binary transport, scheduling,
cache, offline/collaboration integration and telemetry. Muse uses the existing
Viro platform provider. The app owns navigation, permissions, storage scope,
backend credentials and immersion. No new editable document, engine import into
NYC-Tron, artificial pose, or in-memory substitute is used as completion evidence.

## N-01

**NativePointerRouter.** Owned UIKit, Compose and DOM pointer adapters now exist in NYC-Tron; physical hover/pressure/tilt, hardware-keyboard and assistive-technology matrix remains unverified.

Public/native source is owned by NYC-Tron at the pinned inventory revision:

- [packages/native-controls/src/NativePointerInput.tsx](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/src/NativePointerInput.tsx)
- [packages/native-controls/src/NativePointerInput.web.tsx](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/src/NativePointerInput.web.tsx)
- [packages/native-controls/src/pointer-input.ts](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/src/pointer-input.ts)
- [packages/native-controls/ios/TronPointerCaptureView.swift](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/ios/TronPointerCaptureView.swift)
- [packages/native-controls/android/src/main/java/com/nyctron/instruments/TronPointerCaptureView.kt](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/android/src/main/java/com/nyctron/instruments/TronPointerCaptureView.kt)

## N-03

**LogitechMuseSpatialInk.** Actual Viro ARKit/GCStylus pose now provides validated orientation and tip pressure; Muse six-DoF and tracking-loss behavior still needs supported physical visionOS hardware.

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/spatial-ink`.

- [packages/spatial-ink/src/muse.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/spatial-ink/src/muse.ts)

Owner: `mikevocalz/viro` at `e84a1a9a37168a835f7730e09016917b9d49c6ef`. Public imports: `@reactvision/react-viro:ViroVisionOSModule`.

- [ios/ViroReact/VisionOS/ViroSpatialStylusPose.swift](https://github.com/mikevocalz/viro/blob/e84a1a9a37168a835f7730e09016917b9d49c6ef/ios/ViroReact/VisionOS/ViroSpatialStylusPose.swift)
- [ios/ViroReact/VisionOS/ViroImmersiveRenderer.swift](https://github.com/mikevocalz/viro/blob/e84a1a9a37168a835f7730e09016917b9d49c6ef/ios/ViroReact/VisionOS/ViroImmersiveRenderer.swift)
- [components/VisionOS/ViroVisionOSModule.ts](https://github.com/mikevocalz/viro/blob/e84a1a9a37168a835f7730e09016917b9d49c6ef/components/VisionOS/ViroVisionOSModule.ts)

## N-04

**PalmRejectionAndPrediction.** Observed coalesced/history samples and SDK predictions are separated; palm and pressure/tilt behavior on supported physical devices remains unverified.

Public/native source is owned by NYC-Tron at the pinned inventory revision:

- [packages/native-controls/src/pointer-input.ts](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/src/pointer-input.ts)
- [packages/native-controls/ios/TronPointerCaptureView.swift](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/ios/TronPointerCaptureView.swift)
- [packages/native-controls/android/src/main/java/com/nyctron/instruments/TronPointerCaptureView.kt](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/android/src/main/java/com/nyctron/instruments/TronPointerCaptureView.kt)

## N-09

**XRPresentationAdapter.** Typed optional Viro image renderer adapter now owns frame and native-load lifetimes; headset rendering/input/lifecycle/performance acceptance remains unverified.

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/board/xr`, `@nitro-forge/board/xr/viro`.

- [packages/board/src/xr/presentation.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/board/src/xr/presentation.ts)
- [packages/board/src/xr/ViroDocumentSurface.tsx](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/board/src/xr/ViroDocumentSurface.tsx)

## N-10

**OfflineCheckpointAndAutosave.** The candidate contains the MMKV v4.3.2 Nitro 120 binding/SwiftPM/JNI port, the scoped all-engine MMKV storage adapter, and the repaired Board MMKV/Yjs adapters. The Linux gate compiles installed C++ against the actual host and reopens real MMKVCore storage in a second process. The native runner requires three write checks, OS termination, a distinct process token, and fifteen final checks covering all eleven engine kinds. Actual iOS and Android binding execution passed in run `42759521341`; the original revision-bound receipts are linked above. Sudden-power-loss and the remaining platform matrix need separate evidence. See the [MMKV port and evidence guide](../../native/MMKV_V1_PORT.md).

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/ignition/autosave`, `@nitro-forge/ignition/autosave/mmkv`, `@nitro-forge/board/offline/mmkv`.

- [packages/ignition/src/autosave.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/src/autosave.ts)
- [packages/ignition/src/autosave-mmkv.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/src/autosave-mmkv.ts)
- [packages/board/src/offline-mmkv.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/board/src/offline-mmkv.ts)
- [examples/native-cadence/patches/react-native-mmkv@4.3.2.patch](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/examples/native-cadence/patches/react-native-mmkv@4.3.2.patch)
- [examples/native-cadence/verify-board-offline.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/examples/native-cadence/verify-board-offline.ts)
- [examples/native-cadence/verify-native-runtime.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/examples/native-cadence/verify-native-runtime.ts)

## N-11

**CollaborationAdapter.** All eleven engine collaboration envelopes and real Yjs merge/reconnect/reopen adapters exist; authenticated multi-device/product transport and wider platform recovery evidence remain unverified.

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/ignition/collaboration`, `@nitro-forge/ignition/collaboration-http`, `@nitro-forge/board/offline/yjs`, `@nitro-forge/board/offline/sync`.

- [packages/ignition/src/collaboration.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/src/collaboration.ts)
- [packages/ignition/src/collaboration-http.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/src/collaboration-http.ts)
- [packages/board/src/offline-yjs.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/board/src/offline-yjs.ts)
- [packages/board/src/offline-sync.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/board/src/offline-sync.ts)

## N-13

**LongTaskScheduler.** Native queue/task source and Rust/C++ contract checks pass. Generated native objects passed running/queued cancellation, FIFO close and snapshot lifetime checks on both iOS and Android in run `42765520077`. Product latency/suspend/resume on the complete device matrix remains unverified.

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/ignition/nitro`.

- [packages/ignition/src/specs/ForgeTask.nitro.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/src/specs/ForgeTask.nitro.ts)
- [packages/ignition/cpp/NitroForgeV1/HybridForgeTask.hpp](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/cpp/NitroForgeV1/HybridForgeTask.hpp)
- [packages/ignition/cpp/NitroForgeV1/SerialQueue.hpp](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/cpp/NitroForgeV1/SerialQueue.hpp)

## N-14

**MediaCache.** Native byte/metadata bounds, LRU and allocation-failure safety have tests. Both mobile native jobs passed cache ownership, bounds/LRU and FIFO-close checks in run `42765520077`. Physical-device memory-pressure budgets remain unverified.

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/ignition/nitro`.

- [packages/ignition/src/specs/ForgeMediaCache.nitro.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/src/specs/ForgeMediaCache.nitro.ts)
- [packages/ignition/cpp/NitroForgeV1/ByteCache.hpp](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/cpp/NitroForgeV1/ByteCache.hpp)
- [packages/ignition/cpp/NitroForgeV1/HybridForgeMediaCache.hpp](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/cpp/NitroForgeV1/HybridForgeMediaCache.hpp)

## N-15

**UndoTransactionCoordinator.** Engine-side batch transactions cover all eleven engines; reentrant gesture/close lifetimes are fixed. Product undo/reopen interaction acceptance remains unverified on the complete platform matrix.

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/ignition/transactions`.

- [packages/ignition/src/transactions.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/src/transactions.ts)
- [rust/nf-sys/src/batch_tests.rs](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/rust/nf-sys/src/batch_tests.rs)

## N-16

**NativeBinaryTransport.** Owned native ArrayBuffer request/result/checkpoint lifetimes have Rust/C++ checks. Both mobile native jobs passed input/output ownership, restore ownership and output lifetime after document close in run `42765520077`. The transport uses owned copies; full device memory/latency evidence remains unverified.

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/ignition/nitro`.

- [packages/ignition/src/specs/ForgeDocument.nitro.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/src/specs/ForgeDocument.nitro.ts)
- [packages/ignition/cpp/NitroForgeV1/HybridForgeDocument.hpp](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/ignition/cpp/NitroForgeV1/HybridForgeDocument.hpp)

## N-18

**TestAndTelemetryAdapter.** Consent-period ownership, bounded queues and redacted failures are implemented/tested. Product consent UX, configured sink and physical device traces remain independent acceptance work.

Owner: `mikevocalz/nitro-forge` at `cc4893b29f6182c71705a64785a41f5bbf3f5507`. Public imports: `@nitro-forge/telemetry`, `@nitro-forge/telemetry/testing`.

- [packages/telemetry/src/telemetry.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/telemetry/src/telemetry.ts)
- [packages/telemetry/src/instrument.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/telemetry/src/instrument.ts)
- [packages/telemetry/src/testing.ts](https://github.com/mikevocalz/nitro-forge/blob/cc4893b29f6182c71705a64785a41f5bbf3f5507/packages/telemetry/src/testing.ts)

## N-19

**NativeMediaDecoderSurface.** Actual AVFoundation and Android frame/audio decode exist; clean installed-tarball launch gates verify JPEG/PCM/media-time behavior. Native output/lifecycle and assistive-technology acceptance remains evidence-gated.

Public/native source is owned by NYC-Tron at the pinned inventory revision:

- [packages/platform-services/src/media/index.ts](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/platform-services/src/media/index.ts)
- [packages/platform-services/src/media/index.native.ts](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/platform-services/src/media/index.native.ts)
- [packages/platform-services/ios/NYCTronMediaDecoderModule.swift](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/platform-services/ios/NYCTronMediaDecoderModule.swift)
- [packages/platform-services/android/src/main/java/com/nyctron/platformservices/AndroidMediaDecoder.kt](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/platform-services/android/src/main/java/com/nyctron/platformservices/AndroidMediaDecoder.kt)
- [packages/native-controls/src/NativeVideoPlayer.tsx](https://github.com/mikevocalz/NYC-Tron-UI/blob/2449fe53f84ef4822e7eb8d275b0c1a6e440560f/packages/native-controls/src/NativeVideoPlayer.tsx)

## Release boundary

The complete implementation target remains 341 components. None is silently marked
fully accepted by this source checkpoint. Physical Muse/pen/fold/headset interaction,
assistive-technology speech, product integration, per-device performance budgets and
owner distribution review require their real evidence. Prerelease candidate packages
and native test artifacts can be built while those records are collected; stable
publication must not infer them from a compile or source count.
