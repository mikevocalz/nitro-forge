# P14 persistent object order source checkpoint

Pitch now supports `setObjectOrder {slide,id,to}` in its Rust engine and typed document API. The index is the final absolute bottom-to-top position; slide/object/index validation happens before mutation. A real change journals the original deck once, moves the existing object without changing IDs or animation references, and persists in the existing snapshot representation. Same-index requests emit no mutation and preserve redo.

Regression source covers invalid-target atomicity, actual order, snapshot restore, undo/redo and no-op history preservation. These tests were written but not run under the user's review gate. Rust and TypeScript static checks are recorded separately below. The released SlideCanvas has no order callback; no unsupported prop or dead button was added. UI adoption and full P14 rendering/presentation acceptance remain open.

`cargo check -p pitch-engine`, scoped Pitch TypeScript checking and whitespace checking passed. These compilation checks do not execute the new regression cases or establish rendering/runtime acceptance.
