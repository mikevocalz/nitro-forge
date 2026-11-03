# Board Android link verification

Base: `b5cb132f6404f526b631189e64b56ea954d0e36f`.

The failed [run 41559459368](https://github.com/mikevocalz/nitro-forge/actions/runs/41559459368) built NitroModules for arm64-v8a and then Board for armeabi-v7a. Board did not consume the host reactNativeArchitectures property. The failed Board link command contains fbjni/jsi/reactnative libraries but no libNitroModules.so. The installed Nitro v1 build.gradle applies that property as CMake ABI filters; Board now does the same. CMake rejects a headers-only Prefab runtime target before linking. Strict undefined-symbol checking remains enabled.

The renderer binding accepts only getSnapshot/listen from its document source. A host can project a Yjs document into the renderer without constructing another editable Store. The regression test sends a snapshot, coalesces changes and verifies cleanup through this read-only source.

| Workstream | Role | Source | Capability / evidence |
| --- | --- | --- | --- |
| Android linkage | Native build engineer | packages/board/android | Host ABI selection and Nitro Prefab shared-library requirement |
| CI regression | Build verification | scripts/verify-board-android-link.mjs and native workflow | Inspect actual ELF DT_NEEDED for libNitroModules.so; reject missing/unexpected ABIs |
| Single document integration | SDK API | WhiteboardRendererBindingOptions | Read-only source; host retains edits and undo |

## Checks at source commit

- PASS: Board Nitro v1 codegen, nightly 120.
- PASS: Board TypeScript typecheck.
- PASS: Board tests, 62 tests in 13 files.
- PASS: Expo 58 Android prebuild in isolated lab.
- Native Gradle compile: RUNNING when source commit prepared; result will be recorded separately.
- Quest/device interaction, iOS and web GPU pixels: NOT RUN by this workstream.

The no-Viro build-only opt-in is NITRO_FORGE_BOARD_VIRO_ANDROID=on. It compiles the existing fail-closed backend for link verification; the factory remains unavailable without Viro CanvasSurfaces. It does not introduce a rendering implementation or assert runtime capability.

Skills read: [workstream receipt](board-android-link-skills.md). The [shared receipt](moyo-shared-skill-receipt.md) records the main session's broader skill reads.

## Malformed document follow-up

A scene bridge now selects the complete fallback when reading/encoding a source throws. Null records, malformed draw props, and a throwing ink-outline provider are covered at construction and after mount. Tests verify that the source is unchanged, a subsequent valid snapshot recovers, and disposal detaches the listener. Board typecheck and 65 tests PASS after this change.

## Older Viro capability follow-up

Gradle inspects classes.jar for com/viromedia/bridge/canvas/CanvasSurfaces.class before selecting the Viro source root. An existing older AAR without that class selects the existing unavailable backend. This check does not establish runtime or device capability. PASS: node scripts/test-viro-canvas-capability.mjs runs the actual Gradle selector against missing, old-registry and canvas-registry archive fixtures. The marker fixtures contain no executable native implementation.
