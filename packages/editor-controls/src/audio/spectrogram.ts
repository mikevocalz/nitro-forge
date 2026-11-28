/**
 * Display math for {@linkcode SpectrogramView}. The engine (Cadence
 * `spectrogram`) returns one row per hop with one dB value per log-spaced
 * band, floored at -120 dB, where a full-scale sine reads about 0 dB. This
 * file max-pools that matrix down to a bounded grid, maps dB to a few
 * intensity steps and places the frequency and time axis labels.
 */

/** Most columns (time) drawn, however wide the view is. */
export const SPECTROGRAM_MAX_COLUMNS = 96;
/** Most rows (frequency) drawn, however many bands the engine returns. */
export const SPECTROGRAM_MAX_ROWS = 32;
/** dB floor the engine reports for silence. */
export const SPECTROGRAM_FLOOR_DB = -120;

/**
 * Lower bound in dB of intensity steps 1 to 5. A cell quieter than the first
 * threshold is step 0 and draws nothing.
 */
export const SPECTROGRAM_THRESHOLDS_DB = [-90, -72, -54, -36, -18] as const;

/** Intensity step 0 (below -90 dB, not drawn) to 5 (-18 dB and louder). */
export type IntensityStep = 0 | 1 | 2 | 3 | 4 | 5;

/** Maps a dB value to an {@linkcode IntensityStep}. */
export function intensityStep(db: number): IntensityStep {
  if (!Number.isFinite(db)) return 0;
  let step = 0;
  for (const t of SPECTROGRAM_THRESHOLDS_DB) if (db >= t) step++;
  return step as IntensityStep;
}

/** Columns for a measured width: one per 3 pt, at most {@linkcode SPECTROGRAM_MAX_COLUMNS}. */
export function columnsForWidth(widthPt: number, frameCount: number): number {
  const byWidth = Math.floor(Math.max(0, widthPt) / 3);
  return Math.max(1, Math.min(SPECTROGRAM_MAX_COLUMNS, byWidth, Math.max(1, frameCount)));
}

/** A max-pooled spectrogram ready to draw. Row 0 is the lowest frequency. */
export interface SpectrogramGrid {
  readonly columns: number;
  readonly rows: number;
  /** Loudest dB per cell, `rows * columns`, row-major from row 0. */
  readonly db: readonly number[];
}

/**
 * Max-pools `frames` (time x band) into at most `maxColumns` x `maxRows`
 * cells. Each cell keeps the loudest value it covers, so a short transient
 * survives the reduction. Missing or non-finite values count as the floor.
 */
export function poolSpectrogram(
  frames: readonly (readonly number[])[], bandCount: number,
  maxColumns: number = SPECTROGRAM_MAX_COLUMNS, maxRows: number = SPECTROGRAM_MAX_ROWS,
): SpectrogramGrid {
  if (!Number.isInteger(maxColumns) || maxColumns < 1) throw new RangeError("maxColumns must be an integer >= 1");
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new RangeError("maxRows must be an integer >= 1");
  const columns = Math.min(Math.min(maxColumns, SPECTROGRAM_MAX_COLUMNS), frames.length);
  const rows = Math.min(Math.min(maxRows, SPECTROGRAM_MAX_ROWS), bandCount);
  const db = new Array<number>(rows * columns).fill(SPECTROGRAM_FLOOR_DB);
  for (let c = 0; c < columns; c++) {
    const f0 = Math.floor(c * frames.length / columns), f1 = Math.floor((c + 1) * frames.length / columns);
    for (let r = 0; r < rows; r++) {
      const b0 = Math.floor(r * bandCount / rows), b1 = Math.floor((r + 1) * bandCount / rows);
      let best = SPECTROGRAM_FLOOR_DB;
      for (let f = f0; f < f1; f++) {
        const frame = frames[f];
        for (let b = b0; b < b1; b++) {
          const v = frame?.[b];
          if (v !== undefined && Number.isFinite(v) && v > best) best = v;
        }
      }
      db[r * columns + c] = best;
    }
  }
  return { columns, rows, db };
}

/** One drawn rectangle: a run of adjacent cells in a row with the same step. */
export interface SpectrogramRun {
  readonly row: number;
  readonly column: number;
  /** Cells covered, >= 1. */
  readonly span: number;
  readonly step: Exclude<IntensityStep, 0>;
}

