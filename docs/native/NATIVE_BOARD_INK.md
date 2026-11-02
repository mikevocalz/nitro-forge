# Nitro-Forge native whiteboard / canvas + pressure ink

**Status: draft implementation, not a shipped editor.** PR is stacked on
`feat/spatial-ink-logitech-muse-2026-11-02` and adds the native renderer
and ink geometry. Source-level geometry tests are provided. No Xcode,
Android/visionOS device build, native event latency measurement or Moyo
end-to-end test has been run in this work.

## Sources inspected 2026-11-02

- `mikevocalz/moyolearn` packages/ui/whiteboard-board.native.tsx uses an
  embedded QuickDraw WebView as a **canonical editor**.
- Moyo `packages/app/features/tutor/native-board.native.tsx` has a **switch-
  gated** native Viro renderer but still **mirrors input to a second
  headless document**; WebView session owns save, undo, export, persistence.
- `mikevocalz/viro-external` has `QuickDrawNativeBoard`,
  `BoardInputRouter`, `useWhiteboardRenderer` and the Android native
  rendering implementation, as well as Muse input.
- `mikevocalz/nitro-canvas-in-Vision` has IOSurface-backed native
  `CanvasSurface`, designed for Viro canvasSource textures.
- React Native Skia **v3.8.0** (2026-10-24), package name
  `react-native-skia`, uses Skia Graphite on Metal and Vulkan.
  https://github.com/wcandillon/react-native-skia/releases/tag/v3.8.0
- Expo SDK 58 uses React Native 0.88 and React 19.3; install a proper
  native development build, not a 2.x Skia-enabled Expo Go.
  https://docs.expo.dev/versions/v58.0.0/

## Architecture and single-authority rule

```
Input: touch / controller / Logitech Muse
  -> @nitro-forge/spatial-ink (Muse phase/lifecycle for visionOS)
  -> existing Viro BoardInputRouter or board touch mapping
  -> Moyo board-session / QuickDraw editor (SINGLE authority)
       -> ordered immutable record/diff projection
       -> @nitro-forge/native-board frame
             -> NativeBoardCanvas (Skia v3 / Graphite)
             -> future native XR texture via Viro/native-panels
       -> undo / redo / remote diffs / save / snapshots / export
```

`@nitro-forge/native-board` is a render-only package with a pure TS
contract and a **real native 2D Skia Canvas** exported at
`@nitro-forge/native-board/native`. It draws pressure-sensitive lines,
single-point dots, rects and ellipses from ordered records.

The public frame is a **projection** of an existing document:
`NativeBoardFrame { width, height, drawables: [ ... ] }`.
No private editor, new document schema or competing undo stack is created.
The renderer does not decode QuickDraw snapshots itself; a separate
integration adapter must translate actual records/diffs, with stable IDs and
consistent order. Until this is finished, Moyo's existing WebView is the
fallback and authority. Do not feed strokes into two sessions.

### 2D native canvas use

```tsx
import { NativeBoardCanvas } from "@nitro-forge/native-board/native";

<NativeBoardCanvas
  frame={canonicalBoardFrame} // derived from existing QuickDraw store/diffs
  width={layoutWidth}
  height={layoutHeight}
  onPointer={(event) => {
    // One canonical editor input handler; no separate native document.
    existingBoardInput.dispatch(event);
  }}
/>
```

### Ink semantics and performance

- Surface transforms preserve uniform scale, centered letterboxing and the
  exact inverse touch mapping. Off-paper starts are ignored; captured strokes
  clamp on leaving the board.
- Stroke geometry is ordered and uses measured per-sample pressure for
  variable segment width. Invalid source pressure is not invented.
- Single-point strokes are rendered as native dots.
- Rect and ellipse records are rendered; text, images, complex shapes and
  eraser parity are **not implemented** in this initial render package.
- Rect/ellipse coordinates refer to the same document units as ink.
- View uses a single touch owner and sends events to `onPointer`. Muse is
  injected separately through the existing Viro board router on visionOS.
- Renderer runs natively with Skia Graphite and draws no HTML/WebView.
  The current JavaScript responder touch adapter is a prototype; production
  requires coalesced native stylus events, hover, palm rejection and native
  throughput measurements.
- Skia v3 supports zero-copy paths with react-native-webgpu/TypeGPU on
  supported devices, but no zero-copy texture handoff is implemented here.

## Why not replace the WebView editor in this PR?

