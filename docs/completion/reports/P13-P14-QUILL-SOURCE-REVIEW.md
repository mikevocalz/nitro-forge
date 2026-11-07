# Tally, Pitch and Quill source review

Independent static review, 2026-11-07. No tests, runtime checks or native builds were run by this reviewer.

## Tally P13: findings corrected

The initial no-op event finding is corrected: `sheet_ops.rs` now returns `Self::readonly` before journaling for same-index moves and same-tone assignments. Unrun regression source explicitly asserts empty event lists for both requests while preserving redo.

The initial retained positional rename-draft finding is corrected in the preview host: released `SheetTabs` is keyed by authoritative document/source revision and edit readiness. Source changes or readiness transitions remount the alpha.4 control, cancelling its retained positional rename state before fresh callbacks are reused. The actual move and tone callbacks are forwarded through the existing host admission gate. This cancellation does not promise preservation of pending drafts or uncontrolled scroll state.
The Rust move itself preserves the active worksheet through its internal stable ID, validates target before journaling, and records the complete prior document. Tone restore validation precedes state replacement. These are source findings, not executed acceptance evidence.

## Pitch P14: no additional source blocker found

`setObjectOrder` validates slide, stable object ID and target index before recording history. Same-index requests return read-only without clearing redo. Moving the existing object preserves identity and its animation references; the existing snapshot representation already stores array order. The typed method matches the operation payload. New regression source covers invalid requests, order/restore and undo/no-op/redo, but was not executed by this reviewer. Released canvas order UI remains deferred.

## Quill direct font family: no additional source blocker found

The partial style parser distinguishes omitted, null and string family values and validates before range mutation. Range edits construct a replacement span before journal/state replacement; cloned style records preserve family through existing undo. Legacy snapshots default to no explicit family, and restore validates families before replacing the document.

DOCX emits escaped double-quoted direct Latin ascii/hAnsi font attributes. Both empty-element and start-element import paths unescape and validate direct family attributes. The single-family representation deliberately leaves theme, separate script families and installed fonts outside its contract. Binding selection state and clear callback use the durable engine field. Layout/shaping, UI adoption and runtime/DOCX round-trip acceptance remain open. Tests added in source were not executed by this reviewer.

None of these slices establishes complete P13/P14 or overall component acceptance.
