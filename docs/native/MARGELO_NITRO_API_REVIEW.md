# NF-03: Margelo Nitro + API design audit for Ignition's Rust bridge

**Status (2026-11-02):** The TypeScript bridge has been tightened and unit tests added in this PR. The native Nitro implementation, physical-device builds and per-document worker execution **are not complete**. This is a source-level audit with exact implementation gates, not a native test report.

## Source skills actually examined

All links are pinned to the reviewed source revision. These skill files were consulted as engineering guidance; skill text is not vendored into NitroForge:

| Skill | Pinned source | Consequence for this bridge |
| --- | --- | --- |
| Margelo API design | [`api-design/SKILL.md`](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md) | Clear session lifecycle, typed errors, public vs internal APIs, async methods for worker-bound operations, precise ownership |
| Margelo Nitro | [`build-nitro-modules/SKILL.md`](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md) | Codegen from `.nitro.ts`, native C++/Swift/Kotlin implementation matching generated signatures, default-constructible factory, explicit resource lifecycle |
| Margelo C++ | [`cpp/SKILL.md`](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/cpp/SKILL.md) | RAII session ownership, narrow C FFI wrappers, no locks around JS callbacks, one native worker ownership model |
| Margelo Swift | [`swift/SKILL.md`](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/swift/SKILL.md) | Only use main thread for UI; serial queue/native async method when Apple platform glue is needed; no arbitrary nested Task/DispatchQueue hops |
| Margelo Kotlin | [`kotlin/SKILL.md`](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/kotlin/SKILL.md) | Generated spec compatibility, explicit dispatchers and lifecycle, no callback-under-lock or main-thread document work |
| Expo overview and upgrade | [Expo skills](https://github.com/expo/skills/tree/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills) | Follow pinned SDK58 APIs, custom dev builds and Xcode/Gradle validation |
| No AI Slop | [source](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md) | Mark claims as observed/fixed/untested; avoid claiming source or CI checks prove native runtime |

### Files audited

- [`packages/ignition/src/Forge.nitro.ts`](https://github.com/mikevocalz/nitro-forge/blob/feat/skia-v3-runtime-validation-2026-11-02/packages/ignition/src/Forge.nitro.ts) — one Nitro Forge HybridObject interface; native implementation not created
- [`packages/ignition/src/host.ts`](https://github.com/mikevocalz/nitro-forge/blob/feat/skia-v3-runtime-validation-2026-11-02/packages/ignition/src/host.ts) — JS transport and error parsing
- [`packages/ignition/src/document.ts`](https://github.com/mikevocalz/nitro-forge/blob/feat/skia-v3-runtime-validation-2026-11-02/packages/ignition/src/document.ts) — public DocumentHandle, events and close
- [`rust/nf-sys/src/lib.rs`](https://github.com/mikevocalz/nitro-forge/blob/master/rust/nf-sys/src/lib.rs) — native C ABI functions and ownership
- [`rust/ignition-core/src/session.rs`](https://github.com/mikevocalz/nitro-forge/blob/master/rust/ignition-core/src/session.rs) — map of Rust engines, monotonically assigned u64 IDs
- [`docs/ARCHITECTURE.md`](https://github.com/mikevocalz/nitro-forge/blob/master/docs/ARCHITECTURE.md) — desired worker model; the real native implementation has not achieved it

## Findings with dispositions

### M-01 · Critical: Rust u64 IDs cannot be transported blindly through JS numbers

**Observed:** `SessionRegistry` issues `u64` handles. `Forge.nitro.ts` and `EngineHost` use JS `number`, which represents integer values exactly only up to `Number.MAX_SAFE_INTEGER`. An unsafe numeric handle can silently address the wrong session.

**Implemented in this PR:** `assertSafeEngineHandle` validates positive, finite, exact JS integers before forwarding. It checks `open`, `apply`, `snapshot`, `restore`, `undo`, `redo`, and `close`. Regression tests reject zero, negatives, fractional, infinities, NaN and `MAX_SAFE_INTEGER+1`.

**Release blocker:** the Rust/C++ bridge must never return a non-safe integer through Nitro. Prefer a dedicated `HybridDocument` with native-owned identity for a future v2 API instead of exposing raw `u64` globally. A decimal-string transport with strict native conversion is another option, but do not add ad hoc JS string-number conversion that weakens public typing. A new object interface needs codegen and migration tests before replacing the currently published TypeScript contract.

### M-02 · High: expensive open/close should not block the JavaScript/UI thread

**Observed:** original `Forge.openEngine`/`closeEngine` signatures were synchronous. Rust engine allocation and teardown may lock the registry or release large documents.

**Implemented in this PR:** the `Forge.nitro.ts` interface now declares `openEngine: Promise<number>` and `closeEngine: Promise<boolean>`. `ForgeNitro`, `NitroHost` and tests agree. The public `EngineHost` was already async, so callers do not need a new lifecycle shape.

**Release blocker:** generated native signatures and a real owned worker/dispatcher must be implemented. A Promise type alone does not move work off-thread; no native `Forge` has shipped.

### M-03 · Critical: `nf-sys` serializes engine work behind one global mutex

**Observed:** `nf_apply`, `nf_snapshot`, `nf_restore` and similar functions use `reg_lock()`. They execute document work while holding the registry mutex. This serializes unrelated sessions and conflicts with `docs/ARCHITECTURE.md`'s per-document worker claim.

**Release blocker:** move the engine operation to a session owner outside the short-lived registry lookup lock. Options: a map of independently synchronized session objects with a serial per-document executor, or an actor/worker owning each engine. The C++ Nitro layer must avoid scheduling an additional competing worker around an already-owned worker. Keep Rust `Engine: Send` (not `Sync`), and serialize commands/undo/snapshot/close for each document. A close racing with `apply` must have a deterministic result, with no use-after-free or accidental reuse of a stale handle.

**Required tests:** parallel long operations on two documents, concurrent close/cancel, FFI panic during one session without poisoning another, worker teardown and memory plateau over repeated open/close. The existing CLI and C FFI tests are not proof of this model.

### M-04 · High: native response frames were previously accepted without explicit success

**Observed:** `NitroHost.apply` treated `ok:false` as failure, but a malformed response missing `ok` could be returned as a success with undefined data.

**Implemented in this PR:** parse errors and status-free frames fail closed with typed `EngineError`. Invalid `events` structures are rejected rather than delivered to consumer UI listeners. Regression tests check malformed JSON, null, absent status and invalid events, preserving legitimate `ok:false` recoverable errors.

**Release blocker:** enforce the same response schema at generated C++/Rust boundaries, including bounded JSON length and unsupported protocol version handling; no unbounded user-controlled command dispatch.

### M-05 · High: C ABI raw allocations and panic boundaries need focused review

**Observed:** `nf_snapshot` provides `NfBytes` (exact boxed byte slice) freed through `nf_free_bytes`; `nf_apply` returns strings freed through `nf_free_string`. `nf_alloc_copy` takes raw pointer/length, builds a Vec and transfers ownership without an obvious matching public `nf_free_alloc_copy` path; this API must not be used by Nitro as-is. `nf_open` is not surrounded by the same `catch_unwind` barrier that most other exported operations use.

**Release blockers:** restrict JS-facing methods to a typed, allowlisted engine command API; validate input buffer length/pointers, overflow and allocation quotas; have an exact matching C ABI allocator/deallocator contract for every returned native resource. Implement the `nf_open` panic barrier without allowing a Rust unwind across `extern "C"`. Do not introduce arbitrary source file paths or raw pointers into JavaScript. Add ASan/UBSan or equivalent native memory instrumentation where available.

### M-06 · Performance: JSON commands and base64 snapshots are deliberate v1 copies

**Observed:** `applyJson` parses one JSON string; snapshots move encoded `NFD1` bytes as base64. This is safe to test with CLI parity but can allocate large temporary buffers.

**Release blocker:** benchmark actual document sizes and byte-copy costs on iPad/Android/desktop web before choosing shared buffers or GPU zero-copy. A Nitro `ArrayBuffer`/native memory handle may reduce copies later, but carries stricter ownership/close semantics. Do not claim Skia v3 shared Dawn gives Rust `wgpu` zero-copy.

### M-07 · Lifecycle and packaging remain unimplemented

**Observed:** `NitroHost.dispose()` is a no-op and the root HybridObject implementation is missing. The current `@nitro-forge/ignition` package includes a `.nitro.ts` spec and a `nitro.json`, not linked iOS/Android codegen artifacts. `DocumentHandle.close()` is idempotent at JS level but native race behavior still needs tests.

**Release blocker:** create a default-constructible Nitro factory; run Nitrogen from the actual installed Nitro version; implement generated C++ HybridObject signatures exactly; link Rust C ABI into iOS Pods and Android CMake/Gradle without fake Swift/Kotlin classes. Use Swift/Kotlin adapters only where platform APIs require them, and verify generated lifecycle/registration. Package generated code and native artifacts for clean consumer installs, not just monorepo builds. Test closing while async work is pending and disposal after app background/activity recreation.

## Suggested native API direction

**v1 safe migration:** retain the existing `EngineHost` Promise API and numeric handles only while JS-safe-number enforcement and native bounds hold. This PR strengthens that contract without changing the seven public engine package names.

**Preferred v2 shape for evaluation, not shipped:**

```ts
// Illustrative only — confirm all generated Nitro type support before coding.
interface ForgeFactory /* extends HybridObject */ {
  openDocument(kind: EngineKind): Promise<ForgeDocument>;
}
interface ForgeDocument /* extends HybridObject */ {
  apply(command: Command): Promise<CommandResult>;
  snapshot(): Promise<ArrayBuffer>;
  restore(bytes: ArrayBuffer): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  close(): Promise<void>;
}
```

A `ForgeDocument` owns a single native document and worker, and exposes no unsafe JS-number ID. The factory owns only construction/discovery, not a universal opaque command router. Keep semantic higher-level `@nitro-forge/prism` / `tally` / `quill` APIs deliberate; do not add magic string conversions or hidden defaults in JS. Migrate with an explicit new semver contract when implemented.

## NF-03 roster and pass gates

| ID | Owner role | Deliverable | Test/receipt | Current status |
| --- | --- | --- | --- | --- |
| API-01 | TS/API owner | Validate session IDs and in-band response frames | `nitro-host.test.ts`, Vitest CI | Code proposed, CI pending |
| API-02 | Nitro architect | Document factory vs session HybridObject ownership; decide v1/v2 strategy | reviewed generated spec + implementation plan | Design only |
| API-03 | C++ native lead | Generated HybridObject, async work and Rust FFI ownership | Nitrogen + Xcode/Gradle + live device | NOT RUN |
| API-04 | Rust FFI lead | Per-document execution, panic barriers, allocator/deallocator audit | cargo native tests, concurrency/panic corpus | NOT RUN |
| API-05 | iOS/Swift reviewer | Link Rust/C++ to iOS; MainActor/queue limited to platform UI | Xcode and iPad device logs | NOT RUN |
| API-06 | Android/Kotlin reviewer | Gradle/CMake/NDK, thread ownership and lifecycle | Android device + Surface Duo lifecycle | NOT RUN |
| API-07 | Security & performance | Bad handles, malformed JSON, memory pressure, cancellation, renderer textures | ASan/UBSan, stress, perf traces | NOT RUN |
| API-08 | API/release reviewer | Package exports, `NFD1` versions, errors, semver and test consumer | clean app installs on iOS/Android/web | NOT RUN |

### Work now verified vs still missing

The tests in this PR can establish **TypeScript contract correctness only**. A passing `pnpm -r typecheck`, JS bundle, or Vitest test cannot establish native Rust integration. `docs/ROSTER.md` remains the historical record of existing CLI/FFI tests, not a signoff for this new implementation.

**Cross-platform acceptance:** open a Prism document from a real native Nitro host, apply a layer/paint command, undo/redo, save a versioned `NFD1` snapshot, close/reopen, and compare the output against the CLI reference. Repeat on Metal iOS, Vulkan Android and web WASM using deliberately scoped adapters, with memory leak and responsive-pane lifecycle tests. Do not mark API-03..API-08 complete without that evidence.
