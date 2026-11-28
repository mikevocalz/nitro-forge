/**
 * Display math for an input level meter. The level comes from the app's audio
 * engine (Forge owns capture and PCM); this file only maps a linear peak in
 * [0, 1] to dBFS, a fill fraction and a coarse spoken band.
 */

/** Coarse band a screen reader hears instead of a raw number every frame. */
export type MeterBand = "silent" | "low" | "good" | "hot" | "clipping";

/** Lowest dBFS drawn by {@linkcode meterFill}; anything quieter is empty. */
export const METER_FLOOR_DB = -60;

/** Band thresholds in dBFS, from loud to quiet. */
export const METER_BANDS = {
  clipping: -0.5,
  hot: -6,
  good: -24,
  low: -48,
} as const satisfies Record<Exclude<MeterBand, "silent">, number>;

function assertLevel(level: number): number {
  if (!Number.isFinite(level) || level < 0) {
    throw new RangeError("Meter level must be a finite linear peak >= 0, got " + String(level));
  }
  return Math.min(1, level);
}

/** Linear peak to dBFS. Zero maps to -Infinity. */
export function levelToDb(level: number): number {
  const value = assertLevel(level);
  return value === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(value);
}

/** Fill fraction in [0, 1] on a dB scale from {@linkcode METER_FLOOR_DB} to 0 dBFS. */
export function meterFill(level: number): number {
  const db = levelToDb(level);
  if (db <= METER_FLOOR_DB) return 0;
  return Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB);
}

/** Spoken band for a linear peak. */
export function meterBand(level: number): MeterBand {
  const db = levelToDb(level);
  if (db >= METER_BANDS.clipping) return "clipping";
  if (db >= METER_BANDS.hot) return "hot";
  if (db >= METER_BANDS.good) return "good";
  if (db >= METER_BANDS.low) return "low";
  return "silent";
}

/** Default spoken text per band. Apps pass their own for localization. */
export const METER_BAND_LABELS = {
  silent: "No input",
  low: "Input low",
  good: "Input level good",
  hot: "Input hot",
  clipping: "Input clipping",
} as const satisfies Record<MeterBand, string>;

/** Options for {@linkcode createMeterAnnouncer}. */
export interface MeterAnnouncerOptions {
  /** Minimum gap between two announcements, in ms. Clipping skips the wait. @default 2000 */
  readonly minIntervalMs?: number;
  /** Text per band. @default METER_BAND_LABELS */
  readonly labels?: Readonly<Record<MeterBand, string>>;
}

/**
 * Returns a function fed with `(level, nowMs)` on every meter update. It
 * returns text to announce only when the band changed AND the interval has
 * elapsed since the last announcement; otherwise `undefined`. Clipping is
 * announced as soon as it starts, since it means the take is being damaged.
 * A band that flickers back to the last spoken one is never repeated.
 */
export function createMeterAnnouncer(
  { minIntervalMs = 2000, labels = METER_BAND_LABELS }: MeterAnnouncerOptions = {},
): (level: number, nowMs: number) => string | undefined {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new RangeError("minIntervalMs must be a finite number >= 0");
  }
  let spoken: MeterBand | undefined;
  let spokenAt = Number.NEGATIVE_INFINITY;
  return (level, nowMs) => {
    const band = meterBand(level);
    if (band === spoken) return undefined;
    if (band !== "clipping" && nowMs - spokenAt < minIntervalMs) return undefined;
    spoken = band;
    spokenAt = nowMs;
    return labels[band];
  };
}
