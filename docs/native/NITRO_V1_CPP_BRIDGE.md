# Nitro v1 native C++ bridge implementation — workstream roster

**Scope:** Connect v1 Nitrogen-generated native classes to the real Ignition Rust FFI. This branch is stacked on [PR #9](https://github.com/mikevocalz/nitro-forge/pull/9); the v1 alpha package, generator and public TS class specs remain on [PR #8](https://github.com/mikevocalz/nitro-forge/pull/8). Do not merge directly into master before prerequisites.

## Code implemented in this branch

- packages/react-native/cpp/ForgeRustSession.hpp/.cpp: app-neutral, C++20 RAII ownership of one Rust native handle. Uses nf_v1_open, nf_v1_apply_parts, nf_v1_snapshot, nf_v1_restore, nf_v1_close and the paired Rust deallocators.
- packages/react-native/cpp/HybridForgeFactory.hpp/.cpp: concrete C++ class implementing the exact generated HybridForgeFactorySpec signature. Opens a ready Rust-backed document on Nitro's worker thread via Promise::async.
- packages/react-native/cpp/HybridForgeDocument.hpp/.cpp: implements generated ForgeDocument methods; native actions are async, bytes transferred using owning ArrayBuffer, event arrays converted from structured Rust command results.
- tooling/native/nf_v1_cpp_smoke.cpp: independently compiled C++ test calling the optimized Rust staticlib, with save/reopen/close, invalid payload rejection and cleanup.
- Two scoped workflows: optimized Linux Rust+C++ smoke, and a separate Nitrogen generation + C++ syntax/ABI signature check.

## Actual generated Nitro v1 contract inspected

From the v1 codegen CI artifact at commit [PR #8](https://github.com/mikevocalz/nitro-forge/pull/8):
- HybridForgeFactorySpec::open(ForgeEngineKind) returns Promise<std::shared_ptr<HybridForgeDocumentSpec>>
- HybridForgeDocumentSpec::apply(const ForgeCommand&) returns Promise<ForgeCommandResult>
- snapshot() returns Promise<ArrayBuffer>; restore(const ArrayBuffer&) returns Promise<void>
- getKind() returns ForgeEngineKind; undo/redo return Promise<bool>; close returns Promise<void>
- ForgeEngineKind values are PRISM/CADENCE/SPLICE/FOLIO/PITCH/TALLY/QUILL
- ForgeCommand fields are op, optional numeric schema version, optional payloadJson
- ForgeCommandResult has dataJson string and a vector of ForgeEvent(kind, optional detailJson)

No handcrafted generated files were committed. Implementations derive from generated spec headers.

## Ownership and threading

- Each ForgeRustSession has an atomic handle and closes it exactly once via exchange(0). Rust close blocks until in-flight same-document operations complete, then drops that engine.
- Every C error/string/event/snapshot buffer returned from Rust is wrapped in a C++ RAII scope that invokes its corresponding Rust free function once. Strings needed after return are copied into native C++ strings first.
- Promise::async dispatches Rust engine work from a Nitro worker pool rather than running it on JavaScript/UI thread. The C++ wrapper itself is synchronous native code; only the HybridObject schedules.
- restore takes ArrayBuffer::asOwning() before scheduling, because a JS-backed ArrayBuffer's data can be invalid after leaving the JS Runtime thread. Snapshot transfers a moved C++ owned vector into a native ArrayBuffer. This is **not zero-copy Rust-to-Skia** and needs native memory benchmarks.
- The named command envelope uses Rust's structured nf_v1_apply_parts to prevent C++ command concatenation/injection. Serialized JSON payloads remain for heterogeneous engine formats until Nitro's named nested JSON support is verified.
- Avoid holding mutexes while calling JS/Nitro. C++ lifetime captured through shared_ptr in async callbacks, with Rust providing per-document session locking.

## Independent workstream roster

| ID | Role | Deliverable | Proof gate | Current status |
| --- | --- | --- | --- | --- |
| CPP-01 | Native C++ reviewer | RAII Rust handle, error/result buffers and exception semantics | Linux optimized C++ + Rust smoke | CI verification |
| CPP-02 | Nitro generator reviewer | Exact generated factory/document class inheritance + method overrides | Nitrogen and C++ syntax check | CI verification |
| CPP-03 | Rust concurrency reviewer | No registry-global engine blocking, close and panic isolation | PR #9 full Rust workspace tests | Passed on PR #9 |
| APPLE-01 | Apple/Swift reviewer | Apple framework/SwiftPM/Xcode linking of generated v1 C++, Rust, and Skia v3 | real iOS16.4+ iPad build and lifecycle | NOT RUN |
| ANDROID-01 | Android/Kotlin reviewer | CMake/JNI/Gradle native module autolinking | real Android API26+ and Duo device test | NOT RUN |
| GPU-01 | Skia v3 lead | Pixel parity and native buffers into Graphite Canvas | Metal/Vulkan device and memory traces | NOT RUN |
| QA-01 | Cross-platform verifier | native open/edit/undo/snapshot/restore/close plus screen-reader/resize | iOS/Android/web and CI screenshots | NOT RUN |
| REL-01 | SDK maintainer | npm packaging, generated native files, headers, SwiftPM/Podspec/Gradle and transitive licenses | external consumer clean install | NOT RUN |

## Required pinned skills

- [Margelo API design](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md) and [build-nitro-modules](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md) — direct native object API, explicit construction and cleanup, generated bindings.
- [Margelo C++](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/cpp/SKILL.md) — native RAII, ownership, no overcomplicated thread hops.
- [Margelo Swift](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/swift/SKILL.md) and [Kotlin](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/kotlin/SKILL.md) — iOS/Android native integration and lifecycle.
- [Official Nitro v1 codegen README](https://github.com/margelo/nitro/blob/v1.0.0-alpha.nightly.115.gcdaf72e60229/packages/nitrogen/README.md) — exact alpha generator source; overrides 0.x examples when syntax differs.
- [Expo overview](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-overview/SKILL.md), [React Native performance](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md), [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md).

## Explicit exclusions and remaining checks

A Linux syntax check against generated headers and an independent C++ C ABI test are not the same as a linked Nitro HybridObject in an iOS/Android Expo dev build. Native packaging still needs verified CMake/Gradle, Apple Podspec/SwiftPM, generated artifacts and Rust staticlib integration. UI remains separate and shared across apps through the Expo UI/adaptive/Tailwind system. This branch does not alter Skia v3 versions, published APIs, Moyo imports or production binary releases.

An independent agent/subagent can take each row above in its own branch after explicit assignment. This document is not evidence that such an agent ran.


## New native package
`@nitro-forge/react-native` now owns this C++ implementation in `packages/react-native`. This was moved, not copied, from the temporary lab. Do not preserve two divergent native implementations. Platform setup and actual Xcode/Gradle linkage remain separate release gates.
