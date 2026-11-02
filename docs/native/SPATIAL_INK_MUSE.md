# Logitech Muse spatial input for Nitro-Forge — integration contract

**Status: source implementation / draft.** This package is the portable input
boundary for board, whiteboard, canvas and drawing consumers. It does NOT create
a new editor or claim physical Muse pairing on non-Apple headsets.

## Sources inspected (2026-11-02)

- Apple WWDC25 "Explore spatial accessory input on visionOS": Logitech Muse,
  GameController events, ARKit/RealityKit spatial accessory tracking and haptics.
  https://developer.apple.com/videos/play/wwdc2025/289/
- `mikevocalz/viro` readmes/VISIONOS_SPATIAL_STYLUS.md: existing visionOS
  GameController / spatial accessory implementation; subscription stream.
- `mikevocalz/viro-external` packages/ui/src/MusePenInput.tsx and
  packages/xr-platform-contract/src/muse.ts: existing Moyo QuickDraw bridge.
- `mikevocalz/viro-external` packages/ui/src/quickdraw-input/
  createBoardInputRouter.ts: world-to-paper UV mapping and pointer ownership.

## Package boundary

`@nitro-forge/spatial-ink` is an **input adapter**, not another Bluetooth
stack, not an independent ARKit tracking session, and not a document engine.
On Vision Pro, the **native Viro bridge** owns GameController and ARKit.
Forge consumes a stream exposed by that already-native bridge. We do not
ship Apple's SDK binaries, fork Logitech SDK internals, or claim a separate
public Logitech Android SDK.

```
Logitech Muse (paired to Apple Vision Pro)
     | native sensor + visionOS accessory pose
Viro Swift/GameController + ARKit (existing)
     | subscribeSpatialStylus
@nitro-forge/spatial-ink
     | phase, world metres, side buttons, real pressure, timestampMs
Viro BoardInputRouter (existing)
     | calibrated UV / pointer capture
QuickDraw editor authority OR native editor (later)
     | document diffs + undo/collaboration
native board/canvas view (separate PR)
```

## Example consuming the already-native Viro API

```ts
import { subscribeSpatialStylus } from "@reactvision/react-viro";
import { subscribeMuseSpatialInk } from "@nitro-forge/spatial-ink";

const stop = subscribeMuseSpatialInk({
  subscribe: subscribeSpatialStylus,
  sideButtonsDraw: true, // opt in for existing XR ray workflows
  onEvent: (e) => router.handlePenSample({
    tracked: e.tracked,
    phase: e.phase,
    position: e.position,
    headPosition: e.headPosition,
    tipPressed: e.tipPressed,
    primaryPressed: e.primaryPressed,
    secondaryPressed: e.secondaryPressed,
    pressure: e.normalizedPressure ?? Number.NaN,
    timestamp: Date.now(), // deprecated field required by old router type
    timestampMs: e.timestampMs,
  }),
});
// call stop() on board teardown/unmount
```

Do **not** run the old `MusePenInput` and this new subscription for the same
board. Otherwise the same stylus signal will draw twice. Replace the old
converter at a single integration seam after a separate Moyo/Viro change.

## Event invariants and responsibilities

| Concern | Rule |
| --- | --- |
| Connectivity | Only Vision Pro via existing Viro native support is represented. |
| Pose | Metres, Viro session world frame; no normalized UV until router projection. |
| Pressure | Zero is real; missing/invalid is undefined, not a synthesized 0.5. |
| Buttons | Raw states stay separate. Side-button drawing explicitly opted in. |
| Hover | Valid unpressed tracked pose; drawing surface applies hover distance. |
| Stroke lifecycle | Down/move/up; cancel on tracking loss, bad pose or disposal. |
| Reconnection | Held pen cannot resume after a loss until release observed. |
| Time | Receive clock is monotonic, same clock domain as board router. |
| Ownership | Native subscribe/unsubscribe once per consumer; no duplicate listeners. |
| Geometry | Router owns transforms, projection, plane threshold, edge clamping. |
| Events | The input layer never persists snapshots or mutates board records. |

## Capability and platform matrix

| Platform | Input availability | Status |
| --- | --- | --- |
| Vision Pro, native Viro | Muse stream through GameController/ARKit | Source wired in Viro; hardware verification pending |
| Quest / Android XR / PICO | Different native input provider required | Muse direct pairing NOT VERIFIED |
| iOS/Android touch | Native touch or compatible stylus provider | Separate adapter needed |
| Browser | Pointer Events provider | Separate adapter needed |
| CloudXR/OpenXR | Remote host may expose stylus data | Do not assume local headset pairing |

The API is not a standalone Apple native binary. Its native source **already
lives in the Viro fork**. A future independent visionOS bridge (if needed)
must bind to the same contract with tested Nitro v1 generated headers, not
import 0.x Nitro types into the experimental v1 line.

## Acceptance checks

- [x] Typed stream contract and deterministic event conversion source
- [x] Unit-test cases for pressure, phase, side-button opt-in and tracking loss
- [x] Single unsubscribe/active cancel behavior in code
- [ ] CI result on this branch (not run when authored)
- [ ] visionOS SDK 26.2+ Xcode native build of actual Viro host
- [ ] Vision Pro paired Muse connect/disconnect and focus/immersive switching
- [ ] Device test pressure, tip accuracy, pose frame, side controls and haptics
- [ ] Test client integration (one Viro subscription / one board authority)
- [ ] Check 60/90/120 Hz input throughput, frame drops and no duplicated strokes
- [ ] Implement supported Android/Quest/PICO stylus providers independently

## Skills applied / engineering rules

This PR follows the same pinned playbooks used by the existing Nitro v1
FFI and C++ session drafts:

- Margelo **api-design**: explicit owned subscriptions, tight typed events,
  lifecycle idempotence, consumer/platform separation.
- Margelo **build-nitro-modules**: retain native ABI/codegen responsibility
  in the platform provider; no JS imitation of native tracking.
- Margelo **Swift**: use visionOS GameController/ARKit in the Viro Swift layer,
  not cross-platform Bluetooth assumptions.
- Margelo **Kotlin** and **C++**: keep future device providers and v1 bridge
  independent; do not mix Nitro 0.x and v1.
- Expo **expo-overview**: device SDK and Expo version parity must be proven in
  a dev client, not assumed from a JS compile.
- Callstack **react-native-best-practices**: native input source ownership,
  no per-sample React state/re-render, no UI-thread blocking.
- **No AI Slop**: accurately mark not-run gates and never claim hardware tests.

References:
https://github.com/margelo/react-native-skills/tree/main/skills
https://github.com/expo/skills
https://github.com/callstackincubator/agent-skills
https://github.com/petergyang/no-ai-slop


## Source-level CI evidence — November 2, 2026

The downstream native-board PR #16 contains a shared workflow that ran
`@nitro-forge/spatial-ink` TypeScript typecheck and Vitest successfully:
https://github.com/mikevocalz/nitro-forge/actions/runs/41474301108
This is **not** an Xcode visionOS build or real Muse pairing test.
