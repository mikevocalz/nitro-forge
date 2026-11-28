/**
 * Level math for `LevelFader`. Values are linear amplitude gain
 * (0 = silence, 1 = unity / 0 dB), matching the Nitro Forge PR #25
 * NativeLevelSlider contract. No React, platform or audio engine imports.
 *
 * WaveformLane's math (`../waveform.ts`) works on signed sample extrema in
 * [-1, 1] and has no decibel conversion, so nothing is shared with it beyond
 * the linear-amplitude unit.
 */

/** Decibel window a `LevelFader` travels across. */
export interface FaderRange {
  /** Level at the lowest position above silence, in dB. Must be below `maxDb`. */
  readonly minDb: number;
  /** Level at the top of travel, in dB. At most +24 dB. */
  readonly maxDb: number;
}

/** Common fader windows. Bottom of travel is always silence. */
export const FADER_RANGES = {
  /** Unity at the top; same ceiling as the Forge PR #25 gain slider. */
  UNITY: { minDb: -60, maxDb: 0 },
  /** Console-style channel fader with +6 dB of headroom. */
  CHANNEL: { minDb: -60, maxDb: 6 },
  /** Mix bus trim with +12 dB of headroom. */
  BUS: { minDb: -72, maxDb: 12 },
} as const satisfies Record<string, FaderRange>;

/**
 * @throws {RangeError} When either bound is nonfinite, `minDb >= maxDb`,
 * `minDb < -144` or `maxDb > 24`.
 */
export function assertFaderRange(range: FaderRange): void {
  const { minDb, maxDb } = range;
  if (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || minDb >= maxDb ||
      minDb < -144 || maxDb > 24) {
    throw new RangeError("Fader range must satisfy -144 <= minDb < maxDb <= 24");
  }
}

/** Linear gain to dB. Silence (0) returns `-Infinity`. */
export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain < 0) {
    throw new RangeError("Gain must be finite and nonnegative");
  }
  return gain === 0 ? -Infinity : 20 * Math.log10(gain);
}

/** dB to linear gain. `-Infinity` returns silence (0). */
export function dbToGain(db: number): number {
  if (db === -Infinity) return 0;
  if (!Number.isFinite(db)) throw new RangeError("dB must be finite or -Infinity");
  return Math.pow(10, db / 20);
}

/** Largest gain a range allows: `dbToGain(range.maxDb)`. */
export function maxGain(range: FaderRange): number {
  assertFaderRange(range);
  return dbToGain(range.maxDb);
}

/**
 * Fader travel position in [0, 1] for a gain. Travel is linear in dB between
 * `minDb` (just above 0) and `maxDb` (1). Gains quieter than `minDb`,
 * including silence, sit at 0; gains above `maxDb` sit at 1.
 */
export function gainToPosition(gain: number, range: FaderRange): number {
  assertFaderRange(range);
  const db = gainToDb(gain);
  if (db <= range.minDb) return 0;
  return Math.min(1, (db - range.minDb) / (range.maxDb - range.minDb));
}

/**
 * Gain for a travel position. Position 0 is silence; any position above 0
 * maps linearly in dB onto `(minDb, maxDb]`, rounded to 0.1 dB so a drag
 * emits a bounded number of distinct values.
 * @throws {RangeError} When `position` is nonfinite or outside [0, 1].
 */
export function positionToGain(position: number, range: FaderRange): number {
  assertFaderRange(range);
  if (!Number.isFinite(position) || position < 0 || position > 1) {
    throw new RangeError("Fader position must be finite in [0, 1]");
  }
  if (position === 0) return 0;
  const db = range.minDb + position * (range.maxDb - range.minDb);
  return dbToGain(Math.round(db * 10) / 10);
}

/** Clamp a gain into `[0, maxGain(range)]`. */
export function clampGain(gain: number, range: FaderRange): number {
  if (!Number.isFinite(gain)) throw new RangeError("Gain must be finite");
  return Math.min(maxGain(range), Math.max(0, gain));
}

/**
 * Gain after a drag that started at `startPosition` and moved `deltaPx`
 * along a track `trackPx` long. Positive `deltaPx` raises the level. The
 * drag is relative, so grabbing the thumb never jumps the value.
 */
export function dragToGain(
  startPosition: number,
  deltaPx: number,
  trackPx: number,
  range: FaderRange,
): number {
  if (!Number.isFinite(startPosition) || !Number.isFinite(deltaPx) ||
      !Number.isFinite(trackPx) || trackPx <= 0) {
    throw new RangeError("Invalid fader drag");
  }
  const position = Math.min(1, Math.max(0, startPosition + deltaPx / trackPx));
  return positionToGain(position, range);
}

/**
 * Gain one screen-reader or keyboard step away from `gain`, in `stepDb`
 * increments. Stepping up from silence lands on `minDb`; stepping down
 * from `minDb` or below lands on silence.
 */
export function stepGain(
  gain: number,
  direction: -1 | 1,
  stepDb: number,
  range: FaderRange,
): number {
  assertFaderRange(range);
  if (!Number.isFinite(stepDb) || stepDb <= 0) {
    throw new RangeError("stepDb must be finite and positive");
  }
  // Round first: below about -100 dB the gain/dB round trip drifts under the
  // 0.1 dB grid, and an unrounded start could step back onto itself.
  const db = Math.round(gainToDb(clampGain(gain, range)) * 10) / 10;
  if (direction === 1) {
    const next = db < range.minDb ? range.minDb : Math.min(range.maxDb, db + stepDb);
    return dbToGain(Math.round(next * 10) / 10);
  }
  if (db - stepDb < range.minDb) return 0;
  return dbToGain(Math.round((db - stepDb) * 10) / 10);
}

/** Display text for a gain, e.g. `"-6.0 dB"`, `"+3.5 dB"` or `"-∞ dB"`. */
export function formatDb(gain: number): string {
  const db = gainToDb(gain);
  if (db === -Infinity) return "-∞ dB";
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toFixed(1) + " dB";
}
