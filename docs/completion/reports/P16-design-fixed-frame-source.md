# P16 Design fixed-frame backend checkpoint

Added authoritative Design9 Rust/typed APIs with fixed frame/rect/ellipse trees, ordered parenting, inherited visibility and edit locks, row/column padding/gap/alignment/distribution and actual ephemeral Prism RGBA rendering. World boxes and output are derived from persistent tree/layout state. New/root resize does not change any app window configuration. No default host activation or inspector was added.

Candidate validation precedes history/state replacement; malformed/foreign/oversized restores preserve existing state/history. Equal writes and net-equal batches remain eventless. Root dimensions are integer1..4096 with one-megapixel output, <=1024 nodes, depth64, local geometry1e6, names/title512 bytes, safe IDs, 8MiB snapshots and sixteen Arc/COW history entries. These are logical budgets, not measured RSS. Rendering checkpoints between nodes and around synchronous flatten; no immediate compositor cancellation claim.

Review found accumulated valid local coordinates could exceed Prism's global shape bound. The evaluator now validates every computed box, including hidden boxes, against actual finite ±1e7/positive extents before commit or restore; deep offset, hidden overflow and redo regressions pass. Effective nested padding after stretch also rejects atomically. Lock policy is explicit and tested: locks block authored edits through ancestry, but unlocked ancestor layout/order can change a locked descendant's evaluated geometry. Frames have visible overflow; no clipping is fabricated. Unsupported hug/fill/wrap/constraints/text/components/prototypes remain rejected or absent.

Registration covers Rust EngineKind/CLI/FFI/C++ factory, TS unions and fixed NFC1/NCC1 tags. Installed pinned nightly120 Nitrogen was run directly and generated DESIGN9; ordinals0..8 are unchanged. Only the new workspace package/importer and existing dependencies are needed. Baseline media/native manifests and lock changes remain unrelated WIP and must not be staged with this slice. No native binary ABI, distribution or P16 acceptance is claimed.

Executed checks:

- `cargo test -p design-engine`: eight tests passed (hierarchy/layout/math/pixels/visibility/locks/no-op/batches/history/restore/depth/global bounds/padding/cancellation).
- `cargo test -p nf-sys design_registered_factory_returns_real_binary_rgba`: one focused test passed (registered factory, exact binary RGBA and binary-input rejection). The parent reran this successfully after the final evaluator bounds hardening.
- `cargo build -p nf-cli`: passed again after evaluator bounds hardening; final registration cases use that rebuilt binary.
- Direct installed Vitest for design-registration, motion-registration and photo-registration: three files/six tests passed, covering prior tags/native ordinals, Design flow/pixels, shared snapshot reopen and foreign restore rejection.
- Direct installed TypeScript compiler for packages/design passed. Pinned Nitrogen generated four/four HybridObjects.

Independent source reviewer platform_media_next reports no remaining blocker after evaluated-geometry closure; the parent independently reran the final FFI/build and six registration checks successfully. No broad P19 suite, native/device build, dependency version upgrade or release performed. This source checkpoint retains the original P16 acceptance gates.
