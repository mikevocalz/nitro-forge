# Native whiteboard/canvas extraction into Nitro-Forge

**Status: DRAFT / SOURCE PORT. Nitro v1 generator, TypeScript and JS replay CI passed; Android app linking, JUnit and headset validation NOT RUN.**
Issue addressed: Move the Moyo/Viro-specific native whiteboard rendering code
into a reusable, first-party `@nitro-forge/board` package with the same
document, ink and rendering semantics.

## Source-of-truth audit (November 2, 2026)

1. [Moyo Learn NativeBoardPaper](https://github.com/mikevocalz/moyolearn/blob/main/packages/app/features/tutor/native-board.native.tsx)
   uses a feature flag and mirrors WebView strokes into a second QuickDraw
   session. **Its WebView is still document authority today.** Extraction must
   not accidentally produce two sources of truth.
2. [Viro external native-panels](https://github.com/mikevocalz/viro-external/tree/main/packages/native-panels)
   already has a Kotlin Android 10+ hardware Canvas renderer, parser,
   overlay/painter, camera, resource lifecycle, Viro surface listener, Nitro
   v1 specs, QuickDraw snapshot/diff binding and JUnit tests.
3. [Viro external QuickDraw session](https://github.com/mikevocalz/viro-external/tree/main/packages/ui/src/quickdraw-input)
   already owns world→board UV transforms, capture/cancellation and strokes.
   **Do not duplicate that geometric mapping in this renderer.**
4. [Muse spatial-ink PR #15](https://github.com/mikevocalz/nitro-forge/pull/15)
   exposes the paired Muse stream and pressure from the existing Viro visionOS
   native GameController/ARKit bridge. Board consumption is a separate migration.
5. [Prism](https://github.com/mikevocalz/nitro-forge/tree/master/packages/prism)
   remains the raster document engine. This native whiteboard is a different,
   vector/shape/annotation document workload and does not change Prism's ops.

## What this PR actually moves

- **68** Kotlin whiteboard production source files from
  `viro-external/packages/native-panels/android/.../whiteboard` to
  `nitro-forge/packages/board/android/.../whiteboard` with a **new unique**
  `com.margelo.nitro.forgeboard` namespace (not the Viro-nativepanels ID).
- **15** JVM/JUnit tests for geometry, parsing, revision gates, layouts and
  asset handling in the new package.
- Dedicated Nitro v1 `WhiteboardRenderer` and `WhiteboardRendererFactory`
  specs and `NitroForgeBoard` native Android registration/CMake.
- A standalone QuickDraw `createWhiteboardRendererBinding`, ink outline
  encoder, optional headless editor source, React Native factory resolver and
  `useWhiteboardRenderer` hook. These import **no Moyo-specific application
  code**.
- Dual entry points: `@nitro-forge/board` (pure TS contracts) and
  `@nitro-forge/board/native` (React Native/Nitro-only).
- A draft validation workflow for Nitro v1 codegen, TS and replay tests.
- The source remains present in `viro-external` temporarily: this is a
  **non-breaking extraction**, not an executed consumer migration. Delete the
  old implementation only after the new package passes app/device parity.

## Architecture and ownership

```text
Moyo Learn / Moyo Studio / another consumer
   ├── One QuickDraw Store + BoardSession (document, undo, persistence)
   │     ├── native pointer/touch/gamepad/supported stylus
   │     └── @nitro-forge/spatial-ink (Muse on Vision Pro)
   │             └── EXISTING Viro BoardInputRouter world → paper UV
   └── @nitro-forge/board
         ├── frame-coalesced Store snapshots/diffs + cached ink outline
         ├── Nitro v1 WhiteboardRendererFactory/WhiteboardRenderer
         └── Android native hardware Canvas → Viro CanvasSurfaces → XR panel
             (future independent native 2D Surface and Apple renderer)
```

**Hard boundary:** QuickDraw Store is the **one editor authority**. The
Kotlin renderer owns a *copy* of records solely to draw pixels. It must never
independently commit strokes, undo, author collaboration diffs or persist a
different document. NFD1 and all seven Ignition Rust engines are unchanged.

The current Android renderer is genuinely native: Kotlin
`Surface.lockHardwareCanvas()` with path/text/shapes/ink/bitmap handling,
opaque render thread ownership, one coalesced redraw on changes and lifecycle
reactivity to a Viro-owned `CanvasSurfaces` surface. It does **not** render
HTML, run a WebView, or call back into React for every stylus sample.

This first source extraction is **not** a complete native 2D app view:
current Android output still needs a compatible Viro `CanvasSurfaces`
registry. A standalone React Native `SurfaceView`/Fabric view and a
Skia v3 Apple/visionOS renderer remain independent workstreams. The
library API is intentionally designed to accommodate both without replacing
the document format.

## Public API

```ts
import {
  createWhiteboardRendererBinding,
  createInkOutlineEncoder,
} from "@nitro-forge/board";
import {
  resolveWhiteboardRendererFactory,
} from "@nitro-forge/board/native";

// On Android with native Viro canvas surfaces, after Nitro v1 codegen/link:
const factory = resolveWhiteboardRendererFactory();
if (!factory) {
  // Keep current proven fallback; never render an empty board silently.
} else {
  const renderer = await factory.createRenderer({
    surfaceId, widthPx: 2016, heightPx: 1260,
    pixelRatio: 2, cornerRadiusPx: 0, backgroundColor: "#FFFFFF",
  });
  const binding = createWhiteboardRendererBinding({
    store: session.store,       // ONE shared document Store
    board: session.board,       // optional headless overlay/camera
    renderer,
    getInkOutline,              // QuickDraw's own strokeOutline
    requestFrame: requestAnimationFrame,
    cancelFrame: cancelAnimationFrame,
  });
  // The caller owns the lifetime:
  binding.dispose();
  renderer.dispose();
}
```

`@nitro-forge/board/native` is intentionally not imported from the main
entry point: Metro/web/CLI can load the portable API without evaluating
Nitro-generated code. The native factory is a capability gate, **not**
a blanket claim of platform support.

## Data contract & state transition rules

| Property | Rule |
| --- | --- |
| Snapshot | QuickDraw `{document:{store}}` JSON; full resync on first mount or lost surface |
| Diff | `{added,updated,removed}`; take second `updated` record and removal IDs |
| Ordering | Every accepted document revision strictly increases |
| Atomicity | Parse and validate an entire snapshot/diff before mutating native state |
| Vector ink | Attach cached `inkOutline` from QuickDraw's own stroke code |
| Pressure | Muse normalized measured pressure; do not invent missing readings |
| Camera | Finite `{x,y,z}`, `z>0`; selection/laser are overlay-only |
| Batching | Compose multiple store updates into one diff per frame |
| Invalid data | Current document retained and recoverable error surfaced |
| Surface loss | Suspend drawing; do not drop editor document; resync on return |
| Disposal | Remove listeners, stop handler thread, release paths and bitmaps |
| Images | App-private file/data URLs only, bounded cache; no network image fetch |
| Bounds | 32 MiB JSON, 50k records, 4 MiB overlay, 200k ink coords, bitmap budget |
| UI/renderer | Never maintain independent document or undo state |

## Moyo Learn migration: separate follow-up, no silent switch

1. Release Forge board after its Nitro v1 and native Android build gates pass.
2. Replace `@viro-external/native-panels` imports with `@nitro-forge/board/native`
   and keep the existing WebView fallback behind `nativeBoard=false`.
3. Replace the current `mirrorToNativeBoard` dual-session experiment with a
   **single** QuickDraw Store and headless board from the retained session.
   Screen/tool/Ask/undo/collaboration must all use that store.
4. Add `@nitro-forge/spatial-ink` from PR #15 at **one** Muse subscriber seam;
   do not mount it beside `MusePenInput` for the same board.
5. Run snapshot/diff migration against real prior Moyo boards. Compare rendered
   stroke bounds, tilt (when supported), pressure, eraser, shape, text, images,
   selection/laser, camera, undo/redo, export and late-joiner collaboration.
6. Confirm frame rate / input-to-ink latency, no duplicated strokes, stability
   after pause/recreate, orientation changes, shutdown/reconnect, remote edits.
7. Only then remove old Viro native-panels whiteboard code; leave unrelated
   Rive native-panels working. Keep rollback flag until parity is verified.

No hard cutover, no second persisted document, no WebView dependence for
**native drawing**, and no removal of existing Moyo capabilities.

## Platform, toolchain and support matrix

| Platform | Initial implementation | Status |
| --- | --- | --- |
| Android 10+ with Viro CanvasSurfaces (Quest/PICO capable) | Kotlin `lockHardwareCanvas` | Sources ported; Gradle/device NOT RUN |
| Android phone/tablet without Viro | standalone Fabric/SurfaceView target | NOT IMPLEMENTED |
| Vision Pro | Skia v3/Metal native renderer + same Store contract | NOT IMPLEMENTED |
| iPhone/iPad | Skia v3/Graphite native canvas | NOT IMPLEMENTED |
| Web/Next.js | TS document contract; WASM/native-web backend later | NOT IMPLEMENTED |
| Muse on Quest/PICO/Android XR | direct hardware accessory tracking | NOT VERIFIED/NOT CLAIMED |

Nitro v1 uses an **isolated exact prerelease**
`1.0.0-alpha.nightly.115.gcdaf72e60229`, matching Forge PR #8. Do not
install beside Nitro 0.x in any consuming React Native app. Source package
remains private/draft until clean Nitro v1 generator, Android linkage, Expo 58
consumer and hardware proof. Generated code is regenerated by `nitrogen`, never
hand-edited. Native constructors, Nitro ownership and listener cleanup must
match the generated headers, not 0.x docs.

## Reproducible checks

```bash
pnpm install --no-frozen-lockfile  # package is new; lockfile reconciliation pending
pnpm --filter @nitro-forge/board codegen
pnpm --filter @nitro-forge/board typecheck
pnpm --filter @nitro-forge/board test
# Android gradle/JUnit checks only inside a consumer with Viro AAR and Nitro
# v1 linking; testDebugUnitTest + assembleDebug required before merge.
```

### Acceptance / evidence gates

- [x] Existing source inventoried and cross-package document ownership defined.
- [x] Native Kotlin implementation and JVM tests copied to separate namespace.
- [x] Nitro v1 specs, package boundaries, Android linkage files authored.
- [x] JS QuickDraw binding/encoder source and mock tests added.
- [x] Workspace install + Nitro v1 codegen: 2/2 HybridObjects generated, outputs present ([CI run 41475556197](https://github.com/mikevocalz/nitro-forge/actions/runs/41475556197)). Native C++/Kotlin compilation remains unverified.
- [x] TypeScript and Vitest PASSED in CI ([run 41475556197](https://github.com/mikevocalz/nitro-forge/actions/runs/41475556197): 3/3 JS replay tests).
- [ ] Kotlin JUnit and Android Gradle assembleDebug PASS with Viro registry AAR.
- [ ] Device tests on Quest 3, PICO 4 Ultra and Android phone.
- [ ] iOS/visionOS Skia v3 native renderer (separate follow-up).
- [ ] Moyo migrated to one Store / native renderer without WebView authority.
- [ ] Performance/memory before-after against WebView: target >=60 FPS, no
      unbounded bitmap growth, input-to-ink p95 budget verified on device.
- [ ] No duplicated surfaces/subscriptions and safe loss/restore.
- [ ] Release/public package and consumer installation verified. Draft until then.

No unrun test is claimed passed. This port is substantive source extraction,
not a proof of production-native compatibility.

## Pinned skills followed (same as Nitro-Forge PRs #8–#10)

- [Margelo api-design](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md)
  — explicit public API, lifetimes, status variants, one document authority.
- [Margelo build-nitro-modules](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md)
  — generated spec vs implementation, unique hybrid namespace, Nitro worker/FFI gates.
- [Margelo Kotlin](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/kotlin/SKILL.md)
  — explicit HandlerThread ownership and deterministic dispose.
- [Margelo C++](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/cpp/SKILL.md)
  — register generated JNI, no new raw Rust/JSI ABI.
- [Margelo Swift](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/swift/SKILL.md)
  — follow-up Apple renderer scoped, no unverified Swift code advertised.
- [Expo overview](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-overview/SKILL.md)
  — Expo 58 dev-client integration needed.
- [Callstack React Native best practices](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md)
  — frame coalescing, surface lifetime, measurement not assumed performance.
- [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md)
  — real code, exact ownership, measured evidence vs not-run labels.

### Expanded real Kotlin source verification

[Actions 41481108441](https://github.com/mikevocalz/nitro-forge/actions/runs/41481108441) ran **47/47** original Kotlin/JUnit checks, compiling true parser, document, bounds and text-layout source with Gradle. No Android SDK JNI/Viro render integration was exercised.
