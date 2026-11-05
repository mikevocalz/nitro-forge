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
- PASS: full Android Gradle assemble, cold build 8m 33s; latest source `fb6b14b9f9093d663e18c657ac6016ff972dc63a` rebuilt in 25s (254 tasks, 20 executed, 234 up-to-date).
- PASS: actual arm64 Board ELF DT_NEEDED includes libNitroModules.so; no unexpected ABI output.
- PASS: isolated lab TypeScript and 4 ink-lab tests.
- PASS: frozen pnpm install. Lab resolves one Nitro nightly 120, Skia 3.8.1 and Dawn 157.0.0.
- Quest/device interaction, iOS and web GPU pixels: NOT RUN by this workstream.

The no-Viro build-only opt-in is NITRO_FORGE_BOARD_VIRO_ANDROID=on. It compiles the existing fail-closed backend for link verification; the factory remains unavailable without Viro CanvasSurfaces. It does not introduce a rendering implementation or assert runtime capability.

Skills read: [workstream receipt](board-android-link-skills.md). The [shared receipt](moyo-shared-skill-receipt.md) records the main session's broader skill reads.

## Malformed document follow-up

A scene bridge now selects the complete fallback when reading/encoding a source throws. Null records, malformed draw props, and a throwing ink-outline provider are covered at construction and after mount. Tests verify that the source is unchanged, a subsequent valid snapshot recovers, and disposal detaches the listener. Board typecheck and 65 tests PASS after this change.

## Older Viro capability follow-up

Gradle inspects classes.jar for com/viromedia/bridge/canvas/CanvasSurfaces.class before selecting the Viro source root. An existing older AAR without that class selects the existing unavailable backend. This check does not establish runtime or device capability. PASS: node scripts/test-viro-canvas-capability.mjs runs the actual Gradle selector against missing, old-registry and canvas-registry archive fixtures. The marker fixtures contain no executable native implementation.

## Reproduction and artifacts

Tested native source: `fb6b14b9f9093d663e18c657ac6016ff972dc63a`. Toolchain: Node 24.19.0, pnpm 10.32.1, Java 17, Gradle 9.4.1, Android API 37, NDK 28.2.13676358, arm64-v8a.

```sh
pnpm install --frozen-lockfile
pnpm --filter @nitro-forge/board codegen
pnpm --filter @nitro-forge/board typecheck
pnpm --filter @nitro-forge/board test
NITRO_FORGE_BOARD_VIRO_ANDROID=on pnpm --filter @nitro-forge/board-native-lab android:prebuild
NITRO_FORGE_BOARD_VIRO_ANDROID=on bash apps/board-native-lab/android/gradlew \
  -p apps/board-native-lab/android :app:assembleDebug --no-daemon --max-workers=1 \
  -PreactNativeArchitectures=arm64-v8a -PndkVersion=28.2.13676358
node scripts/verify-board-android-link.mjs packages/board/android/build arm64-v8a
node scripts/test-viro-canvas-capability.mjs
```

Set ANDROID_HOME to the installed SDK; no machine-specific path is committed into the build.

| Artifact | SHA-256 |
| --- | --- |
| pnpm-lock.yaml | `74b9c4809de75eadc33980190c79e49f0f2140d9f2590bbad22a62effc8d04db` |
| libNitroForgeBoard.so (arm64-v8a, unstripped) | `f64ee6494b7df82d13d4e0c7090d6d904b8644f85e8ef3a40e94652274168c1c` |
| isolated lab app-debug.apk | `e30d85c929b2ce0cf916eea09933dd9ea58487aef6fc4db945cc0fed70c6bccf` |

The ELF has direct dependencies on NitroModules, fbjni, jsi and reactnative. This is compile/link evidence. The isolated lab was not installed or driven on a device in this workstream; no native pixel, latency or memory measurements are claimed.

[Real Android CI run](https://github.com/mikevocalz/nitro-forge/actions/runs/41563485562) was still running when local evidence was recorded. Local build success is independent of that remote run.
