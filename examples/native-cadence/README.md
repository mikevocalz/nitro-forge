# Cadence Native Instrument Consumer

The screen uses a real CadenceInstrumentSession and real SwiftUI/Compose
ArcKnob controls from NYC-Tron UI. It is a separate Expo SDK 58 integration
app so the legacy Expo 54 example does not silently upgrade or mix native
dependency versions.

## Build

Check out Nitro Forge PR #43 and NYC-Tron UI PR #8. From the Forge root:

    node tooling/native/stage-cadence-consumer.mjs ../NYC-Tron-UI /tmp/cadence-lab
    cd /tmp/cadence-lab
    corepack pnpm install --no-frozen-lockfile
    corepack pnpm --dir app typecheck
    corepack pnpm --dir app exec expo prebuild --platform android --no-install

Cross-repository GitHub Actions runs Android and iOS compile checks from a
pinned NYC-Tron commit. The temporary workspace is not committed or published.

## Engine limitation

The native screen calls createNitroHost and CadenceInstrumentSession.open.
Without an installed, registered native Forge Nitro v1 factory it **shows
an error**. It never swaps in a mock or uses the Node CLI on device.
Forge PRs #8–#10 still have iOS/Android Rust/C++ registration work, so
even a green native compile is not proof of real on-device engine calls.

Preview is local to the native view, while gain/pan commits, undo, redo and
NFD1 snapshots operate on the Rust document. The latter are covered by
real Rust CLI integration tests. This app uses Zustand only for UI state
and measures its own host width for phone, tablet and foldable responsiveness.

No Vercel deployments, raw HTML, Expo Audio or Expo Video.

## Integration build findings (November 5, 2026)

- TypeScript cross-repository installation and imports passed GitHub CI.
- Android initial Gradle configure failure was the demo package identifier ending in Java keyword 'native'. Corrected to ai.nitroforge.cadence.studio.
- iOS first CocoaPods attempt reached native dependencies but Nitro v1's NitroModules.podspec is deliberately source-empty. Nitro v1 uses SwiftPM. The integration workflow now tries React Native 0.88 experimental spm conversion; Expo SDK 58's SwiftPM path is preview-only. This is a platform integration gate, not evidence that SwiftUI or Forge C++ failed compilation.
- Neither built app has executed real Forge Rust operations on hardware. Do not claim otherwise.

## Nitro v1 constructor registration

This screen now calls createRegisteredForgeV1Host from the v1-native adapter. When the generated module in Forge's separate Ignition v1 branch is actually linked and native registered, add the following at the application startup:

    import { ForgeFactory } from '@nitro-forge/ignition-v1-lab';
    import { registerForgeV1Factory } from '@nitro-forge/ignition/v1-host';
    registerForgeV1Factory(new ForgeFactory());

Do not import legacy NitroModules.createHybridObject or mock a factory. Until native generated/C++ and Rust code is packaged, registration is absent and the screen intentionally shows a real error.

## Verified integration CI evidence

- [Android source/native UI compile passed — run 41961359554](https://github.com/mikevocalz/nitro-forge/actions/runs/41961359554) after fixing the invalid Java namespace. This does not prove Forge's native v1 C++/Rust registration.
- [Rust engine session and host tests passed — run 41961979522](https://github.com/mikevocalz/nitro-forge/actions/runs/41961979522), including the v1 wire adapter backed by the real Rust CLI.
- iOS native combined build remains blocked on the experimental SwiftPM integration; the first CocoaPods failure was caused by Nitro v1's intentionally empty Podspec. The first SPM attempt lacked the React Native CLI; the integration now pins RN 0.88-matched community CLI packages, pending a verified re-run.
- The cross-repository consumer TypeScript test passed on the combined sources. This is neither a device test nor proof of native JS-to-Rust linkage.

To avoid duplicate expensive native builds, the CI workflow now uses one PR trigger (plus manual dispatch) with a single latest-branch concurrency group.
