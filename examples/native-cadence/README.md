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
