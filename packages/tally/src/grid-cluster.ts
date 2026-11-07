import type { CellInfo, SheetTabTone, TallyDocument } from "./index";
import {
  TALLY_GRID_MAX_COLUMNS,
  TALLY_GRID_MAX_ROWS,
  TALLY_GRID_MAX_WINDOW_CELLS,
  commitTallyGridCell,
  parseTallyCellAddress,
  readTallyWindow,
  tallyCellAddress,
  type TallyGridData,
} from "./grid-adapter";

/**
 * Engine side of NYC-Tron's spreadsheet cluster (Forge roster I-01, I-02,
 * I-06, I-08, I-13, I-14, I-17, I-20). Like `grid-adapter`, this file imports
 * no React and no `@nyc-tron/*` package: it returns plain data and callbacks
 * whose shapes match the NYC-Tron props, and the app passes them through.
 *
 * Callbacks exist only for operations the Rust Tally engine has. NYC-Tron
 * draws a control only when its callback is supplied, so the operations in
 * {@link TALLY_DEFERRED_OPS} never appear as dead buttons.
 */

/** A worksheet as NYC-Tron `SheetTabs` takes it. `id` is the engine's sheet index. */
export interface TallySheetTab {
  readonly id: string;
  readonly name: string;
  readonly tone?: SheetTabTone;
  readonly isProtected?: boolean;
}

/** `SheetTabs` props this adapter can back with real engine operations. */
export interface TallySheetTabsBinding {
  readonly tabs: readonly TallySheetTab[];
  readonly activeId: string;
  readonly onSelect: (id: string) => Promise<void>;
  readonly onAdd: () => Promise<void>;
  readonly onRename: (id: string, name: string) => Promise<void>;
  readonly onProtectedChange: (id: string, isProtected: boolean) => Promise<void>;
  readonly onDuplicate: (id: string) => Promise<void>;
  readonly onMove: (id: string, toIndex: number) => Promise<void>;
  readonly onToneChange: (id: string, tone: SheetTabTone | undefined) => Promise<void>;
  readonly onRemove: (id: string) => Promise<void>;
}

export type TallySheetDocument = Pick<TallyDocument, "workbook" | "setActive" | "addSheet" | "renameSheet" | "removeSheet" | "moveSheet" | "setSheetColor" | "duplicateSheet" | "protectSheet">;

/**
 * Engine operations the cluster's UI can express but Tally does not have yet.
 * Each is a DEFER: the matching NYC-Tron callback is left out, so its control
 * is not drawn. Adding the op to `packages/tally/rust` and `OPS` is what
 * lifts the deferral. Chart (`insertChart`/`updateChart`/`removeChart`/
 * `listCharts`) and sparkline (`setSparkline`/`clearSparkline`/
 * `listSparklines`) persistence landed in slice 7 as storage-only specs —
 * hosts wire `ChartBuilder.onInsert`/`SparklineEditor` callbacks to the
 * `TallyDocument` methods directly; rendering stays host-side.
 *
 * `setSheetView` landed in slice 8 (`saveSheetView`/`setSheetView`/
 * `removeSheetView`/`listSheetViews`): workbook-persisted named views that
 * capture the sheet's filter specs — the only durable view state the
 * engine owns. Frozen panes, splits, scroll, zoom and column widths remain
 * host view state (the engine does not own them), so the I-17 freeze/split
 * half of the deferral is honestly still open even though the op name is
 * now backed.
 *
 * Cell/range comments landed in slice 9 (`addComment`/`updateComment`/
 * `removeComment`/`resolveComment`/`reopenComment`/`listComments`):
 * workbook-persisted single-entry comments anchored to cell/range
 * coordinates — hosts wire comment-pin UI to the `TallyDocument` methods
 * directly; threading/replies stay deferred. Slice 13 added the
 * row/column structural ops those anchors now remap with
 * (`insertRows`/`deleteRows`/`insertCols`/`deleteCols` on
 * `TallyDocument`, plus `mergeCells`/`unmergeCells`/`listMergedCells`
 * for merged regions); hosts wire row/column UI to the methods directly.
 *
 * Delimited text transfer landed in slice 10 (`importCsv`/`importTsv`/
 * `exportCsv`/`exportTsv`): the engine parses/serializes RFC 4180 text
 * in-op — `TallyDocument.importCsv`/`exportCsv` (and the TSV pair) take
 * and return strings; the file-export sheet's CSV/TSV import formats in
 * `transfer.ts` ride the same ops. XLSX stays deferred on dependency
 * admission (backlog: "XLSX blocked on dependency admission").
 *
 * Pivot tables landed in slice 11-A as storage-only specs
 * (`insertPivot`/`updatePivot`/`removePivot`/`listPivots`/`describePivot`
 * on `TallyDocument`): the engine stores the bounded spec — output sheet,
 * source sheet+range, field-offset rows/columns/values/filters/sort —
 * and writes no cells. Compute, refresh, materialization and any pivot
 * UI are deferred; hosts wire the methods directly when a later slice
 * lands them.
 *
 * Table objects (Excel Tables) landed in slice 12 as storage + CRUD +
 * read ops (`insertTable`/`updateTable`/`removeTable`/`listTables`/
 * `describeTable` on `TallyDocument`): a workbook-unique display name, a
 * canonical sheet range including the header row, and storage-only
 * header/totals/banding flags. Table ranges may not overlap each other
 * or merged regions on their sheet, and they remap with the structural
 * row/column ops. Structured references, totals computation and any
 * table UI are deferred; hosts wire the methods directly.
 */
