# SDK58 / latest npm candidate (2026-11-04)

**Draft, blocked. Do not merge or describe this host as native-ready.**

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

## Metro0.87.2: explicit request, explicit incompatibility

All14 upstream Metro packages, including metro-resolver/runtime/file-map/config,
are overridden together to0.87.2. Expo58's @expo/metro58.0.0 pins0.87.1.
This is an **unendorsed integration candidate**, not Expo's supported pairing.
Configuration still extends `expo/metro-config`. Host-native singleton resolution
keeps package names and exports intact, including RN0.88's `react-native/setup-env`.

Useful new upstream behavior includes `metro:runtime/*` import resolution across
workspace boundaries, dynamic runtime-root discovery, symlink/file-watching fixes,
and conditional-exports fixes. `resolver.schemeResolvers` (introduced0.87.1) is
preserved; the preflight exercises actual scheme dispatch. No unused custom
production scheme or experimental server middleware was added just to enable a
flag. Runtime-root and watch behavior cannot be claimed working in Expo yet.

Latest Expo CLI58.1.19 unconditionally substitutes @expo/metro-file-map58.0.5.
That fork lacks `addRoot()` and `getRoots()`, which Metro0.87.2 calls during
runtime-root discovery. Actual iOS JS export fails before bundling with:

    TypeError: this._haste.addRoot is not a function
    at DependencyGraph._addMetroRuntimeRoots

Both on-demand filesystem settings construct the same incompatible fork.
There is no newer official npm next release (next=latest58.0.5; canary is older).
No no-op shim, prototype monkeypatch, silent downgrade, or disabled assertion is
included. Correct support requires a real Expo fork update, including roots,
symlink handling, crawl/watch registration and change-event serialization.

Reproduce, from the repository root:

    node apps/example/tooling/verify-metro-stack.cjs
    cd apps/example
    CI=1 EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform ios --max-workers 1 --no-minify --no-bytecode

The preflight intentionally exits nonzero while the API is missing. Android and
Expo web share this startup blocker; their full exports are not claimed passed.
Standalone Vite preview is a separate host and does not prove Metro compatibility.

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
