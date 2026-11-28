/**
 * Pan math for {@linkcode PanControl}. Values are the engine's mono pan,
 * -1 (hard left) .. 0 (centre) .. 1 (hard right). No React, platform or
 * audio engine imports.
 *
 * The stereo field is physical: left is the left speaker in every locale,
 * so nothing here mirrors for right-to-left layouts.
 */

/** Smallest pan change a drag or step can produce. */
export const PAN_QUANTUM = 0.01;

/** Within this distance of centre a drag snaps to exactly 0. */
export const PAN_CENTRE_DETENT = 0.04;

/** @throws {RangeError} When `pan` is nonfinite or outside [-1, 1]. */
export function assertPan(pan: number): void {
  if (!Number.isFinite(pan) || pan < -1 || pan > 1) {
    throw new RangeError("Pan must be finite in [-1, 1]");
  }
}

/** Round to {@linkcode PAN_QUANTUM} and clamp into [-1, 1]. */
export function quantizePan(pan: number): number {
  if (!Number.isFinite(pan)) throw new RangeError("Pan must be finite");
  const q = Math.round(pan / PAN_QUANTUM) * PAN_QUANTUM;
  // toFixed strips binary noise such as 0.30000000000000004.
  return Number(Math.min(1, Math.max(-1, q)).toFixed(2));
}

/** Track position in [0, 1] (0 = left edge) for a pan value. */
export function panToPosition(pan: number): number {
  assertPan(pan);
  return (pan + 1) / 2;
}

/**
 * Pan after a drag that started at `startPan` and moved `deltaPx` to the
 * right along a track `trackPx` wide. Relative, so grabbing never jumps.
 * Results inside {@linkcode PAN_CENTRE_DETENT} snap to centre.
 */
export function dragToPan(startPan: number, deltaPx: number, trackPx: number): number {
  assertPan(startPan);
  if (!Number.isFinite(deltaPx) || !Number.isFinite(trackPx) || trackPx <= 0) {
    throw new RangeError("Invalid pan drag");
  }
  const raw = startPan + (deltaPx / trackPx) * 2;
  const pan = quantizePan(raw);
  return Math.abs(pan) <= PAN_CENTRE_DETENT ? 0 : pan;
}

/**
 * Pan one keyboard or screen-reader step away. A step that crosses centre
 * stops on centre, so reaching 0 never needs a fine adjustment.
 */
export function stepPan(pan: number, direction: -1 | 1, step: number): number {
  assertPan(pan);
  if (!Number.isFinite(step) || step <= 0 || step > 2) {
    throw new RangeError("Pan step must be in (0, 2]");
  }
  const next = quantizePan(pan + direction * step);
  if ((pan < 0 && next > 0) || (pan > 0 && next < 0)) return 0;
  return next;
}

/**
 * Short readout: `"C"`, `"L 25"`, `"R 100"`. Percent of the way to the
 * hard-panned edge, rounded.
 */
export function formatPan(pan: number): string {
  assertPan(pan);
  const percent = Math.round(Math.abs(pan) * 100);
  if (percent === 0) return "C";
  return (pan < 0 ? "L " : "R ") + percent;
}

/** Spoken readout: `"centre"`, `"25 percent left"`. */
export function describePan(pan: number): string {
  assertPan(pan);
  const percent = Math.round(Math.abs(pan) * 100);
  if (percent === 0) return "centre";
  return percent + " percent " + (pan < 0 ? "left" : "right");
}

/**
 * Spoken readout for a bus balance, which the Cadence engine applies by
 * attenuating the far side and keeping the near side: `"centre"`,
 * `"25 percent right, left side at 75 percent"`.
 */
export function describeBalance(pan: number): string {
  assertPan(pan);
  const percent = Math.round(Math.abs(pan) * 100);
  if (percent === 0) return "centre";
  const far = pan < 0 ? "right" : "left";
  return percent + " percent " + (pan < 0 ? "left" : "right") + ", " + far + " side at " + (100 - percent) + " percent";
}
