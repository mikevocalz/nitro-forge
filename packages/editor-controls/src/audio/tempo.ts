/**
 * Tempo, tap-tempo and time-signature math for
 * {@linkcode TempoAndMetronome}. Pure; no React, timers or audio imports.
 * Bounds match the Cadence engine (`setTempo` 20..=400 BPM,
 * `setTimeSig` numerator >= 1, denominator a power of two <= 128).
 */

export const MIN_BPM = 20;
export const MAX_BPM = 400;

/** Denominators offered by the picker. The engine also accepts 1, 32, 64 and 128. */
export const TIME_SIG_DENOMINATORS = [2, 4, 8, 16] as const;

/** Largest numerator the stepper offers. */
export const MAX_NUMERATOR = 32;

/** A gap longer than this starts a new tap sequence. */
export const TAP_RESET_MS = 2000;

/** Taps averaged for the estimate; older taps fall off. */
export const TAP_WINDOW = 8;

/** Time signature as `[numerator, denominator]`, the engine's `time_sig` shape. */
export type TimeSignature = readonly [number, number];

/** @throws {RangeError} When `bpm` is outside 20..400. */
export function assertBpm(bpm: number): void {
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
    throw new RangeError(`Tempo must be ${MIN_BPM}..${MAX_BPM} BPM`);
  }
}

/** Round to 0.1 BPM and clamp into the engine's range. */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) throw new RangeError("Tempo must be finite");
  return Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) * 10) / 10;
}

/** @returns true when the engine would accept the signature. */
export function isValidTimeSignature([n, d]: TimeSignature): boolean {
  return Number.isInteger(n) && n >= 1 && Number.isInteger(d) && d >= 1 && d <= 128 &&
    (d & (d - 1)) === 0;
}

/** `"7/8"`. */
export function formatTimeSignature([n, d]: TimeSignature): string {
  return n + "/" + d;
}

/**
 * Append a tap time (ms, any monotonic clock) to a tap history. A gap over
 * {@linkcode TAP_RESET_MS} or a clock that went backwards starts over.
 * Keeps at most {@linkcode TAP_WINDOW} taps.
 */
export function addTap(taps: readonly number[], atMs: number): number[] {
  if (!Number.isFinite(atMs)) throw new RangeError("Tap time must be finite");
  const last = taps.at(-1);
  if (last === undefined || atMs <= last || atMs - last > TAP_RESET_MS) return [atMs];
  return [...taps, atMs].slice(-TAP_WINDOW);
}

/**
 * Tempo from a tap history: 60000 / mean interval, clamped and rounded to
 * 0.1 BPM. Undefined until there are two taps.
 */
export function tapTempo(taps: readonly number[]): number | undefined {
  if (taps.length < 2) return undefined;
  const span = taps.at(-1)! - taps[0]!;
  if (!(span > 0)) return undefined;
  return clampBpm(60000 / (span / (taps.length - 1)));
}

/**
 * Zero-based beat inside its bar for a playhead in ticks. `ppq` is ticks
 * per quarter note; a beat is one denominator note.
 */
export function beatInBar(ticks: number, ppq: number, [n, d]: TimeSignature): number {
  if (!Number.isFinite(ticks) || ticks < 0 || !Number.isInteger(ppq) || ppq <= 0) {
    throw new RangeError("Invalid playhead");
  }
  const ticksPerBeat = (ppq * 4) / d;
  return Math.floor(ticks / ticksPerBeat) % n;
}
