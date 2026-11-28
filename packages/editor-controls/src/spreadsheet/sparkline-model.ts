/** In-cell chart family. `winloss` draws equal bars up for positive, down for negative. */
export type SparklineKind = "line" | "column" | "winloss";
export const SPARKLINE_KINDS: readonly SparklineKind[] = ["line", "column", "winloss"];

/** Where the value axis starts: the data minimum, or zero. */
export type SparklineAxisMin = "auto" | "zero";

/** What {@linkcode SparklineEditor} edits. The app stores it with its own view state. */
export interface SparklineSpec {
  readonly kind: SparklineKind;
  /** One row or one column, such as `B2:M2`. */
  readonly dataRange: string;
  /** The cell the sparkline draws in, such as `N2`. */
  readonly location: string;
  readonly showHigh: boolean;
  readonly showLow: boolean;
  /** Mark negative bars (column and win/loss) with the negative tone. */
  readonly showNegative: boolean;
  readonly axisMin: SparklineAxisMin;
}

/** Visual role of one mark, mapped to theme tokens by {@linkcode Sparkline}. */
export type SparklineMarkTone = "normal" | "negative" | "high" | "low";

/** A bar in local coordinates (origin top-left, y down). */
export interface SparklineBar {
  readonly index: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly tone: SparklineMarkTone;
}
/**
 * A straight line piece, ready for an absolutely positioned view rotated
 * about its center: place it at `centerX`/`centerY`, `length` wide, rotated
 * by `angleDeg`.
 */
export interface SparklineSegment {
  readonly centerX: number;
  readonly centerY: number;
  readonly length: number;
  readonly angleDeg: number;
}
/** A marker dot on a line sparkline. */
export interface SparklineMarker {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly tone: SparklineMarkTone;
}
export interface SparklineGeometry {
  readonly bars: readonly SparklineBar[];
  readonly segments: readonly SparklineSegment[];
  readonly markers: readonly SparklineMarker[];
  /** Index of the highest and lowest value, `undefined` without data. */
  readonly highIndex?: number;
  readonly lowIndex?: number;
  /** Count of numeric values drawn. */
  readonly valueCount: number;
}

export interface SparklineGeometryOptions {
  readonly kind: SparklineKind;
  readonly width: number;
  readonly height: number;
  readonly axisMin?: SparklineAxisMin;
  readonly showHigh?: boolean;
  readonly showLow?: boolean;
  readonly showNegative?: boolean;
  /** Space between column bars. @default 1 */
  readonly gap?: number;
}

/**
 * Layout for an in-cell sparkline. `undefined` entries are gaps: a line breaks
 * there and a column slot stays empty. Values are never coerced to zero.
 */
export function sparklineGeometry(
  values: readonly (number | undefined)[], options: SparklineGeometryOptions,
): SparklineGeometry {
  const { kind, width, height, axisMin = "auto", showHigh = false, showLow = false, showNegative = true, gap = 1 } = options;
  if (![width, height, gap].every(Number.isFinite) || width <= 0 || height <= 0 || gap < 0) {
    throw new RangeError("Sparkline size must be positive");
  }
  const present = values.flatMap((v, i) => (typeof v === "number" && Number.isFinite(v) ? [{ v, i }] : []));
  if (present.length === 0 || values.length === 0) return { bars: [], segments: [], markers: [], valueCount: 0 };
  let high = present[0]!, low = present[0]!;
  for (const p of present) { if (p.v > high.v) high = p; if (p.v < low.v) low = p; }
  const toneOf = (i: number, v: number): SparklineMarkTone =>
    showHigh && i === high.i ? "high" : showLow && i === low.i ? "low" : showNegative && v < 0 ? "negative" : "normal";
  const slot = width / values.length;
  const barWidth = Math.max(1, slot - gap);
  const base = { highIndex: high.i, lowIndex: low.i, valueCount: present.length };

  if (kind === "winloss") {
    const mid = height / 2;
    const bars = present.filter(p => p.v !== 0).map(p => ({
      index: p.i, left: p.i * slot + gap / 2, width: barWidth,
      top: p.v > 0 ? 0 : mid, height: mid, tone: toneOf(p.i, p.v),
    }));
    return { ...base, bars, segments: [], markers: [] };
  }
  const min = axisMin === "zero" ? Math.min(0, low.v) : low.v;
  const max = Math.max(axisMin === "zero" ? 0 : high.v, high.v);
  const span = max - min;
  // A flat series sits mid-height instead of dividing by zero.
  const y = (v: number) => (span === 0 ? height / 2 : height - ((v - min) / span) * height);

  if (kind === "column") {
    const zero = y(Math.max(min, Math.min(max, 0)));
    const bars = present.map(p => {
      const top = Math.min(y(p.v), zero);
      return { index: p.i, left: p.i * slot + gap / 2, width: barWidth, top,
        height: Math.max(1, Math.abs(zero - y(p.v))), tone: toneOf(p.i, p.v) };
    });
    return { ...base, bars, segments: [], markers: [] };
  }
  const x = (i: number) => values.length === 1 ? width / 2 : (i / (values.length - 1)) * width;
  const segments: SparklineSegment[] = [];
  for (let k = 1; k < present.length; k++) {
    const a = present[k - 1]!, b = present[k]!;
    if (b.i !== a.i + 1) continue; // gap
    const x1 = x(a.i), y1 = y(a.v), x2 = x(b.i), y2 = y(b.v);
    segments.push({
      centerX: (x1 + x2) / 2, centerY: (y1 + y2) / 2,
      length: Math.hypot(x2 - x1, y2 - y1), angleDeg: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
    });
  }
  const markers = present
    .filter(p => (showHigh && p.i === high.i) || (showLow && p.i === low.i))
    .map(p => ({ index: p.i, x: x(p.i), y: y(p.v), tone: toneOf(p.i, p.v) }));
  return { ...base, bars: [], segments, markers };
}

/** A field of {@linkcode SparklineSpec} that failed validation, with the message to show under it. */
export interface SparklineSpecProblem {
  readonly field: "dataRange" | "location";
  readonly message: string;
}

/** `undefined` when the spec is usable, otherwise the first problem and the field it belongs to. */
export function sparklineSpecProblem(
  spec: SparklineSpec,
  parse: (range: string) => { startRow: number; endRow: number; startColumn: number; endColumn: number } | undefined,
): SparklineSpecProblem | undefined {
  const data = parse(spec.dataRange);
  if (!data) return { field: "dataRange", message: "Enter a data range such as B2:M2." };
  if (data.startRow !== data.endRow && data.startColumn !== data.endColumn) {
    return { field: "dataRange", message: "Use one row or one column of data." };
  }
  const at = parse(spec.location);
  if (!at || at.startRow !== at.endRow || at.startColumn !== at.endColumn) {
    return { field: "location", message: "Enter one cell for the sparkline, such as N2." };
  }
  return undefined;
}
