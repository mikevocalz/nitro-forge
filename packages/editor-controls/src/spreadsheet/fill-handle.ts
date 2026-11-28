import type { SheetRange } from "../sheet-window.ts";

/** Direction a fill extends its source range. */
export type FillDirection = "down" | "up" | "right" | "left";

/**
 * Result of dragging the fill handle: the source block repeats into `target`,
 * which always contains `source`. `undefined` from {@linkcode fillTarget}
 * means the pointer has not left the source block.
 */
export interface FillPlan {
  readonly source: SheetRange;
  readonly target: SheetRange;
  readonly direction: FillDirection;
}

/** Sheet size {@linkcode fillTarget} clamps to. */
export interface FillBounds {
  readonly rowCount: number;
  readonly columnCount: number;
}

function requireRange(range: SheetRange, bounds: FillBounds): void {
  const ok = [range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) &&
    range.startRow >= 0 && range.startColumn >= 0 &&
    range.endRow >= range.startRow && range.endColumn >= range.startColumn &&
    range.endRow < bounds.rowCount && range.endColumn < bounds.columnCount;
  if (!ok) throw new RangeError("Fill source range is outside the sheet");
}

/**
 * Fill plan for a fill-handle drag that has moved `rows`/`columns` whole cells
 * from the source block's bottom-trailing corner. Like spreadsheet fill
 * handles, the fill follows one axis: whichever the pointer travelled further
 * along, measured in cells. Ties go to the row axis.
 */
export function fillTarget(
  source: SheetRange,
  delta: { readonly rows: number; readonly columns: number },
  bounds: FillBounds,
): FillPlan | undefined {
  requireRange(source, bounds);
  if (!Number.isFinite(delta.rows) || !Number.isFinite(delta.columns)) {
    throw new RangeError("Fill delta must be finite");
  }
  const rows = Math.trunc(delta.rows);
  const columns = Math.trunc(delta.columns);
  if (rows === 0 && columns === 0) return undefined;
  if (Math.abs(rows) >= Math.abs(columns)) {
    if (rows > 0) {
      const endRow = Math.min(bounds.rowCount - 1, source.endRow + rows);
      return endRow === source.endRow ? undefined : { source, direction: "down", target: { ...source, endRow } };
    }
    // The pointer row is endRow+rows. Inside the block it fills nothing; above
    // the block's top edge it fills upward to the pointer row.
    const startRow = Math.max(0, source.endRow + rows);
    if (startRow >= source.startRow) return undefined;
    return { source, direction: "up", target: { ...source, startRow } };
  }
  if (columns > 0) {
    const endColumn = Math.min(bounds.columnCount - 1, source.endColumn + columns);
    return endColumn === source.endColumn ? undefined : { source, direction: "right", target: { ...source, endColumn } };
  }
  const startColumn = Math.max(0, source.endColumn + columns);
  if (startColumn >= source.startColumn) return undefined;
  return { source, direction: "left", target: { ...source, startColumn } };
}

/**
 * Ctrl/Cmd+D and Ctrl/Cmd+R: fill a selection from its first row (down) or
 * first column (right). A one-row (or one-column) selection has nothing to
 * fill into, so it returns `undefined`.
 */
export function fillFromEdge(range: SheetRange, direction: "down" | "right"): FillPlan | undefined {
  if (direction === "down") {
    if (range.endRow === range.startRow) return undefined;
    return { direction, target: range, source: { ...range, endRow: range.startRow } };
  }
  if (range.endColumn === range.startColumn) return undefined;
  return { direction, target: range, source: { ...range, endColumn: range.startColumn } };
}
