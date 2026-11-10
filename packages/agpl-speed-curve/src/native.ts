/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Native batch APIs through Expo Modules 2.0; tested device build pending.
 */
import { validateCurve, type SpeedPoint } from "./math.js";

interface NativeCapCurve {
  meanSpeedAsync(positions: number[], speeds: number[]): Promise<number>;
  sampleSpeedsAsync(positions: number[], speeds: number[], bins: number): Promise<number[]>;
}

async function module(): Promise<NativeCapCurve> {
  const { requireNativeModule } = await import("expo");
  return requireNativeModule<NativeCapCurve>("ForgeCapCurve");
}

export async function nativeMeanSpeed(points: readonly SpeedPoint[]): Promise<number> {
  const normalized = validateCurve(points);
  return (await module()).meanSpeedAsync(normalized.map(p => p.at), normalized.map(p => p.speed));
}

export async function nativeSampleSpeeds(
  points: readonly SpeedPoint[],
  bins = 256,
): Promise<number[]> {
  if (!Number.isInteger(bins) || bins < 2 || bins > 4096) {
    throw new RangeError("bins must be an integer in [2, 4096]");
  }
  const normalized = validateCurve(points);
  return (await module()).sampleSpeedsAsync(
    normalized.map(p => p.at), normalized.map(p => p.speed), bins,
  );
}
