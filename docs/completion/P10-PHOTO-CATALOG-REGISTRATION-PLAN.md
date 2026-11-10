# Proposed registered P10 photo catalog slice

Design for review before shared interfaces change. The successful LibRaw/Prism prototype does not supply a catalog engine. This slice supplies durable catalog identity and editing state; it does not perform RAW decoding, develop rendering or native file I/O.

## Exact registration touchpoints

- Add `packages/photo/rust/{Cargo.toml,src/...}` implementing the existing Engine trait; workspace `packages/*/rust` already discovers it. Add the crate to `rust/nf-cli/Cargo.toml` and `rust/nf-sys/Cargo.toml` and their respective factories. Cargo.lock changes follow source dependency resolution, with no new external crate required.
- Append `Photo` after `Quill` in `rust/ignition-core/src/engine.rs`; add parse/as_str mapping. Update the advertised protocol kinds in `rust/ignition-core/src/protocol.rs`. Add factory/protocol/FFI focused coverage; preserve all existing names and order.
- Append `photo` to `packages/ignition/src/types.ts` and the union in `contracts.ts`. Add fixed tag `photo:7` in **both** `autosave.ts` (NFC1) and `collaboration-checkpoint.ts` (NCC1); existing tags 0–6 must remain unchanged. NFC1/NCC1 reject unknown tags; old consumers will reject photo checkpoints rather than reinterpret existing data.
- Regenerate `packages/ignition/src/specs/ForgeFactory.nitro.ts` dependencies using pinned Nitro v1 `pnpm --filter @nitro-forge/ignition codegen`. Generated ForgeEngineKind must retain existing seven enum ordinals and append PHOTO=7. Review the complete generated diff; do not hand-edit generated declarations/converters. Add the PHOTO case to `packages/ignition/cpp/HybridForgeFactory.cpp` so it opens `photo`. The async worker/session ownership stays unchanged.
- Add `packages/photo/{package.json,tsconfig.json,src/index.ts,tests/...}` following DocumentHandle and workspace conventions, without adding it to an application/default product selection. Add its authoritative ENGINE_OPS section and source report. Keep releases/pins unchanged.
- `rust/nf-sys/src/ffi_binary.rs` dispatches through the selected engine; no new binary-input operation is proposed. `photo` inherits the empty binary-input allowlist, rejecting unsolicited sidecars. Existing nf_v1 layouts, function signatures, native document resource ownership and NFD1 envelope bytes do not change.

## Bounded schema and operation proposal

Snapshot JSON inside existing NFD1 is `{kind:"photo",schema:1,next_id,originals,versions}`. Use generated string ids (`original-N`, `version-N`) so identifiers do not cross JS as potentially imprecise u64 numbers. Checked monotonic allocation; validate ids and uniqueness on restore. Proposed caps: 10,000 originals, 100,000 total versions, 100 versions per original; reject overflow before mutation. These are collection limits, not a total process-memory guarantee.

An original stores immutable id, lowercase 64-hex SHA-256, opaque durable host asset key (bounded ASCII identifier, not a live pointer), byte length, bounded camera make/model, rating 0–5 and at most 32 unique bounded labels. Engine does not verify hash/asset availability or probe metadata: the host must obtain them from actual persisted originals and the admitted decoder. Do not place original bytes, LibRaw handles, transient cache keys or filesystem objects in this schema.

A version stores id, original id and bounded display name. The first version is created atomically with its original; it represents a persistent version identity, not an implemented develop recipe or processed image. No edits/preview parameters are invented. Every original retains at least one version.

Proposed ops:

- `new` resets a catalog; `describe` and `readOriginal` are read-only.
- `addOriginal` validates the complete immutable descriptor, creates original+initial version in one undo entry and returns their ids. Decide duplicate-content policy explicitly: proposed reject repeated content hashes to prevent two catalog records silently asserting different host assets for the same import.
- `removeOriginal` removes its catalog metadata and versions atomically, without deleting host asset bytes.
- `setRating` / `setLabels` replace editable metadata, with eventless same-value requests.
- `createVersion` / `renameVersion` / `removeVersion` manage identity/name only; deleting an original's last version rejects.

All writes validate completely before mutation and journal exactly once when changed. Batches use the existing staged engine mechanism, with one outer undo step; inner failure leaves live state/history unchanged. Restore validates kind/schema, counters, all limits/types, ids, unique hashes, version references and required per-original versions before replacing state. Invalid restore preserves redo history. Successful restore clears the prior document journal as existing engines do.

## Risks and review checks

New EngineKind is cross-cutting: exhaustive Rust matches, generated native enum conversion and fixed persisted tags must agree. Focused checks must assert old NFC1/NCC1 bytes/tag values unchanged, photo roundtrip through both formats, native PHOTO=7, CLI/FFI open/close and rejection of unsupported binary input. Native binaries compiled before registration cannot open photo and need rebuilding before a native support claim.

New photo snapshots explicitly reject other engine payloads; this change does not silently harden or claim to fix all older engines' restore validation. Catalog asset refs are references, not proof that external storage exists, is immutable or retains data across eviction. Original retention, importer hash verification and decoder job admission remain native host work. No RAW provider, develop operation, UI callback or P10 completion should be claimed by a catalog-only checkpoint.