/**
 * Merges adjacent same-step cells in each row and drops step-0 cells, so
 * the number of drawn views is at most `rows * columns` and usually far less.
 */
export function spectrogramRuns(grid: SpectrogramGrid): SpectrogramRun[] {
  const runs: SpectrogramRun[] = [];
  for (let r = 0; r < grid.rows; r++) {
    let c = 0;
    while (c < grid.columns) {
      const step = intensityStep(grid.db[r * grid.columns + c]!);
      let end = c + 1;
      while (end < grid.columns && intensityStep(grid.db[r * grid.columns + end]!) === step) end++;
      if (step !== 0) runs.push({ row: r, column: c, span: end - c, step });
      c = end;
    }
  }
  return runs;
}

/** `125` to "125 Hz", `1000` to "1k", `12500` to "12.5k". */
export function formatHz(hz: number): string {
  if (hz >= 1000) {
    return String(Math.round(hz / 100) / 10) + "k";
  }
  return String(Math.round(hz)) + " Hz";
}

/** An axis label at a position along the axis, 0 to 1. */
export interface AxisTick {
  readonly label: string;
  /** 0 at the start (lowest frequency or time zero), 1 at the end. */
  readonly position: number;
}

/**
 * Frequency labels at 100 Hz, 1 kHz and 10 kHz when they fall inside the band
 * range. Positions are measured from the bottom, interpolating between band
 * centres on a log scale, where each band fills an equal share of the height.
 */
export function frequencyTicks(bandsHz: readonly number[]): AxisTick[] {
  const n = bandsHz.length;
  if (n < 2) return [];
  const ticks: AxisTick[] = [];
  for (const hz of [100, 1000, 10000]) {
    if (hz < bandsHz[0]! || hz > bandsHz[n - 1]!) continue;
    let i = 0;
    while (i < n - 2 && bandsHz[i + 1]! < hz) i++;
    const lo = Math.log(bandsHz[i]!), hi = Math.log(bandsHz[i + 1]!);
    const index = i + (hi === lo ? 0 : (Math.log(hz) - lo) / (hi - lo));
    ticks.push({ label: hz === 100 ? "100 Hz" : formatHz(hz).replace(/k$/, " kHz"), position: (index + 0.5) / n });
  }
  return ticks;
}

/**
 * Time labels in seconds at a round step (0.1, 0.2, 0.5, 1, 2, 5, ...) with
 * at most `maxTicks` labels, starting at 0.
 */
export function timeTicks(durationSeconds: number, maxTicks = 5): AxisTick[] {
  if (!(durationSeconds > 0)) return [];
  const raw = durationSeconds / Math.max(1, maxTicks - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) ?? 10 * pow;
  const ticks: AxisTick[] = [];
  for (let k = 0; k * step <= durationSeconds + 1e-9 && ticks.length < maxTicks; k++) {
    const t = k * step;
    ticks.push({ label: (step < 1 ? t.toFixed(1) : String(Math.round(t))) + " s", position: t / durationSeconds });
  }
  return ticks;
}

/**
 * Screen-reader summary: duration, band range and the loudest band with the
 * time it peaks. Reads the full-resolution frames, not the pooled grid.
 */
export function describeSpectrogram(
  frames: readonly (readonly number[])[], bandsHz: readonly number[], hopSeconds: number,
): string {
  const duration = frames.length * hopSeconds;
  const head = "Spectrogram, " + (Math.round(duration * 10) / 10).toFixed(1) + " seconds";
  if (bandsHz.length === 0 || frames.length === 0) return head + ", no data.";
  const spoken = (hz: number) => formatHz(hz).replace(/k$/, " kHz");
  const range = ", " + spoken(bandsHz[0]!) + " to " + spoken(bandsHz[bandsHz.length - 1]!);
  let best = Number.NEGATIVE_INFINITY, bestF = 0, bestB = 0;
  frames.forEach((frame, f) => frame.forEach((v, b) => {
    if (Number.isFinite(v) && v > best) { best = v; bestF = f; bestB = b; }
  }));
  if (best <= SPECTROGRAM_THRESHOLDS_DB[0]) return head + range + ". Silent throughout.";
  const hz = bandsHz[bestB] ?? 0;
  const db = Math.round(best);
  return head + range + ". Loudest: " + spoken(hz) + " band at "
    + (Math.round(bestF * hopSeconds * 10) / 10).toFixed(1) + " s, " + (db < 0 ? "−" + -db : String(db)) + " dB.";
}
