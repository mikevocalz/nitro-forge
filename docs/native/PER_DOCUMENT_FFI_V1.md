# Nitro v1 Rust FFI: document isolation and native ABI

**Scope:** Implement a separate v1 C ABI for the existing Ignition engines without changing the legacy nf_* entrypoints, the seven public product packages or the NFD1 format.

## Actual implementation

- rust/nf-sys/src/session_registry.rs implements ConcurrentSessions: a short-held global lookup map, one mutex per document, monotonic non-reused signed 64-bit handles, close-state gating and per-session panic isolation.
- rust/nf-sys/src/ffi_v1.rs exposes nf_v1_open, nf_v1_apply, nf_v1_snapshot, nf_v1_restore and nf_v1_close. Commands are length-bounded to 32 MiB; NFD1 snapshots to 256 MiB. Native sessions are never converted to JavaScript Number in the v1 class API.
- rust/nf-sys/include/nf_v1.h documents borrowed input buffers and exact paired Rust deallocators.
- tooling/native/nf_v1_smoke.c is an independent C caller which opens Tally, edits, saves NFD1 bytes, restores and closes.
- Existing nf_* functions remain unchanged, so this PR cannot be described as a complete Nitro v1 bridge.

**Threading caveat:** per-document serialization here permits concurrent operations on unrelated documents; it does not schedule operations off the UI thread. The generated C++ Nitro v1 implementation must dispatch work on owned background workers. No one should claim that a synchronous C ABI + Promise type automatically provides async performance.

## Independent workstream roles — scoped for parallel review

| Workstream | Role | Changed files | Evidence needed | Status |
| --- | --- | --- | --- | --- |
| RUST-01 | Rust concurrency reviewer | session_registry.rs | simultaneous slow+fast sessions; panic isolation; close-vs-apply; no global lock during engine operation | CI pending |
| RUST-02 | Rust FFI/security reviewer | ffi_v1.rs, nf_v1.h | null/length/bounds validation, handle exhaustion, panic barriers, allocator pairs, malformed NFD1 | CI pending |
| RUST-03 | C ABI integration reviewer | nf_v1_smoke.c | external C program links libnf_sys.a; open/edit/snapshot/restore/close | CI pending |
| NITRO-01 | C++ bridge reviewer | future HybridForgeFactory/Document | compile against generated v1 exact headers, RAII native ownership and Promise resolution | NOT RUN |
| APPLE-01 | Swift/Apple reviewer | future native packaging | SDK58 iOS16.4+, Swift/C++, physical Metal iPad | NOT RUN |
| ANDROID-01 | Kotlin/Android reviewer | future native packaging | Android API26+, JNI/CMake/Gradle, Vulkan device, Duo lifecycle | NOT RUN |
| QA-01 | Security/perf reviewer | CI, device tests | stress sessions, malicious imports, cancellation, leaks, branch SHA receipts | NOT RUN |

These are roles, not claims that autonomous subagents or independent reviewers have executed the work.

## Required pinned engineering skills

- [Margelo API Design](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md): explicit lifecycle, method status/error and resource ownership.
- [Margelo Build Nitro Modules](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md): generated HybridObject native adapters, C ABI and worker semantics.
- [Margelo C++](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/cpp/SKILL.md): RAII, independent executor/thread, no callback under lock.
- [Margelo Swift](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/swift/SKILL.md) and [Kotlin](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/kotlin/SKILL.md): platform lifecycle and appropriate DispatchQueue/coroutine ownership.
- [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md), [Callstack RN best practices](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md).

## Test gates
1. Rustfmt scope: only new Rust modules. Existing engine files have pre-existing rustfmt differences; do not mass-reformat unrelated engines in this PR.
2. cargo test -p nf-sys --locked, including per-session concurrency and raw ABI tests.
3. cargo test --workspace --locked, confirming all seven Rust products and Ignition contracts.
4. cargo build -p nf-sys --release --locked, then compile/run external C harness.
5. Future native C++ v1 bridge must call these symbols from a background executor and prove safe close/reopen, no double frees, and compatibility with codegen output.
6. iOS/Android/Web, Skia v3 Graphite and PDF/DOCX/XLSX editing are separate gates—not passed by Linux Rust CI.

## Security follow-ups
- Incoming raw C pointers cannot be validated as genuine mapped memory by Rust; only trusted native callers pass valid pointer+length pairs.
- All native buffers must have an explicitly paired allocator/deallocator. Avoid the legacy nf_alloc_copy interface until audited.
- Large commands/snapshots have conservative size limits. Consider per-engine budgets, decompression limits and cancellation after real device load testing.
- Document FFI panic isolation and close semantics are tested here; the separate legacy FFI still has a global lock.
