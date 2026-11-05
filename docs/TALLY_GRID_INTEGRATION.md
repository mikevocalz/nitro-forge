# Tally spreadsheet rendering: TanStack v9 + NYC-Tron native cells

The Rust `@nitro-forge/tally` package is the authoritative workbook
engine, evaluator, snapshot and undo/redo owner. This integration does not
move any of that state into TanStack or NYC-Tron.

The independent NYC-Tron UI source repository has two related components:

- `@nyc-tron/ui/components/data/DataTable`: TanStack Table v9 headless
  table for sortable record lists, rendered through custom RN components.
- `@nyc-tron/ui/components/forge/SpreadsheetGrid`: an Excel-like viewport
  with TanStack Table's core row/column model, an editable formula bar, and
  bounded 2-D visible cell rendering. It deliberately does **not** sort a
  formula-bearing sheet by pretending it is a list of independent records.

The adapter exported from `@nitro-forge/tally/grid-adapter` is only a
typed bridge: it translates the UI's exclusive range bounds into A1 addresses,
reads the corresponding Rust `getRange` output (plus the frozen rows and
columns the grid pins outside the scrolled body), and writes through
`TallyDocument.setCell`. Both ops act on the workbook's active sheet; call
`TallyDocument.setActive` when the grid switches `sheetId`. It imports no React, `@nyc-tron/*`, native controls
or TanStack, so it cannot create a UI-engine dependency cycle.

```tsx
import { SpreadsheetGrid } from "@nyc-tron/ui/components/forge/SpreadsheetGrid";
import { readTallyWindow, commitTallyGridCell } from "@nitro-forge/tally/grid-adapter";

// Workbook, cell cache and selection are owned above this component in the app
// (Zustand + TallyDocument / Rust Ignition).
<SpreadsheetGrid
  sheetId={sheetId}
  width={viewport.width}
  height={viewport.height}
  rowCount={sheetRowCount}
  columnCount={sheetColumnCount}
  frozenRows={1}
  selection={selection}            // SheetSelection | null, owned by the app
  onSelectionChange={setSelection}
  cells={visibleCells}
  onWindowChange={(range) => {
    // `range` carries frozenRows/frozenColumns; readTallyWindow loads those too.
    // Generation fence: drop responses for windows the user scrolled past.
    const generation = ++windowGeneration.current;
    lastRange.current = range;
    readTallyWindow(document, range)
      .then((cells) => {
        if (generation === windowGeneration.current) setVisibleCells(cells);
      })
      .catch(reportGridError);
  }}
  onCommitCell={async (address, raw) => {
    await commitTallyGridCell(document, address, raw);
    if (lastRange.current)
      setVisibleCells(await readTallyWindow(document, lastRange.current));
  }}
/>
```

Each `getRange` call is capped at 16,384 cells, the Rust engine's own
`getRange` limit. The grid prefetches 64-row by 16-column blocks with one block
of lookahead, so a scrolled window is often 192 x 32 cells; the adapter reads
the body and each frozen strip as separate calls within that cap.

**Important:** the snippet above matches the `SpreadsheetGrid` props in the
NYC-Tron `v0.1.0-alpha.1` release, but no Forge app has built it yet, and
`visibleCells` should be
managed as a bounded per-sheet cache in an app-owned Zustand store with
request cancellation/generation fencing. Do not use per-cell network requests
or materialize every worksheet cell.

Professional acceptance gates remaining: keyboard arrow navigation,
multi-select and clipboard/paste, undo/redo UI and formula-reference highlighting,
frozen panes, variable widths/row heights, native accessibility grid semantics,
high-density GPU/perf testing, a real Tally runtime integration smoke test,
and validated Android/Windows/macOS/web renderers. Raw HTML is prohibited.
Do not confuse the current node/TS integration tests with device validation.

## Responsive phone, tablet and foldable usage

NYC-Tron's spreadsheet view is **not** a normal responsive record DataTable.
On a narrow phone pane it deliberately retains the lettered columns,
numbered rows, A1 addressing and horizontally scrollable editable cells.
Its source uses responsive *container measurements*, not width-based
hardware identity:

- Up to the library's compact threshold (default 540 logical RN units),
  cell hit targets are at least 44 high, columns remain readable at
  least 112 wide, and the formula editor stacks below the selected-cell
  address rather than squeezing between narrow controls.
- Landscape, iPad/tablet split view and desktop-pane resizing return to
  the normal density. Position changes retain the logical row/column
  anchor instead of jumping to a different cell.
- In a native foldable/dual-screen device, place the spreadsheet within
  an already hinge-safe AdaptivePanes region. **Do not** place cells over
  an occluding hinge, and do not replace the device's persistent
  physical-right navigation rail (even in RTL).
- The host can pass the measured `width` and `height` to
  `SpreadsheetGrid`, or let NYC-Tron measure an appropriately bounded
  flex container. Never use the full physical display width to size a
  grid mounted in a narrower detail pane.
- A normal `DataTable` elsewhere in the app becomes label/value record
  cards in small panes; that conversion is incorrect for a formula sheet.

