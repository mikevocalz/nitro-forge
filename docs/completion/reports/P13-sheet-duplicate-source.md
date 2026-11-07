# P13 worksheet duplication source

`duplicateSheet` now deep-copies a real Tally sheet, including raw cells/formulas and semantic tab tone, immediately after its source. The copy receives a fresh id and the first available case-insensitive `source Copy N` name. The original active sheet remains active by identity, including when insertion shifts its index. Validation and checked id allocation happen before mutation; one structural journal entry restores the entire operation through undo/redo. The existing snapshot schema and legacy tone defaults remain unchanged.

The typed document API and canonical SheetTabs binding expose `duplicateSheet`/`onDuplicate`; only the matching duplication deferral is removed. Updated mock and pinned consumer contracts and added regression test source for copied content/tone, name collisions, independent edits, active identity, undo/redo, roundtrip persistence, unique ids and invalid-source atomicity. These tests are not executed under the review gate. Protection and remaining P13 features stay open; no component or phase acceptance is promoted.

Static checks passed: `cargo check -p tally-engine --tests`, `pnpm --filter @nitro-forge/tally typecheck` and scoped diff whitespace checks. No test execution, native builds or runtime checks.

Independent review also identified pre-existing unchecked sheet id increments in addSheet and restore. Both now use checked allocation before recording a journal entry or replacing the live document. Added regression source checks rejected allocation/restore preserve snapshots and redo history. Duplication and structural journal entries clone workbook data; this slice makes no bounded-memory claim.
