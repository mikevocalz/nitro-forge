# Tally selection, cell-source and view tools

This source phase composes supported worksheet tools beside the existing canonical grid. The new app-local `tally-detail-controls.tsx` owns no engine handle and copies no reusable grid, freeze panel or formatting inspector. Its Selection, Data and View tabs use the existing Studio UI provider. Per-active-sheet view state uses Zustand; changing the document or active sheet resets the local presentation store.

Selection reports the grid's controlled range and cell count. Clear selected cells builds a bounded rectangle of empty source strings and sends one existing `setRange` command. Data accepts plain tab-separated cell source at the selection focus and sends one `setRange`; formulas remain authoritative engine expressions. It accepts at most 262144 source characters and 16384 cells, checks rectangular rows and worksheet bounds, normalizes line endings and ignores one trailing row terminator. CSV quoting, locale number conversion and clipboard permissions are not inferred. Errors preserve the input and authoritative workbook values.

View composes NYC-Tron's FreezeSplitControls with its freeze-only contract. No split command appears without an integrated split view. Frozen prefixes are app view state rather than saved workbook settings. `boundedTallyFreeze` uses the measured grid viewport and the same canonical responsive metrics to reserve one body row/column and bound frozen-prefix requests to the engine's 16384-cell range budget. Invalid new requests leave the old state intact and show an error. Unfreeze remains available when document writes are disabled or a data read failed. The parent uses the same helper when geometry or fetch windows change, keeping a smaller viewport recoverable.

## Host integration

Call `useTallyDetailView(document, sheetId)` unconditionally in TallySurface. Pass its selection/onSelectionChange and frozenRows/frozenColumns to SpreadsheetGrid. Measure that grid's onLayout into a view-only `{width,height}` state. Render TallyDetailControls with document, current sheetId, authoritative cells, selection, getSelection, freeze, measured viewport, the current SpreadsheetWindowRequest, onFreezeChange, disabled, shared commit, density and theme. The parent must invalidate/reload the bounded window when the effective freeze changes and clamp retained freeze after resizing or window-budget changes.

All data writes capture the current document, sheet, cell-window source and selection. The synchronous selection-store getter also rejects a selection changed before React has rendered. They refuse stale callbacks before entering the existing surface commit gate. That gate checks the active sheet inside the shared document lock, serializes with header operations and reloads the actual window. The app does not report local text as a successful engine value.

The pinned alpha.4 grid reloads formula drafts when focus or sheet changes but does not own full mutation-generation cancellation for fill gestures. A host mutation/sheet boundary can cancel those old local gestures; keying on every cell-window fetch would reset scrolling and cause prefetch bounce, so it must not use cells/viewport as the remount identity. The source checkpoint must retain that distinction and record any released-host scroll-anchor limitation.

## Engine gaps and validation

Tally's authoritative OPS contain sheet creation/rename/removal/selection, cell/range set/fill/clear, reads and formula evaluation. They contain no persisted font/number/cell formatting, sort/filter, row/column structure, merge, validation rules, chart or sparkline objects. This phase does not draw dead formatting controls or fabricate document styles. The existing TALLY_DEFERRED_OPS remain unresolved; additional formatting operations must be designed and implemented in Rust and the typed API before their controls can commit.

The new file passed preview TypeScript and static whitespace checks before parent integration. Final combined checks belong to the parent phase report. Runtime/browser/native/full-suite checks remain deferred to the user's review gate; no previous grid evidence certifies these additions. Package pins, manifests, native window contracts and unrelated native/media work are unchanged.

## Integrated source checkpoint

The parent now owns controlled selection/freeze state above the released grid, measures the grid's actual viewport, and derives bounded effective frozen prefixes on every render. A memoized readRange supplies those same prefixes to readTallyWindow and the read/write admission generation. Resize/density/window changes can reduce an invalid freeze; the unfreeze path remains mounted and reachable while writes are readonly.

The legacy grid resets on document/authoritative-state revision and sheet changes, not cell-window prefetches, selection or geometry. This cancels old released fill intents without creating prefetch/remount loops. Authority reloads, including Save or Refresh, can reset widget-local focus and scrolling; preserving those anchors requires the accepted source contract. Selection stays above the boundary.

Retries clear the local error before admission while preserving entered TSV. Final preview typecheck, static production build, workspace typecheck and independent source review passed. Build warnings remain; runtime, native and full-suite execution remain deferred for review. Formatting, sorting/filtering and structural operations are still engine gaps, not enabled callbacks in this preview.
