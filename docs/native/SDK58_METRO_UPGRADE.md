# SDK58 / latest npm candidate (2026-11-04)

**Draft.** JS bundles export for iOS and Android; native compilation and device runs are not yet verified.

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

## Metro: Expo 58's pinned 0.87.1 (decision 2026-11-04)

The workspace overrides now keep all fourteen Metro packages on **0.87.1**, the
version `@expo/metro` 58.0.0 declares. The earlier 0.87.2 candidate could not
start: Expo CLI 58.1.19 always substitutes `@expo/metro-file-map` 58.0.5, which
has no `addRoot()`/`getRoots()`, and Metro 0.87.2 calls them during runtime-root
discovery:

    TypeError: this._haste.addRoot is not a function
    at DependencyGraph._addMetroRuntimeRoots

That was the only thing blocking native and web exports. On 0.87.1 the sibling
canonical UI package (`STUDIO_UI_ROOT`, default `../../../nyc-mon/packages/ui`)
must be in `watchFolders`, because 0.87.1 resolves only inside watched roots;
`apps/example/metro.config.cjs` adds it next to Expo's monorepo defaults.

Deferred: Metro 0.87.2. Revisit when an Expo release ships a file-map fork with
`addRoot`/`getRoots`. `verify-metro-stack.cjs` reads the expected version from
`@expo/metro`, so the overrides can follow Expo without editing the script.

Reproduce, from the repository root:

    node apps/example/tooling/verify-metro-stack.cjs
    cd apps/example
    CI=1 EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform ios --max-workers 1 --no-minify --no-bytecode
    CI=1 EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform android --max-workers 1 --no-minify --no-bytecode

Both exports completed locally on 2026-11-04 (one JS entry bundle each). CI's
`expo-native-bundles` job runs the same commands. A JS export is not a native
build: Xcode/Gradle compilation and device runs are separate evidence.

## Supply-chain age gate

pnpm12 frozen install rejects current exact latest pins published less than24h
ago (including Expo, Skia, Next and their packages). The first non-frozen install
automatically wrote release-age exemptions; those were removed after inspection.
**No exemptions or policy relaxation are committed.** Strict frozen install now
fails as expected until those publications age past the cutoff. Registry times
for all35 rejected entries were verified: the last is Next16.4.5, eligible
November4 at18:01:54.667 UTC; recheck at18:02 UTC. Do not bypass the
gate or describe the candidate as a clean/frozen-install pass. Source checks using
the already-installed candidate are narrower evidence.

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
