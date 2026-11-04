# Shared host Nitro v1 integration

The existing `@nitro-forge/ignition` package now owns the v1 bridge. There is no
second lab package in the shared app. `createNitroHost()` lazily loads Nitrogen's
`ForgeFactory` constructor (`getHybridClass`), opens one native `ForgeDocument`
per public handle, and adapts its typed result/events and binary snapshots to the
existing seven-engine API. A per-document FIFO submits work in invocation order; Rust sessions serialize access independently.
Closing or disposing the host releases documents, including opens racing disposal.

## Reproduce

After the workspace's frozen install:

1. `pnpm --filter @nitro-forge/ignition codegen`
2. `pnpm --filter @nitro-forge/ignition typecheck`
3. `pnpm --filter @nitro-forge/ignition exec vitest run tests/nitro-host.test.ts`
4. `cargo test -p nf-sys && cargo build --locked -p nf-sys`
5. `g++ -std=c++20 -I packages/ignition/cpp tooling/native/nf_v1_cpp_smoke.cpp packages/ignition/cpp/ForgeRustSession.cpp target/debug/libnf_sys.a -ldl -lpthread -lm -o target/nf-v1-smoke && target/nf-v1-smoke`

Nitrogen output is committed to make Metro/SwiftPM/Gradle consumers deterministic.
Regenerate it after spec changes and review the diff. The copied `cpp/nf_v1.h`
must remain identical to `rust/nf-sys/include/nf_v1.h`.

## Native archives and linking

Android: install Rust targets and cargo-ndk, set `ANDROID_NDK_HOME` to the app's
NDK, then run `bash packages/ignition/scripts/build-android.sh`. Defaults are
armeabi-v7a, arm64-v8a (including the Meta Quest Android target), x86 and x86_64.
Gradle honors the app reactNativeArchitectures property, defaulting to the same
four ABIs. To build a subset, pass the matching ABI arguments
to build additional supported Android targets. CMake links the produced static
archive, generated specs and JNI registration into `NitroForgeV1`; the autolinked
ReactPackage loads that library. Missing archives fail with a preparation message.

Apple: on a Mac with Xcode and Rust `aarch64-apple-ios` and
`aarch64-apple-ios-sim` targets, run `bash packages/ignition/scripts/build-apple.sh`.
This produces the local XCFramework required by `Package.swift`. The podspec is
for RN dependency discovery only; Nitro v1 uses SwiftPM, including generated
Objective-C class registration. The first archive supports iPhone arm64 and Apple
Silicon iOS simulators, not Intel simulators or other Apple platforms.

Run these archive commands before Expo native prebuild/build. They do not download
toolchains or change credentials. Native outputs are intentionally ignored, not
claimed as prebuilt binaries. This source-monorepo integration is not yet a
standalone npm-distribution artifact.

## Verification at integration time

- PASS: actual Nitrogen alpha-nightly.120 codegen, both HybridObjects and generated SwiftPM section.
- PASS: TypeScript 7.0.2 ignition typecheck.
- PASS: seven Vitest 5.1.0 adapter tests (typed commands/events, binary subviews, close,
  error conversion, dispose, open/dispose race, and concurrent disposal).
- PASS: g++ C++20 syntax checks on native session, v1 implementations and generated
  Android class registration against Nitro alpha120 and React Native 0.88.0 headers.
  Upstream headers were system includes to avoid Clang-specific warnings under GCC.
- PASS: native FIFO lifetime, ordering, rescheduling and schedule-failure test.
- PASS: shell syntax checks for archive scripts.
- NOT RUN here: Rust tests/link smoke (Cargo absent), Android NDK/Gradle link,
  Apple Xcode/SwiftPM link, or live iOS/Android/Meta device launch.

Web must continue using its web host. No Nitro import should be invoked on web.
Binary snapshots remove the old base64 transport; this does not claim zero-copy
GPU/Skia interoperability or headset interaction/device parity.
