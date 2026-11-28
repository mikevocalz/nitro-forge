import type { SheetRange } from "./sheet-window.ts";
import { rangeCellCount } from "./sheet-window.ts";

/** A value {@linkcode rangeToTsv} can serialize. `null`/`undefined` become an empty field. */
export type TsvValue = string | number | boolean | null | undefined;

/** Options for {@linkcode rangeToTsv}. */
export interface RangeTsvOptions {
  /**
   * Largest range serialized in one call. A whole-sheet selection is 17
   * billion cells; the cap keeps a stray Ctrl+A, Ctrl+C from building a
   * string the JS heap cannot hold.
   * @default 1_000_000
   */
  readonly maxCells?: number;
  /** @default "\n" */
  readonly lineEnding?: "\n" | "\r\n";
}

/** Thrown by {@linkcode rangeToTsv} when the range exceeds `maxCells`. */
export class RangeTooLargeError extends RangeError {
  readonly cellCount: number;
  readonly maxCells: number;
  constructor(cellCount: number, maxCells: number) {
    super(`Range has ${cellCount} cells; copy is limited to ${maxCells}`);
    this.name = "RangeTooLargeError";
    this.cellCount = cellCount;
    this.maxCells = maxCells;
  }
}

/**
 * Quotes a field the way spreadsheet clipboards do: a field containing a tab,
 * line break or double quote is wrapped in quotes with inner quotes doubled.
 */
export function tsvField(value: TsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Serializes a rectangular range as tab-separated values for the clipboard.
 * `read` receives absolute zero-based coordinates; the kit never writes the
 * clipboard itself, the app does.
 * @throws {RangeTooLargeError} when the range has more than `maxCells` cells.
 */
export function rangeToTsv(
  range: SheetRange,
  read: (row: number, column: number) => TsvValue,
  options: RangeTsvOptions = {},
): string {
  const { maxCells = 1_000_000, lineEnding = "\n" } = options;
  if (![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) ||
      range.startRow < 0 || range.startColumn < 0 ||
      range.endRow < range.startRow || range.endColumn < range.startColumn) {
    throw new RangeError("Invalid copy range");
  }
  const count = rangeCellCount(range);
  if (count > maxCells) throw new RangeTooLargeError(count, maxCells);
  const lines: string[] = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    const fields: string[] = [];
    for (let column = range.startColumn; column <= range.endColumn; column++) {
      fields.push(tsvField(read(row, column)));
    }
    lines.push(fields.join("\t"));
  }
  return lines.join(lineEnding);
}