Moyo's board-session persists QuickDraw snapshots/remote diffs and owns
undo/export/calibration. Overwriting that authority with a new Rust/native
document now would fork schoolwork history and break cross-device resume.
First prove an authoritative record projection and parity; then switch
the presentation for 2D and XR without changing the document.

PR separation:
1. PR #15 / `@nitro-forge/spatial-ink`: native Muse adapter.
2. This PR / `@nitro-forge/native-board`: Skia v3 native presentation/ink.
3. Follow-up Moyo/Viro integration PRs: canonical diffs/record projection,
   remove second headless document and WebView presentation behind a flag.
4. Follow-up Nitro v1 native SDK PRs: native shared texture/IOSurface through
   reviewed generated v1 FFI, once existing #8/#9/#10 are validated.

## Devices and compatibility

| Target | Native drawing route | Current proof |
| --- | --- | --- |
| iPad/iPhone Expo 58 | Skia v3 Graphite Metal | Source implemented; NOT BUILT |
| Android/API26+ Vulkan | Skia v3 Graphite Vulkan | Source implemented; NOT BUILT |
| Vision Pro | Viro canvasSource/IOSurface and Muse | Existing Viro SDK; this PR NOT linked |
| Quest 3 / PICO 4 Ultra / Android XR | Compatible renderer via native provider | Not tested / Muse pairing NOT supported |
| Web | Future WASM/CanvasKit fallback, same document | Not integrated |

## Integration plan / parity gates

- [x] Native-only `NativeBoardCanvas` source, pressure segments, dots and 2 shapes
- [x] Pure `NativeBoardFrame` / `NativeBoardPointer` contracts
- [x] Deterministic geometry / inverse projection tests added
- [x] Source-level CI workflow added (results NOT RUN at authoring)
- [ ] Regenerate/commit `pnpm-lock.yaml` under review before frozen installs
- [ ] Compile `native.tsx` against Skia v3.8 and Expo58 RN0.88 strict types
- [ ] iOS/Android dev client native build and render smoke, including memory
- [ ] Build canonical QuickDraw record/diff projection with stable z-order
- [ ] Native text, images, eraser/highlighter, selection, transforms and export parity
- [ ] Drop mirrored headless native session from Moyo while maintaining one authority
- [ ] XR Viro canvasSource and IOSurface/Graphite/Metal native texture wiring
- [ ] Muse hardware test: pressure, tracking loss, hover, reconnect, haptics
- [ ] Input latency/120 Hz sample rate; stroke quality/golden snapshots
- [ ] Undo/redo, remote collaboration, 2D/XR resume and snapshot replay parity
- [ ] Feature flag + graceful fallback on unsupported Vulkan/device loss
- [ ] Review codegen/ABI, ownership and native package licensing

## Same development skills and responsibilities as Nitro v1 PRs

| Skill | This PR's application |
| --- | --- |
| Margelo api-design | Immutable renderer contract, explicit input callback, one doc owner |
| Margelo build-nitro-modules | Native app/codegen is separate; no fake v1 HybridObject |
| Margelo C++ | Future IOSurface/Vulkan shared texture ownership + lifetime audit |
| Margelo Swift | visionOS native Muse/Viro SDK integration, Metal texture lifetime |
| Margelo Kotlin | Android Vulkan, stylus pressure, hover and native palm rejection |
| Expo overview | SDK 58/RN0.88 target; device-build evidence required |
| Callstack RN best practices | minimize JS->native round trips; no per-point useState |
| No AI Slop | No invented performance test, native compile or production claims |

Pinned references used by the prior Nitro v1 PRs:
- https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md
- https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md
- https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/cpp/SKILL.md
- https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/swift/SKILL.md
- https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/kotlin/SKILL.md
- https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-overview/SKILL.md
- https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md
- https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md


## Verified source-level CI evidence — November 2, 2026

The scoped GitHub workflow ran with both new packages and passed install,
`@nitro-forge/spatial-ink` TypeScript/Vitest and
`@nitro-forge/native-board` pure geometry TypeScript/Vitest:
https://github.com/mikevocalz/nitro-forge/actions/runs/41474301108

**Excluded from this success claim:** `native.tsx` typecheck against actual
Skia v3, Xcode/Gradle native linking, physical iPad/Android/Vision Pro,
Muse hardware, benchmark, snapshot/eraser/export equivalence and full app QA.
