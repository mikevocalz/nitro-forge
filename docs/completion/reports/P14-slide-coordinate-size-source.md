# P14 persisted slide coordinate size

Added durable deck `size:{width,height}` and typed `setSlideSize`. Dimensions must be finite, positive and at most 100000; an identical request has no event or undo entry. Changes use the existing atomic whole-deck journal. Legacy snapshots default to 960×540. Invalid size snapshots fail before replacing live state or history.

The canonical SlideCanvas binding now reads persisted deck geometry instead of always assuming 960×540. There is no invented size-edit callback: the typed document operation is the host entry point. Changing slide coordinates does not rescale objects, change app window dimensions or change orientation. Only the corresponding size deferral is removed; wider P14 functionality and acceptance remain open.

Added regression source for unchanged object geometry, undo/redo and no-op history, legacy/current snapshot restoration, invalid payload/restore atomicity and canonical adapter geometry. Focused validation now passes both new Rust size/legacy tests and all nine tests in the affected office-cluster adapter file.

Static checks passed: `cargo check -p pitch-engine --tests`, scoped Pitch TypeScript typecheck and diff whitespace checks. The affected Pitch engine suite also passes 23 tests. These are engine/unit checks, not native presentation acceptance.