export const TALLY_DEFERRED_OPS = {} as const;
export type TallyDeferredOp = keyof typeof TALLY_DEFERRED_OPS;

function requireData<T>(response: { data?: T }, op: string): T {
  if (response.data === undefined || response.data === null) throw new Error(`Tally ${op} returned no data`);
  return response.data;
}

/** Tabs and the active sheet from `workbook`. */
export async function readTallySheetTabs(document: Pick<TallyDocument, "workbook">): Promise<{
  readonly tabs: readonly TallySheetTab[];
  readonly activeId: string;
}> {
  const info = requireData(await document.workbook(), "workbook");
  if (!Array.isArray(info.sheets) || !Number.isSafeInteger(info.active)) throw new Error("Tally returned an invalid workbook");
  const tabs = info.sheets.map((sheet, index) => {
    if (!sheet || typeof sheet.name !== "string") throw new Error("Tally returned a malformed sheet");
    return { id: String(index), name: sheet.name, ...(sheet.tone ? { tone: sheet.tone } : {}), ...(sheet.is_protected ? { isProtected: true } : {}) };
  });
  if (info.active < 0 || info.active >= tabs.length) throw new Error("Tally active sheet is out of range");
  return { tabs, activeId: String(info.active) };
}

function sheetIndex(id: string): number {
  const index = Number(id);
  if (!/^(0|[1-9][0-9]*)$/.test(id) || !Number.isSafeInteger(index)) throw new RangeError(`Unknown sheet id "${id}"`);
  return index;
}

/**
 * Reads the workbook and returns `SheetTabs` props wired to `setActive`,
 * `addSheet`, `renameSheet`, `removeSheet`, `moveSheet` and `setSheetColor`. Every callback writes through
 * the engine, then calls `onChanged` with a fresh binding; an engine error
 * rejects with the engine's message, which `SheetTabs` shows. Nothing is
 * applied optimistically.
 */
