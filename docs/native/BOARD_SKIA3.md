# Forge native Skia v3 whiteboard/canvas

**Status: DRAFT / source and TS tests.** This PR is stacked on
[Forge board #18](https://github.com/mikevocalz/nitro-forge/pull/18), not
directly on master. It introduces a first-party native **2D** renderer for
phone, tablet, iPad and supported Apple / Android XR React Native views.

## Confirmed upstream version change

As of November 2, 2026, **Skia v3 is published as react-native-skia**, not
@shopify/react-native-skia. The latter stops at v2.14.0. See the
[official v3 migration](https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/)
and [v3 repo](https://github.com/wcandillon/react-native-skia).
v3 uses Graphite/Metal on Apple and Graphite/Vulkan on Android, with frames
recorded from React commits and replayed by native renderer threads.
We target a verified released v3.8.1, not a nonexistent @shopify 3.x package.

**Do not install both Skia packages in one app.** Moyo's existing app currently
uses the v2 namespace and must migrate in a separate controlled PR. This
package stays private/draft; no main app dependency is changed here.

## Implementation boundaries

- @nitro-forge/board-skia consumes augmented QuickDraw JSON snapshots
  produced by the existing Forge board encoder, not an HTML/WebView editor.
- NativeBoardCanvas renders with **react-native-skia**'s native Canvas/Path
  and SurfaceView on Android, via the v3 Graphite GPU backend.
- The **QuickDraw Store remains the only document authority**. This renderer
  is derived presentation state. It does not own undo, persistence, collaboration,
  tool changes, pressure sampling or spatial tracking.
- The Forge spatial-ink adapter in [#15](https://github.com/mikevocalz/nitro-forge/pull/15)
  feeds the existing Viro BoardInputRouter/QuickDraw Store; the native canvas
  then displays the Store's latest augmented snapshot. **No duplicate pen
  subscription or document**.
- No per-pointer React useState, native WebView, raw HTML, canvas mirroring,
  Android-only Viro surface dependency, or new Rust engine.

## Available shape parity in this first PR

| QuickDraw record | Native Skia behavior | Source |
| --- | --- | --- |
| Pencil / pressure draw | Closed outline from QuickDraw getInkOutline, exact preset palette | Existing Kotlin native renderer + QuickDraw 0.2 wire |
| Solid/dashed/dotted draw | Centerline path, rounded stroke, DashPathEffect | Existing QuickDraw shape wire |
| Highlighter | 4.5x size, alpha 0.55, Multiply, drawn below ordinary ink | BoardPalette/ShapePainter |
| Geo: rectangle, ellipse, triangle, diamond, hexagon, star | Native path, solid/semi/none fill and stroke | BoardGeometry/InkColor |
| Rotated ink/highlights/geo | Skia Group rotation around QuickDraw ShapeBounds local center; source-level tests | Native visual parity/device not yet proven |
| Text, notes, images, arrows, lines, pattern fill, geo labels | **Unsupported → fallback** | Needs native font/layout, asset and connector parity |
| Unknown record type / malformed or oversized input | **Unsupported → fallback** | All-or-nothing document fidelity |

The caller **must provide a fallback**, and NativeBoardCanvas uses it when
a document contains unsupported records or Graphite is unavailable. No user
strokes should silently vanish.

## Example (React Native dev build with Skia v3 and Forge #18)

  import { createInkOutlineEncoder } from "@nitro-forge/board";
  import { NativeBoardCanvas, compileQuickDrawScene } from "@nitro-forge/board-skia/native";

  // One source of truth, owned by the existing QuickDraw BoardSession.
  const snapshotJson = createInkOutlineEncoder(getInkOutline)
    .encodeSnapshot(session.store.getSnapshot());
  const scene = compileQuickDrawScene(snapshotJson);

  // Render at the board's real pixel extent. UI controls, overlay and input
  // still belong to the consumer; the fallback is the existing board.
  <NativeBoardCanvas
    scene={scene}
    width={1008}
    height={630}
    boardWidth={1008}
    boardHeight={630}
    fallback={<ExistingBoard />}
  />

The example is descriptive; `createNativeBoardSceneBridge` plus `ConnectedNativeBoardCanvas` now implement frame-coalesced Store subscription. The app still owns the single QuickDraw store and input callbacks.
Do not rebuild the whole scene on every 6DoF pen sensor sample.

## Platform scope

| Platform | GPU renderer | Verification |
| --- | --- | --- |
| iOS/iPadOS | Graphite + Metal (v3) | TS/replay only; device build NOT RUN |
| visionOS | native Skia RN view if the visionOS integration supports it | SDK/build/device NOT VERIFIED |
| Android >=26 with Vulkan 1.1 | Graphite + Vulkan | TS/replay only; device build NOT RUN |
| Android without Vulkan 1.1 | fallback required | No blank canvas |
| Web | separate Skia CanvasKit or existing QuickDraw implementation | NOT IN THIS PR |
| PICO/Quest in Viro 3D scene | requires native texture/panel interop on top | NOT IMPLEMENTED |

## Testing and merge gates

- [x] Pure scene compiler validates QuickDraw JSON, pressure outline geometry,
  draw ordering, named colors, known shapes and explicit unsupported conditions.
- [x] Native React Native Graphite Canvas source authored with fallback.
- [x] Zustand vanilla `createNativeBoardSceneBridge` subscribes to one QuickDraw Store, coalesces by display frame and cleans up listeners.
- [x] `NativeBoardCanvasWithInput` uses native RN Pointer Events; pointer coordinates map exactly once to board space, preserving pressure, cancellation and palm rejection. No WebView or second editor.
- [x] TypeScript, published Skia v3 types, and **14/14 replay tests PASS** ([CI 41479322871](https://github.com/mikevocalz/nitro-forge/actions/runs/41479322871)); three test files cover scene (including exact rotation pivots), frame-coalesced Zustand bridge, and native pen/touch input.
- [ ] Real Expo 58 + react-native-skia v3 native device compile on iOS / Android.
- [ ] Vision Pro visionOS Skia native view support demonstrated.
- [ ] Native font layout/image assets/arrows and on-device rotation visual parity.
- [ ] Compare Golden PNGs with QuickDraw (text/image/eraser/selection) and
      measure latency, FPS and memory at 60/90/120Hz.
- [ ] Moyo replaces its v2 @shopify Skia dependency safely with v3, without
      installing both native modules; device/build compatibility reviewed.
- [ ] Viro XR panel texture pass native Skia GPU output, zero-copy if supported.
- [ ] Consumer remains behind a rollback flag until same snapshot/undo/export
      and collaboration contract is demonstrated.

This new path is not a claim that a full whiteboard editor has been moved away
from WebView. It **is** a substantive native rendering start with explicit
fidelity fallbacks.

## Skills — pinned identical to Forge's earlier PRs

- [Margelo API design](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md): public typed contracts, all-or-nothing fallback.
- [Margelo build Nitro modules](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md): board source of truth stays outside generated native classes; no manual codegen.
- [Margelo C++](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/cpp/SKILL.md), [Swift](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/swift/SKILL.md), [Kotlin](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/kotlin/SKILL.md): platform correctness and native linkage remain separately gated.
- [Expo overview](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-overview/SKILL.md): dev client, not Expo Go.
- [Callstack React Native best practices](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md): no pen-sample re-renders; profile first.
- [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md): no unsupported 'production-ready' claims.

Relevant public sources:
https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/
https://wcandillon.github.io/react-native-skia/docs/group/
https://wcandillon.github.io/react-native-skia/docs/shapes/path/

## Isolated Android native build proof

`apps/board-native-lab` is a small Expo SDK 58 / React Native 0.88 dev app. It compiles the `@nitro-forge/board-skia` package with **Skia v3 only**, then attempts a real Android debug APK native build in [`.github/workflows/board-skia-android-build.yml`](https://github.com/mikevocalz/nitro-forge/blob/feat/board-skia3-native-canvas-2026-11-02/.github/workflows/board-skia-android-build.yml). It contains a sample pressure-ink path, native pointer wrapper and required fallback. It does not mount a second QuickDraw editor.

**SDK mismatch to resolve:** First runner attempt could not install `platforms;android-37` even though Expo 58's reference target expects compileSdk 37. The smoke lab temporarily uses SDK 36 (available to the runner) to isolate native linker behavior; a green SDK 36 build **would not** satisfy the Expo 58 SDK 37 release parity gate. Exact build outcome is reported by the workflow, not assumed here. Moyo Learn remains unchanged.
