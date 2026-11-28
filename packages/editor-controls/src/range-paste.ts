import type { CellPosition, SheetRange } from "./sheet-window.ts";

/** Sheet limits shared with SpreadsheetGrid: 1,048,576 rows by 16,384 columns. */
export const MAX_SHEET_ROWS = 1_048_576;
export const MAX_SHEET_COLUMNS = 16_384;

/** One pasted cell at an absolute zero-based position. */
export interface PasteCell {
  readonly row: number;
  readonly column: number;
  readonly value: string;
}

export interface TsvToRangeOptions {
  /** Cells the clamped paste rectangle may cover. @default 1_000_000 */
  readonly maxCells?: number;
  /** @default 1_048_576 */
  readonly rowCount?: number;
  /** @default 16_384 */
  readonly columnCount?: number;
}

export interface TsvPaste {
  readonly cells: readonly PasteCell[];
  /** Rectangle covered after clamping, or `null` when nothing lands on the sheet. */
  readonly range: SheetRange | null;
  /** True when rows or columns were dropped because they fall outside the sheet. */
  readonly clamped: boolean;
}

/** Thrown by {@linkcode tsvToRange} when the paste rectangle exceeds `maxCells`. */
export class PasteTooLargeError extends RangeError {
  readonly cellCount: number;
  readonly maxCells: number;
  constructor(cellCount: number, maxCells: number) {
    super(`Paste has ${cellCount} cells; paste is limited to ${maxCells}`);
    this.name = "PasteTooLargeError";
    this.cellCount = cellCount;
    this.maxCells = maxCells;
  }
}

/**
 * Parses clipboard TSV, the inverse of {@linkcode rangeToTsv}. A field that
 * starts with a double quote runs to the closing quote (`""` is a literal
 * quote) and may hold tabs and line breaks; a quote anywhere else is literal.
 * LF, CRLF and CR end a row, and one trailing line break does not add a row.
 * Rows keep their own length.
 */
export function parseTsv(text: string): string[][] {
  if (typeof text !== "string") throw new TypeError("TSV text must be a string");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '"' && field === "") {
      i++;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          i++;
          break;
        }
        field += text[i++];
      }
      continue;
    }
    const ch = text[i]!;
    if (ch === "\t") {
      row.push(field); field = ""; i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(field); rows.push(row); row = []; field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      if (i >= n) return rows;
    } else {
      field += ch; i++;
    }
  }
  if (n > 0) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Places parsed clipboard text at `anchor`. Cells outside the sheet are
 * dropped and reported through `clamped`; cells missing from ragged rows are
 * omitted rather than blanked. The grid never applies the result: the host
 * owns the write.
 * @throws {PasteTooLargeError} when the clamped rectangle exceeds `maxCells`.
 * @throws {RangeError} for an invalid anchor.
 */
export function tsvToRange(text: string, anchor: CellPosition, options: TsvToRangeOptions = {}): TsvPaste {
  const { maxCells = 1_000_000, rowCount = MAX_SHEET_ROWS, columnCount = MAX_SHEET_COLUMNS } = options;
  if (!anchor || !Number.isSafeInteger(anchor.row) || !Number.isSafeInteger(anchor.column) ||
      anchor.row < 0 || anchor.column < 0) {
    throw new RangeError("Invalid paste anchor");
  }
  const rows = parseTsv(text);
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  if (rows.length === 0) return { cells: [], range: null, clamped: false };
  const rowsFit = Math.max(0, Math.min(rows.length, rowCount - anchor.row));
  const columnsFit = Math.max(0, Math.min(width, columnCount - anchor.column));
  const clamped = rowsFit < rows.length || columnsFit < width;
  if (rowsFit === 0 || columnsFit === 0) return { cells: [], range: null, clamped };
  const cellCount = rowsFit * columnsFit;
  if (cellCount > maxCells) throw new PasteTooLargeError(cellCount, maxCells);
  const cells: PasteCell[] = [];
  for (let r = 0; r < rowsFit; r++) {
    const fields = rows[r]!;
    const last = Math.min(fields.length, columnsFit);
    for (let c = 0; c < last; c++) cells.push({ row: anchor.row + r, column: anchor.column + c, value: fields[c]! });
  }
  return {
    cells,
    range: {
      startRow: anchor.row, endRow: anchor.row + rowsFit - 1,
      startColumn: anchor.column, endColumn: anchor.column + columnsFit - 1,
    },
    clamped,
  };
}
