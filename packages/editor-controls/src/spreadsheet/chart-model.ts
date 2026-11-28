import { cellAddress, parseCellAddress, rangeCellCount, type SheetRange } from "../sheet-window.ts";

/**
 * Mark family a chart draws. These are exactly the kinds
 * `@nyc-tron/native-charts` renders (Vico on Android, Swift Charts on iOS),
 * so the gallery never offers a chart the renderer cannot draw.
 */
export type SheetChartKind = "line" | "column" | "area";
export const SHEET_CHART_KINDS: readonly SheetChartKind[] = ["line", "column", "area"];

/** Whether each series runs down a column or across a row of the source range. */
export type SeriesOrientation = "columns" | "rows";

/** What {@linkcode ChartBuilder} edits. The app stores it; nothing here persists it. */
export interface SheetChartSpec {
  readonly kind: SheetChartKind;
  /** A1 range such as `A1:C12`, on the sheet shown in the grid. */
  readonly range: string;
  readonly seriesIn: SeriesOrientation;
  /** First row (`columns`) or first column (`rows`) holds the series names. */
  readonly hasHeader: boolean;
  /** First column (`columns`) or first row (`rows`) holds numeric x values. */
  readonly hasXValues: boolean;
  readonly title?: string;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
}

/** A point list with the same shape as `@nyc-tron/native-charts` `NativeChartSeries`. */
export interface SheetChartSeries {
  readonly id: string;
  readonly label: string;
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

/** Series plus the count of cells that held no number and were left out. */
export interface SheetChartData {
  readonly series: readonly SheetChartSeries[];
  readonly skippedCells: number;
}

/** Cell values {@linkcode chartSeriesFromCells} reads, keyed by A1 address. */
export type ChartCellValues = Readonly<Record<string, { readonly computed: string | number | boolean | null } | undefined>>;

/** Largest range a chart reads; matches the Tally adapter's default window budget. */
export const MAX_CHART_CELLS = 4096;

/** `A1:C9` (either corner order) or a single `B4` as a normalized range; `undefined` when malformed. */
export function parseA1Range(text: string): SheetRange | undefined {
  const parts = text.trim().replaceAll("$", "").toUpperCase().split(":");
  if (parts.length > 2) return undefined;
  const a = parseCellAddress(parts[0] ?? "");
  const b = parts.length === 2 ? parseCellAddress(parts[1]!) : a;
  if (!a || !b) return undefined;
  return {
    startRow: Math.min(a.row, b.row), endRow: Math.max(a.row, b.row),
    startColumn: Math.min(a.column, b.column), endColumn: Math.max(a.column, b.column),
  };
}

const numeric = (value: string | number | boolean | null | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * Turns the computed values of a chart's source range into series. Header
 * cells name series; otherwise they are `Series 1`, `Series 2`, ... A column
 * (or row) with no numbers at all, such as a text label column, is not a
 * series and is left out; its cells still count as skipped. Without
 * x values, points use their 1-based position. Cells without a number (text,
 * blanks, errors, booleans) are skipped and counted, never drawn as zero.
 * Throws `RangeError` for a malformed range or one over `maxCells`.
 */
export function chartSeriesFromCells(
  spec: SheetChartSpec, cells: ChartCellValues, maxCells = MAX_CHART_CELLS,
): SheetChartData {
  const range = parseA1Range(spec.range);
  if (!range) throw new RangeError(`"${spec.range}" is not a cell range.`);
  if (rangeCellCount(range) > maxCells) throw new RangeError(`Charts read at most ${maxCells} cells.`);
  const byColumns = spec.seriesIn === "columns";
  // Along: the axis points run on. Across: the axis series sit side by side.
  const alongStart = byColumns ? range.startRow : range.startColumn;
  const alongEnd = byColumns ? range.endRow : range.endColumn;
  const acrossStart = byColumns ? range.startColumn : range.startRow;
  const acrossEnd = byColumns ? range.endColumn : range.endRow;
  const at = (along: number, across: number) =>
    cells[byColumns ? cellAddress(along, across) : cellAddress(across, along)]?.computed;
  const firstPoint = alongStart + (spec.hasHeader ? 1 : 0);
  const firstSeries = acrossStart + (spec.hasXValues ? 1 : 0);
  let skipped = 0;
  const series: SheetChartSeries[] = [];
  for (let across = firstSeries; across <= acrossEnd; across++) {
    const header = spec.hasHeader ? at(alongStart, across) : undefined;
    const label = header !== undefined && header !== null && String(header).trim() !== ""
      ? String(header) : `Series ${series.length + 1}`;
    const points: { x: number; y: number }[] = [];
    for (let along = firstPoint; along <= alongEnd; along++) {
      const y = numeric(at(along, across));
      const x = spec.hasXValues ? numeric(at(along, acrossStart)) : along - firstPoint + 1;
      if (y === undefined || x === undefined) { skipped++; continue; }
      points.push({ x, y });
    }
    if (points.length > 0) series.push({ id: `s${across - firstSeries}`, label, points });
  }
  // Two headers with the same text would collide in a legend; disambiguate.
  const seen = new Map<string, number>();
  const unique = series.map(s => {
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    return n === 1 ? s : { ...s, label: `${s.label} (${n})` };
  });
  return { series: unique, skippedCells: skipped };
}
