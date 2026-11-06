# SDK58 / latest npm candidate (2026-11-04)

**Draft compatibility candidate.** Metro0.87.2/Uniwind iOS, Android and web JavaScript exports pass; native compilation and device runs remain unverified.

The actual example and shared Studio now target Expo58.0.23, React19.3.1,
React Native0.88.1, Expo Image58.0.18, Gesture Handler3.4.0, Skia3.9.1,
WebGPU0.21.0, Reanimated4.7.1/Worklets0.13.1 and the exact Nitro v1
`1.0.0-alpha.nightly.120.g33ef045b96c0` trio. Runtime integration reuses
existing draft #10's factory/document sessions in ignition, not a second package.
See NITRO_V1_HOST_INTEGRATION.md for build prerequisites and limitations.
The seven engines and the canonical source-owned NYC UI remain shared.

Toolchain: pnpm12.16.1, Turbo2.11.10, TypeScript7.0.2, Vite8.3.5, Vitest5.1.0.
Direct package versions were queried against npm on November4. This is a dated
candidate, not a claim that versions remain latest indefinitely. Shared external
NYC dependencies not explicitly supplied by this host are not upgraded here.

## Metro0.87.2 compatibility candidate

The fourteen-package Metro family is pinned coherently to user-requested0.87.2.
Expo58's declared baseline remains0.87.1. Its branded file-map58.0.5 receives a
version-pinned, licensed port of real dynamic-root registry/crawl/watch support,
not a shim or disabled assertion. See METRO_FILE_MAP_PORT.md for provenance,
regression commands and support limitations. The previous0.87.1 fallback is
superseded by this candidate; its export results do not prove this candidate.

The config watches finite Forge and canonical UI workspaces, preserving Expo
roots while including actual asset/symlink targets. Uniwind wraps the finished
config and compiles canonical UI plus generated Forge light/dark native themes.

Reproduce after a policy-compliant frozen install:

    node apps/example/tooling/verify-metro-stack.cjs
    node --test apps/example/tooling/metro-dynamic-roots.test.cjs apps/example/tooling/metro-watcher-lifecycle.test.cjs
    node apps/example/tooling/verify-native-styles.cjs
    cd apps/example
    CI=1 EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform ios --max-workers 1 --no-minify --no-bytecode
    CI=1 EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform android --max-workers 1 --no-minify --no-bytecode
    CI=1 EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform web --max-workers 1 --no-minify

Fresh candidate validation: eight Metro root/watch regressions, real Uniwind
iOS/Android transforms with zero diagnostics, and actual iOS4525-module/Android
4504-module JavaScript exports pass. Expo web also passes3828modules with the declared Next16.4.5 peer. Exports prove JavaScript
bundling, not Xcode/Gradle build/link or physical device input/rendering.

## Release age

pnpm-workspace.yaml sets `minimumReleaseAge: 0` (decided 2026-11-04), so pnpm
12.16.1's default 24-hour quarantine does not apply and fresh releases install
immediately. Versions are still pinned exactly, and CI installs with
`--frozen-lockfile`, so nothing changes without a reviewed lockfile diff.

## Evidence and remaining gates

- Local64 layout/Studio tests, app/preview/Studio TS7 checks and UI import guard pass.
- Expo Image Apple/Android and RNGH iOS/Android autolinking point at the host.
- Nitro ignition autolinking recognizes its podspec and Android package.
- Nitro v1 codegen, seven host tests, typed contracts and C++ syntax were checked.
- Gesture Handler3.4 differs from Expo's~3.3 baseline. React19.3.1 and Worklets0.13.1
  also differ from bundled patch defaults. Custom development builds must validate them.
- Cargo/NDK/Xcode are unavailable locally. Rust tests require CI; native compile,
  linking, image rendering, Metal/Vulkan, real input and Meta/XR remain unverified.
- Existing Chromium execution was blocked by the environment before launch.

Sources: https://docs.expo.dev/guides/customizing-metro/ and
https://github.com/react/metro/releases/tag/v0.87.2 plus installed npm package source.

## Reconstructed follow-through (November 4, revalidated)

The original executor was replaced before the unpublished follow-through could
be persisted. These source changes have been reconstructed from the published
candidate and upstream APIs. Earlier local export results do not validate this
reconstructed tree. The reconstructed tree has now passed normal/frozen installation, eight Metro
regressions, real native-style transforms and all three platform exports.

Uniwind is the outermost Metro wrapper, imports the canonical shared native theme,
and generates Forge light/dark native variants from the same theme.ts as web.
The default checkout layout requires sibling `nyc-mon`; STUDIO_UI_ROOT alone does
not relocate CSS imports/source scanning. Relocated hosts must update both.
Source scanning retains web implementations, excludes story/test helpers, and
native diagnostics fail validation rather than silently dropping classes.
The canonical KeyValueList fix plus quiet controls are pinned at 2c5b94ba. No visual/device or Meta
runtime validation is inferred from source checks or JavaScript exports.
