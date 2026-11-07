# P10 registered photo catalog independent review

2026-11-07. Inspected current photo Rust model/tests, typed wrapper, Rust/CLI/FFI factories, fixed checkpoint tags and Nitro enum conversion source. No tests, native builds or device actions run by this reviewer.

## Findings corrected

Both initial correction gates are closed in inspected source. PhotoDocument.openSnapshot delegates to the shared DocumentHandle.openSnapshot helper, which checks the 256 MiB boundary and copies Uint8Array.from(bytes) before starting asynchronous session allocation. The existing openInitialized owner performs restore and releases unpublished failed sessions. The photo owner reports three focused delayed-Buffer/subview/cleanup cases passed; this reviewer did not rerun them.

The current lock includes the packages/photo importer with the workspace Ignition link and existing TypeScript 7.0.2 resolution. Inspection of the staged lock diff confirms only this importer was added; unrelated baseline lock changes are excluded from the staged delta. This source check does not claim a fresh frozen-lock installation was run.
## Inspected invariants

All seven existing persisted NFC1/NCC1 tags and generated Nitro enum ordinals remain 0..6; Photo is appended as 7. Rust parsing/naming and CLI/FFI factory dispatch include photo. The typed old native binary still requires rebuilding for photo support; no native ABI execution is established here.

Photo applies edits to a structural candidate sharing immutable records through Arc, validates before journaling and replaces only on success. Record mutation uses copy-on-write. Reads/equal candidates do not clear redo. Batches stage a separate engine and commit once only after all steps succeed. Restore validates envelope length, explicit photo/schema identity, unknown fields, references, labels, hash uniqueness and counters before replacing state/history. Existing full-state journal entries preserve immutable descriptors, version identity and deletion restoration. Counter exhaustion rejects before candidate commit.

Logical limits bound encoded state to 8 MiB, originals to 10,000, versions to 100,000 and per-original versions to 1..100, with 16 history entries. Validation serialization/candidate parsing still allocates; these are logical bounds, not measured process RSS guarantees. Original descriptors and claimed hashes are host-provided metadata, not verified asset bytes or RAW decode evidence. Restore can replace the complete catalog by design. No decoder/job/retention/UI completion or full P10 acceptance follows from registration.

Regression source covers invalid/no-op history, atomic batches, foreign/malformed/oversized restore, limits, record sharing and CLI/FFI registration. Reported test execution belongs to the implementing owner; this review did not rerun it.
