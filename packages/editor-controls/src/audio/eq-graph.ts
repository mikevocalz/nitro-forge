/**
 * Plot math for {@linkcode EQFrequencyGraph}: log-frequency and dB mapping,
 * gridlines, response polyline pieces, band handle positions, drag and
 * keyboard edits, and readout text. No React, platform or audio engine
 * imports, and no filter math: the response curve is whatever the engine's
 * `eqResponse` returned, mapped onto the plot as-is.
 *
 * Frequency runs left to right in every locale, like a spectrum analyser,
 * so nothing here mirrors for right-to-left layouts.
 */

/** Filter shape of one EQ band, as the Cadence engine names it. */
export type EqBandType = "peak" | "low_shelf" | "high_shelf" | "low_pass" | "high_pass";

/** One band of an EQ insert, in the camelCase the UI props use. */
export interface EqBand {
  readonly type: EqBandType;
  /** Centre or corner frequency, 20..20000 Hz. */
  readonly freqHz: number;
  /** Boost or cut, -24..24 dB. Pass bands ignore it. */
  readonly gainDb: number;
  /** Bandwidth, 0.1..18. */
  readonly q: number;
  readonly enabled: boolean;
}

/** One point of the engine's combined magnitude response. */
export interface EqResponsePoint {
  readonly hz: number;
  readonly db: number;
}

/** The two values a handle drag or key press edits. */
export interface EqBandEdit {
  readonly freqHz: number;
  readonly gainDb: number;
}

/** Plot size in points and the dB shown from the centre line to the top edge. */
export interface EqPlot {
  readonly width: number;
  readonly height: number;
  /** Half the visible dB span, e.g. 18 shows -18..+18 dB. */
  readonly rangeDb: number;
}

/**
 * A straight piece of a polyline, ready for an absolutely positioned view
 * rotated about its centre: place it at `centerX`/`centerY`, `length` wide,
 * rotated by `angleDeg`. Same shape as the spreadsheet sparkline segments.
 */
export interface PlotSegment {
  readonly centerX: number;
  readonly centerY: number;
  readonly length: number;
  readonly angleDeg: number;
}

/** A gridline position with its axis label. */
export interface PlotGridline {
  /** Position along the axis in points (x for frequency, y for gain). */
  readonly at: number;
  /** Axis label, empty for minor lines. */
  readonly label: string;
  /** Labelled lines draw stronger than the unlabelled decade steps. */
  readonly major: boolean;
}

export const EQ_MIN_HZ = 20;
export const EQ_MAX_HZ = 20000;
/** The engine's gain limit for shelf and peak bands. */
export const EQ_GAIN_LIMIT_DB = 24;
export const EQ_MIN_Q = 0.1;
export const EQ_MAX_Q = 18;
/** Default visible range, ±18 dB. */
export const EQ_DEFAULT_RANGE_DB = 18;
/** The engine stores at most this many bands per EQ insert. */
export const EQ_MAX_BANDS = 8;

const DECADES = Math.log10(EQ_MAX_HZ / EQ_MIN_HZ); // 3

function assertPlot(plot: EqPlot): void {
  const { width, height, rangeDb } = plot;
  if (![width, height, rangeDb].every(Number.isFinite) || width <= 0 || height <= 0 || rangeDb <= 0) {
    throw new RangeError("EQ plot width, height and range must be positive");
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** True for `low_pass` and `high_pass`, whose gain is ignored and whose handle sits on 0 dB. */
export function isPassBand(type: EqBandType): boolean {
  return type === "low_pass" || type === "high_pass";
}

/** Clamp into 20..20000 Hz. @throws {RangeError} When `hz` is not finite. */
export function clampFreq(hz: number): number {
  if (!Number.isFinite(hz)) throw new RangeError("Frequency must be finite");
  return clamp(hz, EQ_MIN_HZ, EQ_MAX_HZ);
}

/**
 * Round a frequency to a resolution that suits its decade (0.1 Hz below
 * 100 Hz, 1 Hz below 1 kHz, 10 Hz below 10 kHz, 100 Hz above), so drags do
 * not commit values like 1234.5678 Hz while fine steps still move at 20 Hz.
 */
export function roundFreq(hz: number): number {
  const c = clampFreq(hz);
  const unit = c < 100 ? 0.1 : c < 1000 ? 1 : c < 10000 ? 10 : 100;
  return Number(clampFreq(Math.round(c / unit) * unit).toFixed(1));
}

/** Clamp into ±24 dB and round to 0.1 dB. */
export function roundGain(db: number): number {
  if (!Number.isFinite(db)) throw new RangeError("Gain must be finite");
  const g = Number(clamp(Math.round(db * 10) / 10, -EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB).toFixed(1));
  return g === 0 ? 0 : g; // no -0
}

/** x in points for a frequency, 20 Hz at 0 and 20 kHz at `width`. Out-of-range input clamps. */
export function freqToX(hz: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) throw new RangeError("Width must be positive");
  return (Math.log10(clampFreq(hz) / EQ_MIN_HZ) / DECADES) * width;
}

/** Frequency at `x` points across a plot `width` wide. Out-of-range x clamps. */
export function xToFreq(x: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(x)) throw new RangeError("Invalid x");
  return EQ_MIN_HZ * 10 ** ((clamp(x, 0, width) / width) * DECADES);
}

