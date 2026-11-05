# NF-02 + NF-03: Skia v3 Graphite, Dawn, Nitro Rust FFI runtime implementation roster

**PR type:** stacked draft on [NitroForge #1](https://github.com/mikevocalz/nitro-forge/pull/1), which contains the v3 npm dependency pins. **This PR adds one test scene and execution specification, not a functional Rust-powered native canvas.**

## Exact skill/source requirement
1. [Project Skia Graphite skill](https://github.com/mikevocalz/nitro-forge/blob/docs/skills-roster-quality-gates-2026-11-02/.agents/skills/skia-v3-graphite/SKILL.md) from PR #2. Read the whole file.
2. [Official Skia v3 migration](https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/) and [WebGPU shared Dawn matrix](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-native-skia).
3. [Margelo Nitro HybridObject](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md), C++, Swift and Kotlin skills; [Callstack performance](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md).
4. [Argent device interact](https://github.com/software-mansion/argent/blob/1a17fd5755247b540b3f812e7e4b736c33c74c40/packages/skills/skills/argent-device-interact/SKILL.md) for actual simulator/device QA.
5. [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md) for reports. Use `docs/ENGINEERING_SKILLS.md` after PR #2 merges.

## Current verified repository state
- `rust/ignition-core`: `Engine` trait/atomic command contract; the existing test ledger records completed Rust and `nf-cli` tests, not independently rerun by this PR.
- `rust/nf-sys`: existing C ABI round-trip test. `packages/ignition/src/Forge.nitro.ts`: a written HybridObject spec with **no generated linked native implementation**.
- `apps/example`: Expo navigation with per-engine document example screens. Existing editor UI is a debug command view, not Skia-driven design canvas.
- [PR #1](https://github.com/mikevocalz/nitro-forge/pull/1): `react-native-skia@3.8.1`, `react-native-webgpu@0.19.2`, Expo 58/RN0.88; lockfile regenerated and frozen-install verified in CI; native builds have not run.
- This branch adds `GraphiteSmoke` for primitive `Canvas`/rect/circle rendering. It tests *Skia's own path*, intentionally not claiming Rust ↔ Skia texture interop.

## Engineering roles and sequence

| ID | Owner expertise | Implementable deliverable | Review evidence | Status |
|---|---|---|---|---|
| G-01 | Dependency/Expo maintainer | regenerate `pnpm-lock.yaml` frozen; check Expo 58/RN 0.88, CocoaPods + Gradle binary packages | lockfile SHA and `pnpm install --frozen-lockfile` | Lockfile DONE (frozen in CI); Expo 58 native builds NOT RUN |
| G-02 | Graphics engineer | real physical Skia v3 smoke on Metal/Vulkan plus web CanvasKit | screenshot, logs, platform device IDs and source SHA | NOT RUN |
| G-03 | Rust/FFI engineer | review `nf-sys` open/apply/snapshot/restore/close handles and panic/cancel safety | C++/Rust sanitizer and corpus tests | PLANNED |
| G-04 | Nitro native engineer | generate Nitrogen from `Forge.nitro.ts`; implement HybridObject Swift/Kotlin/C++ adapter; native engine thread execution | successful compiled codegen, iOS/Android app edit/save/reopen | PLANNED |
| G-05 | Runtime ownership engineer | deterministic disposal and generation/revision-safe callbacks after undo, window changes, close | stale-result and leak tests | PLANNED |
| G-06 | Renderer parity engineer | convert Prism's actual `flatten` output to bounded CPU reference tiles, then Skia image adapter | pixel corpus, large-doc memory and readback tests | PLANNED |
| G-07 | GPU/Dawn reviewer | validate `react-native-skia` + `react-native-webgpu` shared Dawn and exact texture ownership; TypeGPU optional | `pnpm why react-native-webgpu-dawn`, device test, lifecycle proof | PLANNED |
| G-08 | Web/WASM specialist | build Rust WASM adapter and separate web CanvasKit renderer | real browser edit/restore/export, SSR import check | PLANNED |
| G-09 | QA/Argent | stress multi-touch, Pencil, device-loss, Vulkan absence, pane hide/show and background/resume | traces/videos and device matrix | PLANNED |

## Technical contract
1. Keep editable document/undo journal **inside Rust Ignition**. `Zustand` is the target UI transient state (tool/pane/selection), not a second document store.
2. Confirm all native handle conversion respects the `u64` opaque-handle contract. Do not pass unchecked pointers or unbounded bytes as a JS number; use generation checks and typed errors.
3. Rust/WASM/native create/execute/snapshot/restore must share the same supported command semantics; no automated source graft from PhotoCraft.
4. Render bound dirty regions (avoid full-canvas JS state clones on every pointer event). First prove exact CPU output against engine `flatten` bytes; then introduce GPU acceleration with measured parity.
5. `react-native-skia` v3 Graphite and RN WebGPU may share Dawn on compatible versions. Rust `wgpu` does NOT inherit that GPUDevice; any zero-copy Rust path needs independent integration proof.
6. Skia canvas visibility must stop its worker/presentation loop on panel hide. `react-freeze` does not suspend side effects.
7. Document the unsupported native GPU state and a safe user-visible response; never render an unexplained blank canvas.
8. Support native Android API26+ with **Vulkan 1.1**, iOS16.4+ (Expo SDK 58 minimum) Metal, Expo development builds (not Expo Go); web is separately tested through CanvasKit.

## Exact smoke procedure (execute after #1 frozen lock install)
```sh
corepack enable
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm check:skia-v3
pnpm --filter @nitro-forge/example typecheck
pnpm --filter @nitro-forge/example exec expo run:ios
pnpm --filter @nitro-forge/example exec expo run:android
pnpm why react-native-webgpu-dawn
```
On native, open `/diagnostics/graphite` in a development build and capture the dark square, cyan rectangle and orange circle; compare pixel fixture. On web use equivalent route and verify Skia Web loading; then test no-GPU state and app background/resume. A screenshot is a smoke proof, **not** a working editor or engine bridge.

## Release blockers
- PR #1 must land with valid frozen lock and one Dawn version.
- Native HybridObject implementation and real Rust editing bridge remain **unwritten**; never imply this diagnostic provides them.
- GPU memory/device loss behavior, native edit/save tests, CPU vs GPU parity and browser WASM remain NOT RUN.
- No source was built or execution test run by the GitHub content changes in this PR.

## Exit gate for future implementation PR
An actual native Prism document: create → layer → draw → undo/redo → save editable NFD1 → reopen → flatten/PNG; deterministic output against CPU reference; run on iOS Metal, Android Vulkan and web WASM; memory/leak and accessibility reports. Ship only after this passes with commit-tied artifacts.
