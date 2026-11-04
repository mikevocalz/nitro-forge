import type { TallyDocument, CellInfo } from "./index";

/**
 * Nonvisual adapter for NYC-Tron's SpreadsheetGrid component.
 * This file does not import React, TanStack, NYC-Tron or Native UI.
 * It translates a bounded 0-based viewport into actual Rust engine requests.
 *
 * Reads and writes target the workbook's *active* sheet, because the Tally
 * `getRange`/`setCell` ops have no sheet parameter. Call
 * `TallyDocument.setActive` before reading a different sheet.
 *
 * Apps own their Zustand window/selection state and fetch lifecycle.
 */
export interface TallyWindowRange {
  /** Inclusive start and exclusive end (as returned by the UI viewport). */
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}
export type TallyGridData = Readonly<Record<string, CellInfo>>;
export type TallyGridDocument = Pick<TallyDocument, "getRange" | "setCell">;

/** Grid bounds the adapter exposes (Excel-compatible: XFD1048576). */
export const TALLY_GRID_MAX_ROWS = 1_048_576;
export const TALLY_GRID_MAX_COLUMNS = 16_384;
/** Default cell budget for one viewport fetch. */
export const TALLY_GRID_MAX_WINDOW_CELLS = 4096;

export function tallyColumnName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= TALLY_GRID_MAX_COLUMNS)
    throw new RangeError("Tally column index must be 0..16383");
  let n = index + 1;
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export function tallyCellAddress(row: number, column: number): string {
  if (!Number.isSafeInteger(row) || row < 0 || row >= TALLY_GRID_MAX_ROWS)
    throw new RangeError("Tally row index out of bounds");
  return tallyColumnName(column) + String(row + 1);
}

/**
 * Parse an upper-case A1 address into 0-based `{ row, column }`, rejecting
 * anything outside the grid bounds above (e.g. `XFE1` or `A1048577`).
 */
export function parseTallyCellAddress(
  address: string,
): { readonly row: number; readonly column: number } {
  const m = typeof address === "string" ? /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(address) : null;
  if (!m) throw new RangeError("Invalid A1 cell address");
  let column = 0;
  for (const ch of m[1]!) column = column * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  if (column > TALLY_GRID_MAX_COLUMNS || row > TALLY_GRID_MAX_ROWS)
    throw new RangeError("A1 cell address is outside the Tally grid");
  return { row: row - 1, column: column - 1 };
}

export function windowToA1Range(
  range: TallyWindowRange,
  maxCells = TALLY_GRID_MAX_WINDOW_CELLS,
): { readonly from: string; readonly to: string } | null {
  const { startRow, endRow, startColumn, endColumn } = range;
  if (
    ![startRow, endRow, startColumn, endColumn].every(Number.isSafeInteger) ||
    startRow < 0 ||
    startColumn < 0 ||
    endRow < startRow ||
    endColumn < startColumn ||
    endRow > TALLY_GRID_MAX_ROWS ||
    endColumn > TALLY_GRID_MAX_COLUMNS ||
    !Number.isSafeInteger(maxCells) ||
    maxCells < 1
  ) {
    throw new RangeError("Invalid Tally grid viewport range");
  }
  if (startRow === endRow || startColumn === endColumn) return null;
  if ((endRow - startRow) * (endColumn - startColumn) > maxCells)
    throw new RangeError("Tally grid fetch exceeds viewport cell budget");
  return {
    from: tallyCellAddress(startRow, startColumn),
    to: tallyCellAddress(endRow - 1, endColumn - 1),
  };
}

/**
 * Query only the visible range. Blank engine cells remain blank. Rejects if
 * the engine returns a cell outside the requested window or more cells than
 * the window holds.
 */
export async function readTallyWindow(
  document: TallyGridDocument,
  range: TallyWindowRange,
): Promise<TallyGridData> {
  const a1 = windowToA1Range(range);
  if (!a1) return {};
  const expected = (range.endRow - range.startRow) * (range.endColumn - range.startColumn);
  const response = await document.getRange(a1.from, a1.to);
  const cells = response.data?.cells;
  if (!Array.isArray(cells)) throw new Error("Tally returned an invalid range");
  const result: Record<string, CellInfo> = Object.create(null) as Record<string, CellInfo>;
  let count = 0;
  for (const row of cells) {
    if (!Array.isArray(row)) throw new Error("Tally returned a malformed row");
    for (const cell of row) {
      if (!cell || typeof cell.addr !== "string" || typeof cell.raw !== "string")
        throw new Error("Malformed Tally cell");
      if (++count > expected) throw new RangeError("Tally returned too many cells");
      const addr = cell.addr.toUpperCase();
      const at = parseTallyCellAddress(addr);
      if (
        at.row < range.startRow ||
        at.row >= range.endRow ||
        at.column < range.startColumn ||
        at.column >= range.endColumn
      ) {
        throw new RangeError(`Tally returned ${addr} outside the requested window`);
      }
      result[addr] = cell;
    }
  }
  return result;
}

/**
 * The only write path: TallyDocument.setCell -> Rust EngineHost.
 * This returns the engine's response; never echo a local optimistic value as
 * a confirmed commit. The app refreshes the visible window after completion.
 */
export async function commitTallyGridCell(
  document: TallyGridDocument,
  address: string,
  raw: string,
): ReturnType<TallyGridDocument["setCell"]> {
  parseTallyCellAddress(address);
  if (typeof raw !== "string") throw new TypeError("Cell source must be text");
  return document.setCell(address, raw);
}
