---
name: skia-v3-graphite
description: Mandatory source and verification rules for building NitroForge editor renderers with react-native-skia v3 Graphite, React Native WebGPU/Dawn, TypeGPU and Rust image engines across iOS, Android and web.
---
# NitroForge Skia v3 / Graphite skill

## Read before touching a renderer
1. [Official Skia v3 migration guide](https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/) (package replacement, removed APIs, device min targets, GPU availability).
2. [Skia and React Native WebGPU compatibility matrix](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-native-skia) (matching Dawn version must be single-resolved).
3. [Skia v3 source](https://github.com/wcandillon/react-native-skia) and [RN WebGPU source](https://github.com/wcandillon/react-native-webgpu), relevant release notes.
4. [TypeGPU skill](https://github.com/software-mansion-labs/skills/blob/58afa0a09b01dc47819af8fd48bb062561414108/skills/typegpu/SKILL.md) whenever a TypeGPU pass is implemented.
5. [Callstack RN optimization](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md) for profiling.

## Version and API rules
- Use the current verified v3 **`react-native-skia`** package, not `@shopify/react-native-skia`; both libraries register the same native module. No v2 fallback in NitroForge editor renderer.
- PR #1 targets `react-native-skia@3.8.1` + `react-native-webgpu@0.19.2`, Expo SDK 58, RN0.88. Always verify against live npm registry *and* published Dawn pairing. A newer version is a reviewed change, not silently deployed.
- Use supported v3 `Canvas` props. `onSize` → `onLayout`; `opaque` moved to Android backing-view configuration; remove `colorSpace`, `debug`, `androidWarmup`. `makeImageSnapshotAsync` → v3 snapshot/readback pipeline; `Skia.Surface.Make` → `MakeRaster`. Inspect all direct imports before bulk rename.
- Skia v3 Graphite runs on Dawn/Metal (iOS) and Dawn/Vulkan (Android); Vulkan 1.1 / Android API26+ and iOS15.1+. Expo Go bundles v2; use a custom development build. A compatible web CanvasKit path is separate from native Graphite.
- `react-native-skia` and `react-native-webgpu` share GPU textures only with the same Dawn ABI. Rust `wgpu` textures are **not** automatically interchangeable; require explicit resource ownership, lifetime, threading and pixel parity tests before claiming zero-copy across Rust.
- Native canvas and its GPU loop must stop when hidden, on navigation, on device loss or on activity recreation. Freeze/suspense alone does not pause a worklet render loop.

## Implementation sequence
1. Inspect `docs/ARCHITECTURE.md` / `docs/ENGINE_OPS.md`, ensure engine state remains in Rust and no duplicate editable canvas state in Zustand.
2. Create CPU-reference image tests for known engine operations and bound input sizes. Snapshot/edit/undo/reopen/export must reproduce the expected pixels or bounded differences.
3. Build native Nitro v3 renderer, render a real `Prism` document, handle explicit session and GPU ownership; expose a bounded, cancellable dirty-tile path.
4. If using shared textures, verify one Dawn resolution via `pnpm why react-native-webgpu-dawn`, and show explicit texture producer, consumer and close cleanup. Do not assume JS `GPUDevice` is a Rust `wgpu::Device`.
5. Validate native iOS, Android and web *independently*. Simulator screenshot parity is not physical Metal/Vulkan perf proof; browser CanvasKit may have different GPU/CPU paths.

## Mandatory acceptance evidence
- Exact npm versions, `pnpm-lock.yaml` SHA and native dependency graph, resolved Dawn version; frozen installation.
- iOS Xcode build/pod install and physical Metal device; Android API26+, Vulkan 1.1 device and Gradle build; GPU unavailable state. `Skia.gpu.isAvailable` must be handled without silently blanking the editor.
- Web bundler, SSR-safe import and real browser canvas render.
- Raster parity and snapshot encoding, format round-trip, cancellation, memory pressure, texture deallocation and device-loss recovery.
- Profiling traces: JS/UI/renderer frame time, major memory allocations, texture leak count; record actual numbers, never claim “zero-copy” or “60 fps” without evidence.
- Import and API migration audit including missing `Skia.Video` / removed native buffer / deprecated `Canvas` props.
- Only mark complete after verified native/editor use; package presence or CI manifest test alone remains `NOT RUN` for runtime tests.