export async function bindTallySheetTabs(
  document: TallySheetDocument,
  onChanged: (next: TallySheetTabsBinding) => void,
): Promise<TallySheetTabsBinding> {
  const { tabs, activeId } = await readTallySheetTabs(document);
  const after = async (write: () => Promise<unknown>) => {
    await write();
    onChanged(await bindTallySheetTabs(document, onChanged));
  };
  return {
    tabs,
    activeId,
    onSelect: id => after(() => document.setActive(sheetIndex(id))),
    // Tally names new sheets itself; passing no name keeps its default.
    onAdd: () => after(() => document.addSheet()),
    onRename: (id, name) => after(() => document.renameSheet(sheetIndex(id), name)),
    onProtectedChange: (id, isProtected) => after(() => document.protectSheet(sheetIndex(id), isProtected)),
    onDuplicate: id => after(() => document.duplicateSheet(sheetIndex(id))),
    onMove: (id, toIndex) => after(() => document.moveSheet(sheetIndex(id), toIndex)),
    onToneChange: (id, tone) => after(() => document.setSheetColor(sheetIndex(id), tone ?? null)),
    onRemove: id => after(() => document.removeSheet(sheetIndex(id))),
  };
}

/** A1 range text (`B2:M2`, `$A$1:C9`, `E4`) as a 0-based end-exclusive window. */
export function tallyRangeWindow(range: string): {
  readonly startRow: number; readonly endRow: number; readonly startColumn: number; readonly endColumn: number;
} {
  const parts = range.trim().replaceAll("$", "").toUpperCase().split(":");
  if (parts.length > 2 || parts[0] === "") throw new RangeError(`"${range}" is not a cell range`);
  const a = parseTallyCellAddress(parts[0]!);
  const b = parts.length === 2 ? parseTallyCellAddress(parts[1]!) : a;
  return {
    startRow: Math.min(a.row, b.row), endRow: Math.max(a.row, b.row) + 1,
    startColumn: Math.min(a.column, b.column), endColumn: Math.max(a.column, b.column) + 1,
  };
}

/**
 * Cells of an A1 range on the active sheet, for `ChartBuilder` (I-13),
 * `SparklineEditor` (I-14) and `SpreadsheetCardsView` (I-20). Same bounds and
 * cell budget as {@link readTallyWindow}.
 */
export function readTallyRange(
  document: Pick<TallyDocument, "getRange" | "setCell">, range: string,
): Promise<TallyGridData> {
  return readTallyWindow(document, tallyRangeWindow(range));
}

/**
 * `SpreadsheetCardsView.onCommitField` (I-20): one card field is one cell, so
 * it writes through `setCell` like the grid's formula bar.
 */
export function commitTallyCardField(
  document: Pick<TallyDocument, "getRange" | "setCell">, address: string, raw: string,
): Promise<unknown> {
  return commitTallyGridCell(document, address, raw);
}

/**
 * Reference colors (I-06), freeze and split (I-17) and the bounded viewport
 * (I-01) need no engine call beyond `getRange`/`setCell`: references come from
 * the formula text the grid already shows, and freeze/split are view state.
 * These bounds are what the app passes as `rowCount`/`columnCount`.
 */
export const TALLY_SHEET_BOUNDS = {
  rowCount: TALLY_GRID_MAX_ROWS,
  columnCount: TALLY_GRID_MAX_COLUMNS,
  maxWindowCells: TALLY_GRID_MAX_WINDOW_CELLS,
} as const;

export type { CellInfo };

/** Inclusive cell coordinates, matching NYC-Tron's FillPlan (not its viewport). */
export interface TallyFillRange {
  readonly startRow: number; readonly endRow: number;
  readonly startColumn: number; readonly endColumn: number;
}
export interface TallyFillPlan {
  readonly source: TallyFillRange;
  readonly target: TallyFillRange;
  readonly direction: "up" | "down" | "left" | "right";
}
/**
 * Pass as SpreadsheetGrid.onFillRange. Exactly one engine call per gesture.
 * `direction` is not sent: the engine tiles the source block across the whole
 * target, which gives the same cells for every direction NYC-Tron produces.
 */
export function commitTallyFill(document: Pick<TallyDocument, "fillRange">, plan: TallyFillPlan) {
  const rect = (range: TallyFillRange) => {
    if (range.endRow < range.startRow || range.endColumn < range.startColumn)
      throw new RangeError("Fill range must be ordered");
    return { from: tallyCellAddress(range.startRow, range.startColumn), to: tallyCellAddress(range.endRow, range.endColumn) };
  };
  return document.fillRange(rect(plan.source), rect(plan.target));
}
