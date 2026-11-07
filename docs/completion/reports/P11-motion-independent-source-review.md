# P11 registered motion independent source review

2026-11-07. Source inspection of the bounded Motion Rust/curve model, typed wrapper, registration and focused test source. No native builds/device actions or tests run by this reviewer. Real pixel math is also reviewed separately by the parent.

## Correction confirmed

The sole reported blocker is corrected in current source. setPropertyKeys now requires as_object_mut before inspecting/inserting an allocated ID, so primitive/null/array items return EngineError before allocation. Regression source wraps calls in catch_unwind and checks null, booleans, integers/fractions, strings, arrays and invalid objects, both alone and after a valid locally staged key. It asserts unchanged exact snapshots/counters and usable redo after each rejected input. The owner reports eight Motion tests passed; this reviewer confirmed source and test coverage without rerunning that command.
## Other inspected invariants

The scalar evaluator validates the complete curve before sampling, including unsampled tails and adjacent handle bounds. It resolves exact endpoints, implements left-key hold/linear interpolation and inverts bounded cubic time by bisection for Bezier values. Scale keys and handles retain their nonzero base sign; zero/cross-sign scale support is deliberately excluded. Layer/key IDs are positive, unique and below safe-integer counters; existing IDs in replacement keys must belong to that property curve.

Layer removal/key edits reject locked layers; updating a locked layer admits only a separate lock-field operation. Reorder remains an exact identity-preserving permutation under the documented operation. Candidate copies and full validation precede history/state mutation; equal writes and net-equal batches preserve redo/events. Restore validates explicit kind/schema, references, IDs, geometry, curves and logical budgets before replacing state/history. Sixteen Arc/COW history entries share unchanged records, with a 16 MiB serialized-state cap, layer/curve/key limits and one-megapixel output cap. These are logical budgets, not measured RSS evidence.

Frame rendering builds an ephemeral real Prism scene and returns actual RGBA through the existing JSON/base64 or binary result contract. Render checkpoints occur between layers and before/after synchronous Prism flatten; no interruption inside flatten is claimed. Evaluated time must be finite within duration. No native/UI rollout, encoder, nested composition, media/effect/spring backend or complete P11 acceptance follows from this slice.

Registration preserves previous checkpoint/native enum tags 0..7, including Photo7, and appends Motion8. Rust/CLI/FFI/C++ factory and typed unions include motion. The lock includes the matching workspace importer. Snapshot opening uses the shared owning helper. Older native binaries require rebuilding for the new kind. Owner-reported Rust/FFI/CLI tests remain separate execution evidence; this reviewer inspected their source without rerunning them.
