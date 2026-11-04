# Experimental react-native-video beta.12 / Nitro v1 port

## Result
Bounded factory migration is implemented in isolated source and passes real TypeScript plus Nitrogen generation. Full native support is NOT established: Swift/Kotlin ABI adaptation and Apple build-system migration remain substantial work requiring SDK builds.

Upstream commit: 321b868085e49669a6fe1aa1cfb58e64d63d326f (7.0.0-beta.12).
Fork manifest: 7.0.0-beta.12-nitrov1-experimental.0.
Exact Nitrogen, nitro-core and react-native-nitro-modules: 1.0.0-alpha.nightly.120.g33ef045b96c0.
Original MIT license preserved in UPSTREAM-LICENSE. No publication, original checkout edits, or remote changes.

## Implemented in combined 17-file patch
- Replaced seven HybridObject interfaces with Apple/Android-decorated exported declare classes; factories have public constructors. Flattened native base members, preserving overrides and excluding JS-only generic addEventListener, which is also absent from original generated native spec.
- Migrated nitro.json naming, removed old autolinking map, and added package #nitro imports/spec generated reexports.
- Replaced three createHybridObject calls with generated factory class construction.
- Added three Kotlin factory companion implementations of generated Spec.Companion.constructor().
- Added three Swift factory required override throwing initializers calling try super.init().
- Replaced obsolete source obj.name identity test with generated VideoPlayerSource instanceof check.
- Updated Fabric spec to React Native public codegenNativeComponent / CodegenTypes imports for RN 0.88.
- Pinned exact v1 runtime/generator, RN >=0.88 peer, tested dev versions and explicit experimental fork version.

## Verified
- Combined patch applies cleanly (`git apply --check`) against pinned upstream.
- Exact v1 Nitrogen generated 7/7 hybrid objects, Apple Swift and Android Kotlin. Original specs fail config schema before conversion. Temporary generator logs were inspected; generated output is not shipped here.
- Full native-source TypeScript probe exits 0 using genuine React Native 0.88.0, React/@types/react 19.3.0, TypeScript 7.0.2, @types/node 26.6.6 and @expo/config-plugins 10.0.2. Web sources are excluded. No ambient shim was used. Exact config in README.md.
- Actual RN 0.88 TypeScript Fabric parser accepts changed imports and emits RNCVideoView schema in the isolated probe.
- Existing optional Expo config-plugin tooling was installed only for source checking. No Expo Video or Expo Audio added.

## Remaining source/build blockers
- Kotlin and Swift nullable union ABI changed. replaceSourceAsync variants are reordered and now nonoptional; selectTextTrack and onTrackChange callbacks also lose optionality. Native implementations still use old generated signatures/variant cases and must be reconciled.
- Swift Promise is now a protocol: return types become any Promise<T>; existing Promise<T>() construction needs generated specialization .pending() (e.g. Promise_void.pending()), with Sendable/concurrency review.
- Non-factory Swift implementation initializers still call nonthrowing super.init() but generated bases now throw. Update propagation/handling and compile-check constructor conformance/visibility.
- Apple output now lives under generated/apple and emits separate AppleCxx/SwiftBridge modules. Original podspec references removed generated/ios/ReactNativeVideo+autolinking.rb. Create/update SwiftPM integration and reconcile Fabric/native source layout. No Package.swift was authored in this bounded probe.
- Generator warns original Bob nested output package.json files hide #nitro imports. Fix module-only esm:false packaging or prove equivalent mappings for every published scope before release.
- Android JNI/CMake/Gradle integration, Swift concurrency, and runtime source lifecycle still require actual compilation and device tests. Neither Kotlin nor Swift factory edits have been compiler-validated.
- Original upstream react-test-renderer 18.3.1 and its v18 types remain unchanged; align them with React 19 before running the full upstream test suite. The isolated typecheck does not execute those tests.
- React Native >=0.88 is explicit; no downgrade and no support assertion for older RN.

## Stop condition
No Android SDK/ANDROID_HOME, Swift compiler, Xcode, or device available here. Native builds and playback were not attempted. No web, Meta VR, DRM, full-screen, PiP, lifecycle or release tests were performed. Generator/TS success must not be presented as native runtime compatibility. The combined patch is exploratory upstream port material, not a dependency override safe to enable in Forge.
