/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Adapted from artcraft-android/capcraft-android SpeedCurveEditor.kt
 * (blob efbac2efebb02b9a3243e51acfcab9257410ac3b).
 * Copyright (c) 2026 ArtCraft Team and CapCraft contributors.
 * Modifications copyright Nitro Forge contributors, 2026-11-03.
 */
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;

export interface SpeedPoint {
  /** Normalized position in the source clip, [0, 1]. */
  readonly at: number;
  /** Speed multiplier 0.1x..10x. */
  readonly speed: number;
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(label + " must be finite");
}

export function speedToPosition(speed: number): number {
  requireFinite(speed, "speed");
  const s = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
  return (Math.log(s) - Math.log(MIN_SPEED)) /
    (Math.log(MAX_SPEED) - Math.log(MIN_SPEED));
}

export function positionToSpeed(position: number): number {
  requireFinite(position, "position");
  const p = Math.max(0, Math.min(1, position));
  return Math.exp(Math.log(MIN_SPEED) +
    p * (Math.log(MAX_SPEED) - Math.log(MIN_SPEED)));
}

export function validateCurve(points: readonly SpeedPoint[]): SpeedPoint[] {
  if (points.length < 2 || points.length > 4096) {
    throw new RangeError("Expected 2 to 4096 curve points");
  }
  let prior = -1;
  const cleaned = points.map((point, i) => {
    requireFinite(point.at, "point.at");
    requireFinite(point.speed, "point.speed");
    if (point.at <= prior || point.at < 0 || point.at > 1) {
      throw new RangeError("Curve positions must strictly increase within [0, 1]");
    }
    if (point.speed < MIN_SPEED || point.speed > MAX_SPEED) {
      throw new RangeError("Curve speeds must be 0.1x..10x");
    }
    prior = point.at;
    return { at: point.at, speed: point.speed };
  });
  if (cleaned[0]!.at !== 0 || cleaned[cleaned.length - 1]!.at !== 1) {
    throw new RangeError("Curve must start at 0 and end at 1");
  }
  return cleaned;
}

/** The original CapCraft trapezoidal approximation for average clip rate. */
export function meanSpeed(points: readonly SpeedPoint[]): number {
  const curve = validateCurve(points);
  let area = 0;
  for (let i = 1; i < curve.length; i++) {
    const left = curve[i - 1]!;
    const right = curve[i]!;
    area += (right.at - left.at) * (left.speed + right.speed) / 2;
  }
  return area;
}

export function previewDurationSeconds(
  sourceSeconds: number,
  points: readonly SpeedPoint[],
): number {
  requireFinite(sourceSeconds, "sourceSeconds");
  if (sourceSeconds < 0) throw new RangeError("Duration cannot be negative");
  return sourceSeconds / meanSpeed(points);
}

/** GPU-friendly samples, not a frame-accurate retime or engine command. */
export function sampleSpeeds(points: readonly SpeedPoint[], bins = 256): number[] {
  const curve = validateCurve(points);
  if (!Number.isInteger(bins) || bins < 2 || bins > 4096) {
    throw new RangeError("bins must be an integer in [2, 4096]");
  }
  let segment = 0;
  const output: number[] = [];
  for (let i = 0; i < bins; i++) {
    const at = i / (bins - 1);
    while (segment + 2 < curve.length && at > curve[segment + 1]!.at) {
      segment++;
    }
    const a = curve[segment]!;
    const b = curve[segment + 1]!;
    const t = (at - a.at) / (b.at - a.at);
    output.push(a.speed + (b.speed - a.speed) * t);
  }
  return output;
}