/** y in points for a gain, +range at 0 and -range at `height`. Values past the range clamp to the edge. */
export function dbToY(db: number, height: number, rangeDb: number): number {
  assertPlot({ width: 1, height, rangeDb });
  if (!Number.isFinite(db)) throw new RangeError("Gain must be finite");
  return height / 2 - (clamp(db, -rangeDb, rangeDb) / rangeDb) * (height / 2);
}

/** Gain at `y` points down a plot `height` tall. */
export function yToDb(y: number, height: number, rangeDb: number): number {
  assertPlot({ width: 1, height, rangeDb });
  if (!Number.isFinite(y)) throw new RangeError("Invalid y");
  return ((height / 2 - clamp(y, 0, height)) / (height / 2)) * rangeDb;
}

/**
 * Frequency gridlines: labelled lines at 100 Hz, 1 kHz and 10 kHz, and
 * unlabelled lines on the other 1-2-5 steps of each decade.
 */
export function eqFrequencyGridlines(width: number): PlotGridline[] {
  const lines: PlotGridline[] = [];
  for (const decade of [10, 100, 1000, 10000]) {
    for (const m of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const hz = decade * m;
      if (hz <= EQ_MIN_HZ || hz >= EQ_MAX_HZ) continue;
      const major = hz === 100 || hz === 1000 || hz === 10000;
      lines.push({ at: freqToX(hz, width), label: major ? formatFreqShort(hz) : "", major });
    }
  }
  return lines;
}

/** Gain gridlines at 0, ±6 and ±12 dB, keeping those inside the visible range. */
export function eqGainGridlines(height: number, rangeDb: number): PlotGridline[] {
  return [12, 6, 0, -6, -12].filter(db => Math.abs(db) < rangeDb)
    .map(db => ({ at: dbToY(db, height, rangeDb), label: db > 0 ? "+" + db : String(db), major: db === 0 }));
}

