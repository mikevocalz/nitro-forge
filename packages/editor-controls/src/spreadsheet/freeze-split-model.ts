import { parseCellAddress } from "../sheet-window.ts";

/** Frozen leading rows and columns, as `SpreadsheetGrid` takes them. */
export interface FreezeState {
  readonly frozenRows: number;
  readonly frozenColumns: number;
}

/** One freeze command from {@linkcode FreezeSplitControls}. */
export type FreezeCommand = "top-row" | "first-column" | "at-selection" | "none";

/**
 * Freeze state for a command. `at-selection` freezes the rows above and the
 * columns before the focus cell, as spreadsheets do; at A1 that freezes
 * nothing, so the caller should offer it only away from A1.
 */
export function freezeFor(command: FreezeCommand, focus: string | undefined): FreezeState {
  switch (command) {
    case "top-row": return { frozenRows: 1, frozenColumns: 0 };
    case "first-column": return { frozenRows: 0, frozenColumns: 1 };
    case "none": return { frozenRows: 0, frozenColumns: 0 };
    case "at-selection": {
      const cell = focus ? parseCellAddress(focus) : undefined;
      if (!cell) throw new RangeError("Select a cell to freeze panes at.");
      return { frozenRows: cell.row, frozenColumns: cell.column };
    }
  }
}

/** Which way a split divides the sheet view. */
export type SplitAxis = "horizontal" | "vertical";

/**
 * A split view: two panes of the same sheet that scroll independently.
 * `ratio` is the first pane's share of the space, `0..1`.
 */
export interface SplitState {
  readonly axis: SplitAxis;
  readonly ratio: number;
}

/** Pixel layout of a split. */
export interface SplitGeometry {
  readonly first: number;
  readonly divider: number;
  readonly second: number;
  /** The ratio after clamping to the minimum pane size. */
  readonly ratio: number;
}

/**
 * Pane sizes for a split of `total` points. Each pane keeps at least
 * `minPane`, which by default fits the grid's formula bar, a header and one
 * 44pt row. When the space cannot hold two minimum panes they share it evenly.
 */
export function splitGeometry(total: number, ratio: number, divider = 12, minPane = 136): SplitGeometry {
  if (![total, ratio, divider, minPane].every(Number.isFinite) || total < 0 || divider < 0 || minPane < 0) {
    throw new RangeError("Invalid split geometry");
  }
  const space = Math.max(0, total - divider);
  if (space < minPane * 2) {
    const half = space / 2;
    return { first: half, divider, second: space - half, ratio: 0.5 };
  }
  const first = Math.min(space - minPane, Math.max(minPane, space * Math.min(1, Math.max(0, ratio))));
  return { first, divider, second: space - first, ratio: first / space };
}

/** Ratio after a divider drag of `delta` points (positive grows the first pane). */
export function dragSplitRatio(total: number, ratio: number, delta: number, divider = 12, minPane = 136): number {
  const g = splitGeometry(total, ratio, divider, minPane);
  const space = g.first + g.second;
  return space === 0 ? 0.5 : splitGeometry(total, (g.first + delta) / space, divider, minPane).ratio;
}

/** Step the keyboard and screen-reader adjust actions move the divider by. */
export const SPLIT_KEY_STEP = 0.05;
