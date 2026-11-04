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
reads the corresponding Rust `getRange` output, and writes through
`TallyDocument.setCell`. It imports no React, `@nyc-tron/*`, native controls
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
  selectedCell={selectedAddress}
  onSelectionChange={setSelectedAddress}
  cells={visibleCells}
  onWindowChange={(range) => {
    void readTallyWindow(document, range).then(setVisibleCells);
  }}
  onCommitCell={async (address, raw) => {
    await commitTallyGridCell(document, address, raw);
    await refreshVisibleRange();
  }}
/>
```

**Important:** the snippet above describes integration; it has not been
built against a published NYC-Tron package, and `visibleCells` should be
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

See [NYC-Tron responsive tables](https://github.com/mikevocalz/NYC-Tron-UI/blob/feat/themeable-cross-platform-foundation/docs/RESPONSIVE_TABLES.md).
Phone/split-pane source and viewport tests pass on that repository's
GitHub CI. These tests do not replace physical Surface Duo,
TalkBack/VoiceOver, keyboard/IME and 1M-row scroll performance acceptance.
