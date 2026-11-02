# Forge Board — scoped implementation roster

| Workstream | Deliverable | Evidence at PR creation | Next gate |
| --- | --- | --- | --- |
| Package/API | Independent @nitro-forge/board, public contracts and native entry | Source committed | TS typecheck |
| Android rendering | 68 Kotlin files: native Canvas, shapes, ink, image, overlay | Viro source transplanted, renamed | Android Gradle compile |
| Native tests | 15 original JVM test files copied | Source committed, not run here | JUnit PASS on supported toolchain |
| Nitro v1 | Generated WhiteboardRenderer/Factory & JNI registration | Specs/CMake/Gradle source | Nitrogen codegen + C++/Kotlin compile |
| Viro interop | Android CanvasSurfaces registry and XR material identity | Source contract preserved | PICO + Quest physical device |
| Muse ink | Separate Forge spatial ink PR #15 | PR exists; not wired in consumer | One subscriber + hardware |
| Document | QuickDraw Store only; native renderer derived | Binding/encoder source | Prior snapshots/diff parity |
| Apple | Native Skia/Metal Board renderer | Not implemented | iPad/Vision Pro source and test |
| React Native 2D | Fabric/SurfaceView native board independent of Viro | Not implemented | New native view + device tests |
| Browser | Canvas/WebGPU/WASM equivalent | Not implemented | Visual parity & export tests |
| Moyo | Replace mirrored native session and WebView authority safely | Not implemented | Independent Moyo migration PR |
| QA/perf | FPS, latency, memory, tracking loss, lifecycle and source licenses | Not run | Measured before/after report |

## Review constraints

No merge of this draft until generated Nitro v1 API matches native code and a
consumer app builds/links. Avoid merging unrelated PR #8-#10 engine internals or
changing existing Ignition commands/NFD1. Keep old `viro-external/native-panels`
source until consumers have cut over; no duplicate loading of old and new
HybridObject package in one application without removing the old renderer.

**Measurements to record:** first ink latency, stroke-to-photon p50/p95, drop
rate at hardware refresh rate, coarse/large board memory and bitmap cache,
export pixel parity, app background/foreground, and simultaneous tutor input.
