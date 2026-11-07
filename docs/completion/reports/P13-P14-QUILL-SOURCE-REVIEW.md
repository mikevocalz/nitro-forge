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

## Tally duplicate follow-up

The duplicate operation validates its selector and checks the next-ID increment before journaling. It deep-clones the selected sheet, finds an ASCII-case-insensitively unique generated name, assigns a fresh internal ID, inserts beside the source and retains the active worksheet by stable internal ID. The complete Reset history entry preserves the old counter, active selection and sheets for undo; snapshot state includes copied cells and tone. The typed document and binding call the actual operation, with regression source covering collision, independence, restore and undo/redo. No tests executed by this reviewer.

A related pre-existing invariant gap needs correction before relying on monotonic allocation: restore computes `max_id + 1` and addSheet increments next_sheet without checked arithmetic. A restored maximum ID can panic or wrap; fix allocation and restore before journal/state replacement. The duplicate's own checked addition is correct. No workbook-wide sheet or aggregate cloned-cell memory cap exists in the inspected engine, so this review does not claim bounded duplicate memory.

### Allocation follow-up corrected

Subsequent source inspection confirms addSheet checks the counter increment before recording history and restore checks max-ID normalization before state replacement. The reported overflow paths are corrected. Exhausted allocation rejects; this does not introduce a workbook memory cap.

## Pitch partial text style follow-up

No additional source blocker found. setTextStyle resolves stable slide/object IDs and rejects non-text targets. It clones text properties, validates finite positive size, strict booleans and exactly four integer byte color channels, then journals and replaces only after the complete patch succeeds. Null and wrong-type present fields reject; omitted fields and content are retained. Empty/equal patches return read-only, preserving redo. The TypeScript method prevents style payload fields from overriding the supplied slide/object identity. Unrun regression source covers these paths; no runtime or test execution by this reviewer.

## Quill exact font size follow-up

No additional source blocker found. Optional size preserves legacy unspecified state and distinguishes omitted from null clear. The parser and restore reject nonfinite, out-of-range and non-half-point values before replacing state. Exact half-points within 1..1638 points convert without rounding to DOCX integer sz/szCs attributes. Import validates both empty/start element forms, handles order and complex-size fallback, and rejects conflicting Latin/complex sizes under the single-size model. Binding set/clear/mixed state matches the typed engine field. Font-aware layout, shaping, inheritance, app adoption and executed acceptance remain outside this source slice. New regression cases were inspected but not executed.
