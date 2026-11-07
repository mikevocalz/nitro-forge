# Experimental react-native-video beta.12 / Nitro v1 port

## Result
Native implementation and packaging migration now exist as source, with generation, TypeScript/build and portable source checks passing. Native compilation and playback are NOT established.

Upstream commit: 321b868085e49669a6fe1aa1cfb58e64d63d326f (7.0.0-beta.12).
Fork manifest: 7.0.0-beta.12-nitrov1-experimental.0.
Exact Nitrogen, nitro-core and react-native-nitro-modules: 1.0.0-alpha.nightly.120.g33ef045b96c0.
Original MIT license preserved. No npm release. The recovered acceptance lab selects a local `.1` artifact; the source patch here declares `.0`, so the selected artifact is not reproducible from that original patch alone. A separate recovered `.1` patch now preserves the archive-matching source; see PROVENANCE.md. Regeneration and build-output comparison remain open. The recovered media-ui manifest keeps both its exact optional peer and local tarball development dependency, matching its preserved lockfile. A default-graph migration remains a separate reviewed manifest-and-lockfile operation.

## Implemented
- Seven decorated v1 classes, generated reexports/import map, three generated factory constructors and source identity checks.
- Kotlin companions, Callback listeners/emissions/removal callbacks, nonoptional nullable unions and source-first variant order, superclass disposal.
- Swift throwing initializers, specialized Promise pending/resolved APIs, Callback protocol listeners/callAndForget, explicit null track callbacks, union ordering and generated struct labels.
- Android generated JNI registration inside fbjni initialization, private header path, CMake 3.22.1, New Architecture guard, SDK 36/NDK 29 defaults and host override support.
- SwiftPM manifest with generated Nitro targets, separate ObjC++ Fabric target, generated app headers and Swift bridge linkage; discovery-only podspec replaces obsolete Ruby autolinking. Public imports are explicit under generated InternalImportsByDefault.
- Module-only Bob build, decorator syntax support, built React Native/source entrypoints, verified declaration paths and package import scope; React 19 renderer alignment and TS 7 removed-option cleanup.

- Registry dictionary mutations/reads are locked; six callback paths use snapshots outside locks. Plugin getters, awaits and removed-object release remain unlocked. Remote seeking captures a scalar; artwork is created on MainActor and rejects expired weak player/item references before identity checks. No unchecked Sendable or unsafe isolation was introduced.

## Verified
- Patch applies to exact pinned upstream; regenerated 7/7 specs.
- Actual Bob JavaScript and TypeScript declaration builds, no ambient shim. Web source excluded from declarations, as documented in tsconfig.
- Actual RN 0.88 Fabric parser emits RNCVideoView schema.
- Five Android source checks; 49 Swift generated method signatures,26 callback dispatches and Promise/nullable/constructor checks.
- Bounded concurrency source checks reject 15 deliberate regressions. These do not establish runtime thread safety; Thread Sanitizer and SDK builds remain required.
- npm pack dry-run includes entrypoints, generated runtime and Package.swift; no nested lib package.json hides imports.
- These checks do not compile Kotlin, C++, Swift or ObjC++, and do not execute upstream unit/device suites.

## Required native environment and open gates
- Android: RN 0.88 New Architecture host with exact pinned Nitro runtime, Java 21 recommended, SDK 36/build-tools 36.0.0, NDK 29.0.14206865, CMake 3.22.1+, AGP 9.3.1 and Gradle 9.5+. AGP 9.3's minimum Gradle is 9.5.0: https://developer.android.com/build/releases/agp-9-3-0-release-notes . Existing upstream test-app wrapper 8.11.1 is not migrated and cannot validate this port.
- Set `newArchEnabled=true`, `android.builtInKotlin=false`, `android.newDsl=false` in HOST gradle.properties. The pinned Nitro runtime still applies external Kotlin and generated autolinking uses legacy source sets; library now fails clearly if opt-outs are missing. Host property compatibility still needs an actual build.
- Apple: macOS/Xcode with Swift 6.4-capable SwiftBuild/RN 0.88 SwiftPM integration, generated ReactNative xcframeworks and React-GeneratedCode package, iOS 16+ target. Resolve/build the manifest inside RN's generated autolinking layout, not standalone in npm source.
- Compile all ABI implementations and Fabric links; review Swift 6 Sendable/actor isolation without blanket unchecked conformances. Static review identifies non-Sendable mutable shared instances in PluginsRegistry.swift, VideoManager.swift and NowPlayingInfoCenterManager.swift as remaining Swift 6 concurrency blockers. AVFoundation lifecycle and Callback.native captures are not concurrency-validated.
- Confirm player/source create, prepare, play/pause, seek, replace, errors, listener removal/disposal and unmount on iOS/Android devices. Then test web separately and Meta VR on target hardware; no support inferred from Android builds.
- Test PiP/fullscreen, DRM, background/foreground/audio focus, release builds and all supported source formats before claiming support. Playback is not timeline editing or export.

## Environment limit
The earlier port report came from a Linux workspace without Android SDK/NDK or Xcode. That historical environment limit is not a description of the recovered macOS workspace. Native builds and runtime validation of this candidate have not been performed in this source-review phase. The recovered acceptance lab remains explicitly selected in its own manifest and locks; it is not approved for production. There is no Expo Video fallback or Nitro downgrade.
