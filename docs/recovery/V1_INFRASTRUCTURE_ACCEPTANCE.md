# Shared infrastructure acceptance, November 10, 2026

This audit extends the existing Ignition owners. It adds no parallel UI or
replacement engine API. Work began from Forge `f9fae4c` on
`codex/v1-platform-completion`. The canonical completion ledger is maintained
separately; this report records source changes and executed evidence.

## Changes and ownership

| Row | Existing owner | Changes and evidence |
| --- | --- | --- |
| N-10 | `packages/ignition/src/autosave.ts` | Close now drains any current save and takes a final queued native snapshot. A submitted edit can complete after change listeners detach; the final save includes it. Rejected shutdown persistence remains observable. Real CLI recovery now covers all eleven registered engines. |
| N-11 | `packages/ignition/src/collaboration.ts` and `collaboration-http.ts` | Initialization commands are owned before asynchronous allocation; remote restore captures bytes/revision before yielding; pending lost-ACK bytes and provider input are independent copies. HTTP uploads copy the selected view, including Node Buffer inputs, instead of exposing their whole backing allocation. Generic describe supplies the object payload required by newer engines. Revision/CAS and explicit conflict behavior are unchanged. |
| N-13 | Native `ForgeDocument` / `ForgeTask`, `SerialQueue`, Rust `TaskContext` | Existing real owners passed FIFO/destruction tests, running Cadence cancellation, DSP output parity and native task-control lifetime checks. Added a generated-binding native acceptance routine and CI app-launch gate. Cancellation remains cooperative at safe engine checkpoints. |
| N-14 | Native `ForgeMediaCache` / `ByteCache` | Cache insert/replace allocates before evicting. Allocation failure retains previous entries, LRU order and byte accounting. Failed read allocation also retains LRU order. The HybridObject reports retained payload size through Nitro's external-memory hook. A standalone allocation-failure test also checks the 4096-entry metadata bound. |
| N-15 | `packages/ignition/src/transactions.ts` and engine `__batch` | History admission retires a preview directly into committing, preventing a synchronous observer from admitting a competing gesture. Completion clears ownership and publishes state in one handler. Reentrant close returns one promise. The real Rust compound-edit/undo/redo/rollback matrix now covers all eleven engines. |
| N-16 | Native `ForgeDocument.applyBinary`, snapshots and Rust binary C ABI | Existing raw input/output and cancellation tests pass. The new native acceptance routine checks mutable input isolation, owned restore bytes, raw output without base64, and output lifetime after source-document close through the actual generated binding. |
| N-18 | `packages/telemetry` | `Span.end()` returns whether it recorded in its original consent period; related async failures/result metrics use that result. Revocation cannot resurrect old work after consent returns. Error codes obey identifier bounds. Diagnostics have one active sink batch and a bounded latest-event queue; unsent work drops on revocation. |

## Reproduced defects

Before the corresponding fixes, four collaboration ownership regressions
failed, nine telemetry regressions failed, and two transaction lifecycle
regressions failed. The standalone C++ test aborted because a failed cache
allocation had already evicted data/changed accounting. Each of these
regressions passed after its fix. Extending the real-engine collaboration
matrix exposed the missing describe payload in the shared adapter.

Draft's `source_revision` is an owner-local stale-input token. A successful
restore advances that token while preserving the persisted document. The
cross-engine tests compare durable state without requiring token equality;
the native engine verifier still requires rejected restoration to leave the
complete current description, including the token, unchanged.

## Executed locally

- `cargo test --locked --workspace`: passed, including every Rust engine,
  nf-sys binary/transaction contracts and ignition-core task ownership.
- `cargo build --locked -p nf-cli -p nf-sys`: passed; integration suites use
  the real resulting Rust CLI/archive.
- Full `@nitro-forge/ignition` suite: **95 passed**, including shutdown,
  all-engine checkpoint/collaboration round trips, failure/recovery ownership,
  transactions and native-host transport contracts.
- Full `@nitro-forge/telemetry` suite: **24 passed**, including real Prism
  integration, consent boundaries, sink backpressure and error isolation.
- Full `@nitro-forge/collaboration-server` suite: **9 passed**, including
  authorized HTTP/SQLite persistence, service/process restart, concurrent CAS,
  conflict preservation, metadata watch cancellation and deadlines.
- Ignition, telemetry and collaboration-server TypeScript checks: passed.
- `tooling/native/serial_queue_test.cpp`: compiled and ran with C++20,
  `-Wall -Wextra -Werror`; passed.
- `tooling/native/byte_cache_test.cpp`: compiled and ran with the same flags;
  passed deterministic allocation failures, replacement, failed-read LRU,
  capacity and zero-byte-entry bounds.
- `tooling/native/nf_v1_cpp_smoke.cpp` linked against the freshly built
  `libnf_sys.a`: passed the actual C++/Rust session, task-control, raw snapshot,
  cancellation, cache ownership and lifecycle checks.
- Factory/document/generated implementations compiled against installed
  Nitro nightly 120 and React Native 0.88.1 headers with warnings as errors.
- Standalone `examples/native-cadence` frozen install and TypeScript 6.0.3
  check: passed. Its actual Expo Metro Android and iOS exports passed
  (851 and 869 modules respectively).
- Updated workflow YAML parses and the native acceptance runner passes
  Node's syntax check. No native device runtime was executed locally.

## Native runtime gate

`examples/native-cadence/verify-native-runtime.ts` constructs the generated
`ForgeFactory` directly. The existing consumer exposes it through a button
and the opt-in `FORGE_ACCEPTANCE=runtime` entry. It owns and closes each
factory/document/task/cache resource independently. Missing registration or
runtime failure is an error; no mock, CLI or alternate transport is admitted.

The existing `cadence-native-consumer.yml` iOS/Android jobs now launch their
built apps through `tooling/native/run-runtime-acceptance.mjs`. Android reads
the actual acceptance screen's accessibility hierarchy; iOS reads the native
simulator app console. The runner requires all eight checks, platform and
matching source commit, then retains `result.json`, a screenshot and logs.

These launch gates are **pending remote execution** at the time of this
report. Native compilation, Metro export and the C++/Rust tests above do not
constitute native JS/device acceptance. The gate is satisfied only by the
result artifacts from a successful app launch at the reviewed commit.

## Remaining contract boundaries

Storage/authentication providers retain their existing application-owned
contracts. Collaboration provides atomic revision/CAS with explicit conflict
resolution, not automatic CRDT merging. A telemetry sink owns network
deadlines; revocation can drop unsent batches but cannot recall an already
delivered batch. Media cache capacity bounds retained payload, with separately
bounded keys/entry count; temporary owned input/output copies are additional
memory. Binary transport uses owned copies, not zero-copy GPU interop.
Native decoder cancellation and XR/input are outside these seven owners.
