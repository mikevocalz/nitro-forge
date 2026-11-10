# Cadence Native Instrument Consumer

The screen uses a real CadenceInstrumentSession and NYC-Tron UI's knobs, fed
by Cadence's adapter: the SwiftUI/Compose `ArcKnob` from
`@nyc-tron/native-controls` takes `session.controls`, and the React Native
`InstrumentKnob` from `@nyc-tron/ui` takes `session.knobs`. A two-option
switch picks the renderer; both commit through the same serialized Rust path.
It is a separate Expo SDK 58 integration app so the legacy Expo 54 example
does not silently upgrade or mix native dependency versions.

## Dependencies

This directory is its own pnpm workspace (`pnpm-workspace.yaml`,
`pnpm-lock.yaml`). It joins `packages/ignition` and `packages/cadence` from
this repository's source and installs NYC-Tron from the
`v0.1.0-alpha.4` release tarballs pinned in `tooling/nyc-tron.json`. There is
no NYC-Tron checkout and no staging copy. A workspace override keeps every
`react-native-nitro-modules` at the Nitro v1 alpha the native build links,
without editing Ignition's own devDependency.

`metro.config.js` resolves React, React Native, Nitro, Zustand and `@expo/ui`
from this app for every importer, including the Forge source packages, and
supports `NYC_TRON_ROOT` dev-linking (see `docs/NYC_TRON_UI_HANDOFF.md`).

Installing here and installing at the repository root both write
`packages/ignition/node_modules` and `packages/cadence/node_modules`. Rerun
`pnpm install` in whichever workspace you switch to.

## Build

From this directory:

    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm exec expo export --platform android --dump-sourcemap --output-dir /tmp/cadence-export
    node ../../tooling/native/check-bundle-singletons.mjs /tmp/cadence-export android
    pnpm exec expo prebuild --platform android --no-install

CI (`.github/workflows/cadence-native-consumer.yml`) runs the same frozen
install, re-hashes the release assets, typechecks, bundles both platforms
with the one-copy check, and compiles Android and iOS.

## Engine limitation

The native screen calls createNitroHost and CadenceInstrumentSession.open.
Without an installed, registered native Forge Nitro v1 factory it **shows
an error**. It never swaps in a mock or uses the Node CLI on device.
The generated constructor resolves lazily through Ignition's `#nitro`
mapping. No separate global factory registration is needed. A green native
compile alone is not proof of real engine calls.

Preview is local to the native view, while gain/pan commits, undo, redo and
NFD1 snapshots operate on the Rust document. The latter are covered by
real Rust CLI integration tests. This app uses Zustand only for UI state
and measures its own host width for phone, tablet and foldable responsiveness.

No Vercel deployments, raw HTML, Expo Audio or Expo Video.

## Historical integration build findings (November 5, 2026)

- TypeScript cross-repository installation and imports passed GitHub CI
  (then from a pinned NYC-Tron commit; now from the release tarballs).
