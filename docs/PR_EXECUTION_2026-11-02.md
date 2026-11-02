# NitroForge PR execution ledger
Checked: 2026-11-02. These are **draft PRs**. Report tests only with the exact commit/run that produced them. Open PRs may change after this snapshot.

## Dependencies

```text
#2 skills / owners
├── #1 Expo 58 + Skia 3 ── #3 JS/native adapter ── #8 Nitro v1 factory ── #9 Rust FFI ── #10 C++ bridge
├── #4 Moyo source-extracted adaptive geometry ── #5 Studio dock layout and magnetic targets
├── #6 ArtCraft observed changes ── #7 npm/SDK release gates
└── #15 Muse spatial-ink ── #20 BLE / Rive pairing
                                  ⇓
#18 canonical @nitro-forge/board Android/Viro ── #19 Skia v3 + Ink + MMKV/Yjs
```

**Important:** arrows show work dependencies, not merge approvals. Avoid force-merging stacked alpha branches into production.

## PR-by-PR gate

| PR | Current implementation / observed check | Next blocking evidence |
|---|---|---|
| [#1](https://github.com/mikevocalz/nitro-forge/pull/1) Expo/Skia | Expo 58/Skia3/WebGPU package pins and frozen lockfile work recorded | Full native iOS/Android build, one Dawn, real Skia3 GPU |
| [#2](https://github.com/mikevocalz/nitro-forge/pull/2) Engineering skills | Pinned Margelo, Expo, Callstack, No AI Slop, TypeGPU and Moyo foldable skills; reviewers/roster | Human review of skill provenance and applicability |
| [#3](https://github.com/mikevocalz/nitro-forge/pull/3) Native smoke | NitroHost unsafe-handle checks, typed response tests; Expo web/iOS JS bundle checks passed | Actual native Skia3 + Nitro link and hardware acceptance |
| [#4](https://github.com/mikevocalz/nitro-forge/pull/4) Adaptive UI | Real Moyo fold/hinge geometry and tests extracted into `@nitro-forge/adaptive-layout`; source-level CI passed | Moyo consuming **same** package, SwiftUI/Compose, iPad/Duo/Meta device tests |
| [#5](https://github.com/mikevocalz/nitro-forge/pull/5) Studio | Typed dock model, accessible move actions, measured magnetic rail preview and hinge-safe target rejection | Pointer/touch/keyboard UI, persisted workspace, real editor stages |
| [#6](https://github.com/mikevocalz/nitro-forge/pull/6) ArtCraft intake | Observed-only upstream source watcher tests passed | Scheduled bot PR, exact licenses, per-engine source admission and runtime behavior |
| [#7](https://github.com/mikevocalz/nitro-forge/pull/7) Release | Headless boundary and npm audit checks; daily v1 release freshness gate now proposed | New release-check CI; actual npm artifacts and clean cross-app install |
| [#8](https://github.com/mikevocalz/nitro-forge/pull/8) Nitro v1 spec | v1 alpha nightly120 codegen, JS/TS classes and ArrayBuffer session API | Linked native class, exact version family, physical device |
| [#9](https://github.com/mikevocalz/nitro-forge/pull/9) Rust FFI | Independent sessions, bounded native C ABI, concurrency/panic/close tests passed | Real Swift/Android C++ bridge and memory sanitizer |
| [#10](https://github.com/mikevocalz/nitro-forge/pull/10) C++ bridge | At checked head, Nitro v1 generated C++ signatures and Linux C++/Rust tests passed | Real Apple/Android native package link, no v0/v1 mixed app |
| [#15](https://github.com/mikevocalz/nitro-forge/pull/15) Muse spatial ink | Portable spatial input and test suite passed | Actual Muse peripheral/visionOS tracking, spatial input lifecycle |
| [#18](https://github.com/mikevocalz/nitro-forge/pull/18) Board base | Android Kotlin/JVM contract and codegen tests passed; canonical package owner | Viro AAR and real XR surface build/device tests |
| [#19](https://github.com/mikevocalz/nitro-forge/pull/19) Board Skia/offline | One board package; 59 JS tests for Skia, pressure, MMKV, Yjs, offline ACK; native Viro source now isolated | Android Gradle complete, iPad/Duo, real MMKV power-loss/airplane/restart, Moyo migration |
| [#20](https://github.com/mikevocalz/nitro-forge/pull/20) Bluetooth pen | Nitro v1 BLE codegen and controller tests passed before latest GATT cleanup regression commit | New GATT cleanup CI, Android permission/system pairing hardware, Muse protocol proof |

## Active engineering rosters

- **Native SDK and release:** Margelo `api-design`, `build-nitro-modules`, C++, Swift, Kotlin; `docs/ROSTER.md`, and explicit error/ABI/worker ownership. No JS `number` for unsafe Rust u64 or hidden binary lifetime.
- **Adaptive and Studio:** Expo `expo-overview`, `expo-ui`, `expo-native-ui`, Moyo's 18-case foldable skill, Meta spatial layout docs, Mobbin Framer/Rive/Canva references. Moyo provides *host navigation*, the SDK provides inner editor UI. Draw/test first; no cloned third-party icon art.
- **Canvas and offline:** Official Skia v3 Graphite/Dawn API, TypeGPU only when directly used; Moyo's existing Yjs BoardDoc + MMKV v4, account-scoped keys. A native view cannot claim offline persistence merely by existing. One canonical editor document; no duplicate QuickDraw shadow.
- **Bluetooth/XR:** Margelo Nitro + Kotlin/Swift, Android BLE permissions, Vision Pro system pairing, Rive verification semantics. BLE linked does **not** imply Muse 6DoF or pressure input verified.
- **Quality:** Callstack RN profiler and Software Mansion Argent device skills, No AI Slop for all PR descriptions and evidence. `PASS` only for executed checks; `NOT RUN` for hardware, no made-up FPS, zero-copy, or native-build equivalence.

## Current priority order

1. Unblock PR #19's Android build with Viro-only Kotlin source sets; then obtain **physical** Skia3 rendering and offline MMKV/Yjs tests. Keep Viro optional for normal 2D.
2. Land each stacked native bridge change only after it compiles in an Expo app using **Nitro v1 nightly120**, with iOS/Android evidence; preserve the v0 host until cutover.
3. Verify PR #4's shared geometry package and PR #5's magnetic UI behavior in actual cross-platform controls. Moyo must consume one shared source rather than a parallel fork.
4. Verify PR #20 BLE/native disconnect handling and real device readiness, then test #15 Muse event delivery.
5. After artifact and source-license gates, use #6 and #7 to publish reviewed packages and coordinate consumer updates through independent app PRs.

**This ledger is a handoff to reviewers, not a claim of autonomous subagents or finished builds.** The GitHub Actions run pages linked from the PRs remain the executable evidence source.
