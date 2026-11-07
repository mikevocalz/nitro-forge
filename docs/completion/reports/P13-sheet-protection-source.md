# P13 persisted worksheet protection source

Added persisted `is_protected` (legacy default false), `protectSheet` and the canonical SheetTabs `isProtected`/`onProtectedChange` binding. This is an explicit reversible editing guard, not password protection, encryption or authentication.

A centralized command guard rejects protected-target setCell/clearCell/setRange/fillRange, rename/remove/duplicate/move and tab-color commands before mutation. New/reset rejects while any sheet is protected. Reads, activation and adding/editing other sheets remain allowed; unrelated structural edits may shift a protected tab index while preserving its identity. Explicit unprotect, undo/redo and document restore remain allowed. Protection changes are undoable and persist through snapshots; same-value protection requests emit no events or journal entries. Batches call the same guarded apply for each staged command and roll back all staged work if a later command fails.

Added unrun regression source covering every guarded operation, batch rollback, allowed other-sheet edits, unprotect, undo/redo/noop, snapshot roundtrip, legacy default and malformed protection atomicity. Updated mock fixtures and pinned canonical callback type contracts. Only the protection deferral is removed. Broader P13 acceptance remains open; no runtime or acceptance claim is made.

Static validation passed: `cargo check -p tally-engine --tests`, scoped Tally TypeScript typecheck and diff whitespace checks. Tests were compiled but not executed. No native builds or runtime checks.

The preview host forwards the real protection toggle through its shared operation gate and withholds grid cell/fill write callbacks for a protected active sheet. Other attempted writes remain protected by the engine; document reads and unprotect stay available. Root source review and scoped preview TypeScript checks passed; no runtime checks ran.