- Android initial Gradle configure failure was the demo package identifier ending in Java keyword 'native'. Corrected to ai.nitroforge.cadence.studio.
- iOS first CocoaPods attempt reached native dependencies but Nitro v1's NitroModules.podspec is deliberately source-empty. Nitro v1 uses SwiftPM. The integration workflow now tries React Native 0.88 experimental spm conversion; Expo SDK 58's SwiftPM path is preview-only. This is a platform integration gate, not evidence that SwiftUI or Forge C++ failed compilation.
- With NYC-Tron v0.1.0-alpha.2 the native-controls pod no longer imports ExpoUI, and the iOS compile got past it ([run 42104754906](https://github.com/mikevocalz/nitro-forge/actions/runs/42104754906)). It then stopped in Expo's SwiftPM app-config script phase, which resolves `expo-constants` from the app root. This workspace is an isolated pnpm install, where `expo-constants` only exists under `expo`, so the app now lists `expo-constants` directly at the locked 58.0.15. Keep it even though App.tsx never imports it.
- These historical builds did not execute real Forge Rust operations on hardware.

## Native runtime acceptance

The screen uses the canonical production host:

    import { createNitroHost } from '@nitro-forge/ignition';
    const host = createNitroHost();

The screen disposes the host on failure, retry and unmount. **Reconnect native
engine** exercises session replacement. **Verify native engines** initializes
every registered Rust engine through JSI and checks describe, NFD1 round trips,
invalid-restore atomicity and closure. It also edits Cadence gain/pan, undoes,
redoes and opens the saved bytes in a second document. Errors appear on screen;
there is no CLI or fake fallback. Snapshot bytes are in memory and are not
claimed to be saved to device storage.

See [the P01 report](../../docs/completion/reports/P01.md) for exact executed
runtime evidence, native binary provenance and outstanding acceptance gates.

### Task, cache and binary runtime acceptance

**Verify native tasks and cache** constructs the generated `ForgeFactory`
directly. It checks owned raw Prism input/output and restore buffers, native
cache LRU/copy/bounds behavior, running Cadence cancellation at an observed
checkpoint, queued mutation cancellation, task progress/result bytes, FIFO
close, post-close rejection, and output lifetime after the source document
closes. The verifier owns and closes its documents/cache and never substitutes
a CLI or fake factory. A missing native binding is a failure.

To run this screen automatically in an installed native build:

```sh
FORGE_ACCEPTANCE=runtime EXPO_PUBLIC_FORGE_REVISION=$(git rev-parse HEAD) \
  pnpm start --port 8081 --localhost
```

The existing native consumer CI now launches its built Android APK and iOS
simulator app using `tooling/native/run-runtime-acceptance.mjs`. It requires
a native `FORGE_NATIVE_RUNTIME_PASS` report containing all eight checks and
the matching platform/source commit, then saves the report and screenshot.
Android checks the app's accessibility hierarchy; iOS captures the simulator
app's native console. Metro logs are retained on failure. Typechecking,
bundling, or compiling this harness alone does not satisfy runtime acceptance.

For an already running Android emulator, set `FORGE_ANDROID_SERIAL` if it is
not `emulator-5554`. For iOS, the runner uses an available iPhone simulator and
shuts down only a simulator that it booted. Both runners need the corresponding
platform toolchain and the built application artifact.

## Historical integration CI evidence

- [Android source/native UI compile passed — run 41961359554](https://github.com/mikevocalz/nitro-forge/actions/runs/41961359554) after fixing the invalid Java namespace. This does not prove Forge's native v1 C++/Rust registration.
- [Rust engine session and host tests passed — run 41961979522](https://github.com/mikevocalz/nitro-forge/actions/runs/41961979522), including the v1 wire adapter backed by the real Rust CLI.
- Early iOS builds were blocked on the experimental SwiftPM integration; the first CocoaPods failure was caused by Nitro v1's intentionally empty Podspec. Subsequent native build recovery is documented in `docs/recovery` and current acceptance in `docs/completion`.
- The cross-repository consumer TypeScript test passed on the combined sources. This is neither a device test nor proof of native JS-to-Rust linkage.

To avoid duplicate expensive native builds, the CI workflow now uses one PR trigger (plus manual dispatch) with a single latest-branch concurrency group.

## Companion checkpoint acceptance

The normal entry uses the released exports. Test the new storage API in an
explicit companion mode:

```sh
# In the companion NYC-Tron checkout:
pnpm --filter @nyc-tron/platform-services build
# In Forge, using your actual companion checkout path:
NYC_TRON_ROOT=/path/to/NYC-Tron-UI node tooling/typecheck-checkpoint-acceptance.mjs
# In this directory, after building/installing native dependencies:
EXPO_NO_TYPESCRIPT_SETUP=1 NYC_TRON_ROOT=/path/to/NYC-Tron-UI \
NYC_TRON_PACKAGES=@nyc-tron/platform-services FORGE_ACCEPTANCE=checkpoints \
pnpm start --port 8081 --localhost
```

This mode serves `checkpoint-acceptance.js` instead of `index.js`, links only
the candidate platform-services JavaScript and resolves Expo's runtime and
FileSystem from the app. The native app must include Expo FileSystem 58.0.13.
The lab checks actual disk persistence, undo/redo, corruption fallback,
interrupted temporary writes, real I/O failure/retry and process relaunch.
Both iOS and Android passed; P02 reports retain exact provenance.

The persisted platform-services patch supplies alpha.4's missing SwiftPM
manifest, preserving the Podspec's iOS floor and frameworks. The companion
source includes that manifest; remove the patch when adopting the future
release containing it. Release assets remain pinned.
