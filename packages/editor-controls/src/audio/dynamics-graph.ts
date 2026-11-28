/**
 * Plot math for {@linkcode DynamicsTransferGraph}: a square input/output
 * plot over -60..0 dBFS, the engine's transfer curve as polyline pieces,
 * threshold drag and steps, ratio steps and readout text. No React,
 * platform or engine imports, and no compressor math: the curve is the
 * engine's `dynamicsCurve`, mapped as-is.
 *
 * Input level runs left to right in every locale, so nothing mirrors.
 */
import { polylineSegments, type PlotSegment } from "./eq-graph.ts";

/** One point of the engine's static transfer curve. */
export interface DynamicsCurvePoint {
  readonly inDb: number;
  readonly outDb: number;
}

/** The compressor parameters the graph shows. Times are not drawn on a static curve. */
export interface DynamicsParams {
  /** -60..0 dB. */
  readonly thresholdDb: number;
  /** 1..20, shown as `"<ratio>:1"`. */
  readonly ratio: number;
  /** 0..24 dB. */
  readonly kneeDb: number;
  /** 0..24 dB. */
  readonly makeupDb: number;
}

export const DYN_MIN_DB = -60;
export const DYN_MAX_DB = 0;
export const DYN_MIN_RATIO = 1;
export const DYN_MAX_RATIO = 20;
/** Gridline spacing on both axes. */
export const DYN_GRID_DB = 12;
/** The ratio stepper's stops. */
export const RATIO_STEPS: readonly number[] = [1, 1.5, 2, 3, 4, 6, 8, 10, 20];

const SPAN = DYN_MAX_DB - DYN_MIN_DB;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function assertSize(size: number): void {
  if (!Number.isFinite(size) || size <= 0) throw new RangeError("Dynamics plot size must be positive");
}

/** Distance in points from the left (input) or bottom (output) edge for a level. Out-of-range levels clamp. */
export function levelToOffset(db: number, size: number): number {
  assertSize(size);
  if (!Number.isFinite(db)) throw new RangeError("Level must be finite");
  return ((clamp(db, DYN_MIN_DB, DYN_MAX_DB) - DYN_MIN_DB) / SPAN) * size;
}

/** Plot coordinates (origin top-left, y down) for an input/output pair. */
export function dynamicsPoint(inDb: number, outDb: number, size: number): { x: number; y: number } {
  return { x: levelToOffset(inDb, size), y: size - levelToOffset(outDb, size) };
}

/** Gridline offsets every 12 dB, inside the plot edges, with labels such as `"-12"`. */
export function dynamicsGridlines(size: number): { db: number; at: number; label: string }[] {
  assertSize(size);
  const out = [];
  for (let db = DYN_MIN_DB + DYN_GRID_DB; db < DYN_MAX_DB; db += DYN_GRID_DB) {
    out.push({ db, at: levelToOffset(db, size), label: String(db) });
  }
  return out;
}

/** The engine curve mapped onto a `size` square. Nonfinite points are skipped; levels past the plot ride its edge. */
export function dynamicsCurveSegments(curve: readonly DynamicsCurvePoint[], size: number): PlotSegment[] {
  assertSize(size);
  const pts = curve.filter(p => Number.isFinite(p.inDb) && Number.isFinite(p.outDb))
    .map(p => dynamicsPoint(p.inDb, p.outDb, size));
  return polylineSegments(pts);
}

/** The 1:1 reference line from the bottom-left to the top-right corner. */
export function unitySegment(size: number): PlotSegment {
  return polylineSegments([{ x: 0, y: size }, { x: size, y: 0 }])[0]!;
}

/**
 * Output level at `inDb`, read off the engine curve by straight-line
 * interpolation between its points (the curve is sampled every 1 dB, so
 * this places a meter dot, it does not model the compressor). `undefined`
 * when the curve is empty.
 */