See [NYC-Tron responsive tables](https://github.com/mikevocalz/NYC-Tron-UI/blob/v0.1.0-alpha.1/docs/RESPONSIVE_TABLES.md).
Phone/split-pane source and viewport tests pass on that repository's
GitHub CI. These tests do not replace physical Surface Duo,
TalkBack/VoiceOver, keyboard/IME and 1M-row scroll performance acceptance.

## Spreadsheet cluster (roster I-01, I-02, I-06, I-08, I-13, I-14, I-17, I-20)

The controls live in NYC-Tron UI under
`@nyc-tron/ui/components/forge/spreadsheet/*`
([NYC-Tron-UI #40](https://github.com/mikevocalz/NYC-Tron-UI/pull/40)).
`@nitro-forge/tally/grid-cluster` is the engine side. Like `grid-adapter` it
imports no React and no `@nyc-tron/*`; it returns data and callbacks shaped
like the NYC-Tron props.

| ID | NYC-Tron control | Engine side (`grid-cluster` / `grid-adapter`) | Status |
| --- | --- | --- | --- |
| I-01 | `forge/SpreadsheetGrid` | `readTallyWindow`, `TALLY_SHEET_BOUNDS` | BUILD |
| I-02 | `SpreadsheetGrid` `onFillRange` | `commitTallyFill` → `fillRange`; rectangular paste via `setRange` | Implemented in the engine: reference shifting and one undo entry per edit. Callback shape matches the unreleased UI cluster; release-pin update remains pending. |
| I-06 | `SpreadsheetGrid` outlines, `forge/spreadsheet/FormulaReferenceText` | none needed: references come from the formula text | BUILD |
| I-08 | `forge/spreadsheet/SheetTabs` | `bindTallySheetTabs` → `onSelect`/`onAdd`/`onRename`/`onRemove` over `setActive`/`addSheet`/`renameSheet`/`removeSheet` | BUILD; duplicate, move, protect and tab color **DEFER** on ops `duplicateSheet`, `moveSheet`, `protectSheet`, `setSheetColor` |
| I-13 | `forge/spreadsheet/ChartBuilder` | `readTallyRange` for the data | BUILD for building and previewing; saving **DEFER** on op `insertChart` (leave `onInsert` unset) |
| I-14 | `forge/spreadsheet/SparklineEditor`, `Sparkline` | `readTallyRange` | BUILD for editing and drawing in a cell; saving **DEFER** on op `setSparkline` |
| I-17 | `forge/spreadsheet/FreezeSplitControls`, `SplitSpreadsheetView` | none: app view state feeding `frozenRows`/`frozenColumns` | BUILD; saving with the workbook **DEFER** on op `setSheetView` |
| I-20 | `forge/spreadsheet/SpreadsheetCardsView` | `readTallyRange`, `commitTallyCardField` (`setCell`) | BUILD |

`TALLY_DEFERRED_OPS` lists the deferred op names in code; a unit test checks
none of them is in `OPS`, so the list has to change when an op lands.

```tsx
import { SheetTabs } from "@nyc-tron/ui/components/forge/spreadsheet/SheetTabs";
import { bindTallySheetTabs } from "@nitro-forge/tally/grid-cluster";

// In the app's Zustand store: tabs come from the engine after every write.
const binding = await bindTallySheetTabs(document, next => useSheet.setState({ tabs: next }));
useSheet.setState({ tabs: binding });

<SheetTabs {...useSheet(s => s.tabs)} />;
```

Sheet ids are the engine's sheet indexes. `setActive` changes the sheet that
`getRange`/`setCell` act on, so refetch the grid window after `onSelect`.
Tally records `setActive` in its undo history.

### NYC-Tron release pin

`tooling/nyc-tron.json` pins `@nyc-tron/ui` to the `v0.1.0-alpha.1` release
tarball (same file as
[#47](https://github.com/mikevocalz/nitro-forge/pull/47)), checked by
`tooling/verify-nyc-tron-pin.mjs --download`. `@nitro-forge/tally` takes it as a
devDependency only, for `tests/nyc-tron-consumer.test.ts`, which typechecks the
adapter against the released `SpreadsheetGrid` props.

alpha.1 ships `forge/SpreadsheetGrid` but none of the `forge/spreadsheet/*`
controls; those are in NYC-Tron-UI #40 and not released yet. Until a release
carries them, the contract test covers SpreadsheetGrid only, and the cluster
bindings match the #40 prop shapes by structure. Move the pin to the release
that includes #40 and extend the contract test to the new subpaths.


## Atomic paste and fill

`TallyDocument.setRange(from, values)` commits a rectangular matrix of raw
strings. An empty string clears a cell. `commitTallyFill(document, plan)` maps
NYC-Tron's inclusive `FillPlan` coordinates to `fillRange`. Re-fetch the visible
window after success; rejection leaves committed cells and redo history intact.
Do not implement paste by looping over `setCell`.

The source block repeats; this does not extrapolate numeric/date series. All
source cells are read before any write. Relative references shift; `$` locks,
strings, whitespace, scientific notation and function identifiers are preserved.
A reference shifted past row 1,048,576 or column XFD becomes `#REF!`; a range
with either endpoint off the sheet becomes one `#REF!`, so `=SUM(A1:A3)` filled
up one row reads `=SUM(#REF!)`. Paste and fill targets must fit inside
XFD1048576. `commitTallyFill` does not send the plan's `direction`, because
tiling the source over the target gives the same cells for every direction. Unsupported
lexical syntax rejects the entire fill, rather than rewriting unknown formulas.
Each source/target or pasted matrix is limited to 16,384 cells. Unchanged range
writes return `changed: 0` with no event or undo entry. There is no clipboard OS
bridge in this engine change.

The released NYC-Tron alpha.1 does not yet expose `onFillRange`; consumers need
the spreadsheet cluster from NYC-Tron #40/#43 before supplying the callback.
No native or device validation is implied by the Rust/CLI tests.