/** Polyline pieces joining consecutive points. Zero-length pieces are dropped. */
export function polylineSegments(points: readonly { readonly x: number; readonly y: number }[]): PlotSegment[] {
  const out: PlotSegment[] = [];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!, b = points[k]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    out.push({ centerX: (a.x + b.x) / 2, centerY: (a.y + b.y) / 2, length,
      angleDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
  }
  return out;
}

/**
 * The engine response mapped onto the plot. Points outside 20 Hz..20 kHz and
 * nonfinite points are skipped; gains past the visible range ride the edge.
 */
export function eqResponseSegments(response: readonly EqResponsePoint[], plot: EqPlot): PlotSegment[] {
  assertPlot(plot);
  const pts = response
    .filter(p => Number.isFinite(p.hz) && Number.isFinite(p.db) && p.hz >= EQ_MIN_HZ && p.hz <= EQ_MAX_HZ)
    .map(p => ({ x: freqToX(p.hz, plot.width), y: dbToY(p.db, plot.height, plot.rangeDb) }));
  return polylineSegments(pts);
}

/** Centre of a band's handle. Pass bands sit on the 0 dB line. */
export function eqHandlePosition(band: Pick<EqBand, "type" | "freqHz" | "gainDb">, plot: EqPlot): { x: number; y: number } {
  assertPlot(plot);
  return {
    x: freqToX(band.freqHz, plot.width),
    y: dbToY(isPassBand(band.type) ? 0 : band.gainDb, plot.height, plot.rangeDb),
  };
}

/**
 * Band values after a handle drag that started at `start` and moved
 * `dx`/`dy` points (y down). Relative, so grabbing never jumps. Frequency
 * follows the log axis and rounds with {@linkcode roundFreq}; gain clamps to
 * the visible range so the handle never leaves the plot. Pass bands keep
 * their gain.
 */
export function dragBand(start: EqBandEdit, type: EqBandType, dx: number, dy: number, plot: EqPlot): EqBandEdit {
  assertPlot(plot);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new RangeError("Invalid EQ drag");
  const octaves = (dx / plot.width) * DECADES * Math.log2(10);
  const freqHz = roundFreq(clampFreq(start.freqHz) * 2 ** octaves);
  if (isPassBand(type)) return { freqHz, gainDb: start.gainDb };
  const limit = Math.min(plot.rangeDb, EQ_GAIN_LIMIT_DB);
  const raw = start.gainDb - (dy / (plot.height / 2)) * plot.rangeDb;
  return { freqHz, gainDb: roundGain(clamp(raw, -limit, limit)) };
}

/** A key the band handle understands. */
export type EqKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "PageUp" | "PageDown" | "Home";

/** Frequency step per Left/Right press, in octaves (one twelfth). */
export const EQ_FREQ_STEP_OCT = 1 / 12;
/** Fine frequency step with Shift, in octaves. */
export const EQ_FREQ_FINE_OCT = 1 / 48;

/**
 * Band values after one key press. Left/Right move one twelfth of an octave
 * (a quarter of that with `fine`), Up/Down 0.5 dB (0.1 fine), PageUp/PageDown
 * 3 dB (1 fine), Home resets gain to 0 dB. Gain keys do nothing on pass
 * bands. Returns `undefined` for other keys.
 */
export function stepBand(band: Pick<EqBand, "type" | "freqHz" | "gainDb">, key: string, fine = false): EqBandEdit | undefined {
  const freqHz = clampFreq(band.freqHz);
  const gainDb = band.gainDb;
  const pass = isPassBand(band.type);
  const oct = fine ? EQ_FREQ_FINE_OCT : EQ_FREQ_STEP_OCT;
  switch (key) {
    case "ArrowLeft": case "ArrowRight": {
      const next = roundFreq(freqHz * 2 ** (key === "ArrowRight" ? oct : -oct));
      return { freqHz: next, gainDb };
    }
    case "ArrowUp": case "ArrowDown": case "PageUp": case "PageDown": {
      if (pass) return { freqHz, gainDb };
      const size = key.startsWith("Page") ? (fine ? 1 : 3) : (fine ? 0.1 : 0.5);
      const sign = key === "ArrowUp" || key === "PageUp" ? 1 : -1;
      return { freqHz, gainDb: roundGain(gainDb + sign * size) };
    }
    case "Home":
      return { freqHz, gainDb: pass ? gainDb : 0 };
    default:
      return undefined;
  }
}

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** `"31.5 Hz"`, `"120 Hz"`, `"1.2 kHz"`, `"12.5 kHz"`. */
export function formatFreq(hz: number): string {
  const c = clampFreq(hz);
  if (c < 100) return trim(c, 1) + " Hz";
  if (c < 1000) return Math.round(c) + " Hz";
  return trim(c / 1000, c < 10000 ? 2 : 1) + " kHz";
}

/** Axis label: `"100"`, `"1k"`, `"10k"`. */
export function formatFreqShort(hz: number): string {
  return hz >= 1000 ? trim(hz / 1000, 1) + "k" : trim(hz, 0);
}

/** `"+3.0 dB"`, `"-2.5 dB"`, `"0.0 dB"`. */
export function formatGain(db: number): string {
  const g = roundGain(db);
  return (g > 0 ? "+" : "") + g.toFixed(1) + " dB";
}

/** `"Q 0.71"`. */
export function formatQ(q: number): string {
  if (!Number.isFinite(q)) throw new RangeError("Q must be finite");
  return trim(clamp(q, EQ_MIN_Q, EQ_MAX_Q), 2);
}

const TYPE_NAMES: Record<EqBandType, string> = {
  peak: "Peak", low_shelf: "Low shelf", high_shelf: "High shelf", low_pass: "Low pass", high_pass: "High pass",
};

/** Display name of a band type, e.g. `"Low shelf"`. */
export function bandTypeName(type: EqBandType): string {
  return TYPE_NAMES[type];
}

/** Spoken gain: `"plus 3 dB"`, `"minus 2.5 dB"`, `"0 dB"`. */
export function describeGain(db: number): string {
  const g = roundGain(db);
  if (g === 0) return "0 dB";
  return (g > 0 ? "plus " : "minus ") + trim(Math.abs(g), 1) + " dB";
}

/**
 * Accessible value of a band handle: `"Peak 1.2 kHz, plus 3 dB"`,
 * `"High pass 80 Hz"`, with `", bypassed"` when the band is off.
 */
export function describeBand(band: EqBand): string {
  const head = bandTypeName(band.type) + " " + formatFreq(band.freqHz);
  const body = isPassBand(band.type) ? head : head + ", " + describeGain(band.gainDb);
  return band.enabled ? body : body + ", bypassed";
}