export function curveOutputAt(curve: readonly DynamicsCurvePoint[], inDb: number): number | undefined {
  const pts = curve.filter(p => Number.isFinite(p.inDb) && Number.isFinite(p.outDb));
  if (pts.length === 0 || !Number.isFinite(inDb)) return undefined;
  const sorted = [...pts].sort((a, b) => a.inDb - b.inDb);
  if (inDb <= sorted[0]!.inDb) return sorted[0]!.outDb;
  for (let k = 1; k < sorted.length; k++) {
    const a = sorted[k - 1]!, b = sorted[k]!;
    if (inDb <= b.inDb) {
      const t = b.inDb === a.inDb ? 0 : (inDb - a.inDb) / (b.inDb - a.inDb);
      return a.outDb + t * (b.outDb - a.outDb);
    }
  }
  return sorted[sorted.length - 1]!.outDb;
}

/** Round to 1 dB and clamp into -60..0. */
export function clampThreshold(db: number): number {
  if (!Number.isFinite(db)) throw new RangeError("Threshold must be finite");
  const t = clamp(Math.round(db), DYN_MIN_DB, DYN_MAX_DB);
  return t === 0 ? 0 : t;
}

/** Threshold after a horizontal handle drag of `dx` points across a `size` plot. Relative, so grabbing never jumps. */
export function dragThreshold(startDb: number, dx: number, size: number): number {
  assertSize(size);
  if (!Number.isFinite(dx)) throw new RangeError("Invalid threshold drag");
  return clampThreshold(startDb + (dx / size) * SPAN);
}

/** The next ratio stop above (`1`) or below (`-1`) `ratio`. Values between stops move to the neighbouring stop. Stays put at the ends. */
export function stepRatio(ratio: number, direction: -1 | 1): number {
  if (!Number.isFinite(ratio)) throw new RangeError("Ratio must be finite");
  if (direction === 1) return RATIO_STEPS.find(s => s > ratio + 1e-9) ?? clamp(ratio, DYN_MIN_RATIO, DYN_MAX_RATIO);
  for (let k = RATIO_STEPS.length - 1; k >= 0; k--) if (RATIO_STEPS[k]! < ratio - 1e-9) return RATIO_STEPS[k]!;
  return clamp(ratio, DYN_MIN_RATIO, DYN_MAX_RATIO);
}

const trim = (n: number) => String(Number(n.toFixed(1)));

/** `"3:1"`, `"1.5:1"`. */
export function formatRatio(ratio: number): string {
  return trim(clamp(ratio, DYN_MIN_RATIO, DYN_MAX_RATIO)) + ":1";
}

/** `"-18 dB"`. */
export function formatThreshold(db: number): string {
  return clampThreshold(db) + " dB";
}

/** `"6 dB"`, `"2.5 dB"`. */
export function formatKnee(db: number): string {
  return trim(clamp(db, 0, 24)) + " dB";
}

/** `"+0 dB"`, `"+2.5 dB"`. Makeup is never negative. */
export function formatMakeup(db: number): string {
  return "+" + trim(clamp(db, 0, 24)) + " dB";
}

/** Spoken level: `"minus 18 dB"`, `"0 dB"`. */
export function describeLevel(db: number): string {
  const r = Number(db.toFixed(1));
  if (r === 0) return "0 dB";
  return (r < 0 ? "minus " : "plus ") + trim(Math.abs(r)) + " dB";
}

/** Screen-reader summary of the plot, e.g. `"Threshold minus 18 dB, ratio 3 to 1, knee 6 dB, makeup 0 dB"`. */
export function describeDynamics(p: DynamicsParams, inputLevelDb?: number): string {
  const ratio = trim(clamp(p.ratio, DYN_MIN_RATIO, DYN_MAX_RATIO)) + " to 1";
  const base = `Threshold ${describeLevel(clampThreshold(p.thresholdDb))}, ratio ${ratio}, knee ${formatKnee(p.kneeDb)}, makeup ${trim(clamp(p.makeupDb, 0, 24))} dB`;
  return inputLevelDb === undefined || !Number.isFinite(inputLevelDb) ? base : base + ", input " + describeLevel(inputLevelDb);
}
