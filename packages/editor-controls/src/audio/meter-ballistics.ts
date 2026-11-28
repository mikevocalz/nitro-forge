/**
 * Meter ballistics for the mixer's channel meters. The Cadence `meter` op
 * reports windowed linear sample peak and RMS per track, bus and master.
 * This file turns a stream of those peaks into what a meter draws: a bar
 * that rises at once and falls at a fixed dB rate, and a peak-hold marker
 * that stays put for a while and then falls at the same rate.
 *
 * The values are sample peak, not true (inter-sample) peak: the engine does
 * not oversample, so a reading below 1.0 can still clip after conversion.
 * No React, platform or engine imports.
 */

/** Options for {@linkcode createPeakHold}. */
export interface PeakHoldOptions {
  /** How long a new held peak stays before it starts to fall, in ms. @default 1500 */
  readonly holdMs?: number;
  /** Fall rate of the bar and of an expired hold, in dB per second. @default 20 */
  readonly fallDbPerSecond?: number;
}

/**
 * One meter frame from {@linkcode createPeakHold}, linear like the input.
 * Pass `level` and `hold` to `LevelMeter` as `level` and `peakHold`.
 */
export interface MeterReading {
  /** Bar level after the fall-off. */
  readonly level: number;
  /** Held peak marker; never below `level`. */
  readonly hold: number;
}

/** Below this linear level (-60 dBFS) a falling bar or hold drops to 0. */
export const PEAK_HOLD_FLOOR = 0.001;

function assertPeak(peak: number): void {
  if (!Number.isFinite(peak) || peak < 0) {
    throw new RangeError("Meter peak must be a finite linear value >= 0, got " + String(peak));
  }
}

/**
 * Returns a function fed with `(peak, nowMs)` on every meter update; it
 * returns the bar and hold to draw. Attack is instant. Without new peaks
 * the bar falls at `fallDbPerSecond`; the hold stays for `holdMs` after the
 * last time it was raised, then falls at the same rate. A clock that goes
 * backwards is treated as no time passing.
 *
 * @example
 * const ballistics = createPeakHold();
 * const { level, hold } = ballistics(engineMeter.tracks[0].max_peak, performance.now());
 * @throws {RangeError} When `holdMs` is negative or NaN, or `fallDbPerSecond` is not a positive finite number.
 */
export function createPeakHold(
  { holdMs = 1500, fallDbPerSecond = 20 }: PeakHoldOptions = {},
): (peak: number, nowMs: number) => MeterReading {
  if (Number.isNaN(holdMs) || holdMs < 0) throw new RangeError("holdMs must be >= 0");
  if (!Number.isFinite(fallDbPerSecond) || fallDbPerSecond <= 0) {
    throw new RangeError("fallDbPerSecond must be a positive finite number");
  }
  const fall = (value: number, ms: number) => {
    if (ms <= 0) return value;
    const next = value * 10 ** (-(fallDbPerSecond * ms) / 1000 / 20);
    return next < PEAK_HOLD_FLOOR ? 0 : next;
  };
  let level = 0;
  let lastMs: number | undefined;
  let heldPeak = 0;
  let heldAt = 0;
  return (peak, nowMs) => {
    assertPeak(peak);
    if (!Number.isFinite(nowMs)) throw new RangeError("nowMs must be finite");
    const now = lastMs === undefined ? nowMs : Math.max(nowMs, lastMs);
    const dt = lastMs === undefined ? 0 : now - lastMs;
    lastMs = now;
    level = Math.max(peak, fall(level, dt));
    const age = now - heldAt;
    let hold = age <= holdMs ? heldPeak : fall(heldPeak, age - holdMs);
    if (peak >= hold) {
      heldPeak = peak;
      heldAt = now;
      hold = peak;
    }
    return { level, hold: Math.max(hold, level) };
  };
}
