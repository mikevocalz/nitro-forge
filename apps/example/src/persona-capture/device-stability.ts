/**
 * Device-stability gate for phone-hosted capture.
 *
 * The reference app tracks phone pose during capture; on a phone we cannot
 * measure phone-to-face geometry without ARCore/ARKit, so this gate measures
 * what is honestly available: the accelerometer signal must be present, fresh,
 * and steady (low variance of the gravity-compensated magnitude). A moving or
 * jittering phone fails the gate. This is a stability proxy, not a pose
 * estimate — documented as such.
 */

export interface AccelSample {
  x: number;
  y: number;
  z: number;
  /** ms timestamp (Date.now). */
  at: number;
}

/** A detection/sample older than this is treated as stale. */
export const ACCEL_MAX_AGE_MS = 500;
/** Minimum samples required before the gate can evaluate. */
export const ACCEL_MIN_SAMPLES = 8;
/** Maximum allowed stddev of |a| (m/s^2) — handheld-steady tolerance. */
export const ACCEL_MAX_STDDEV = 0.6;
/** |a| must stay within this band — the accelerometer includes gravity,
 *  so a resting phone reads ~9.8 m/s^2, not 1g. */
export const ACCEL_MIN_MAGNITUDE = 7.0;
export const ACCEL_MAX_MAGNITUDE = 12.0;

export interface AccelStats {
  mean: number;
  stddev: number;
  samples: number;
}

/** Worklet-safe: plain loops only. */
export function accelStats(samples: readonly AccelSample[]): AccelStats {
  'worklet';
  if (samples.length === 0) return { mean: 0, stddev: Infinity, samples: 0 };
  let sum = 0;
  const mags: number[] = [];
  for (const s of samples) {
    const m = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    mags.push(m);
    sum += m;
  }
  const mean = sum / mags.length;
  let varSum = 0;
  for (const m of mags) {
    const d = m - mean;
    varSum += d * d;
  }
  return { mean, stddev: Math.sqrt(varSum / mags.length), samples: mags.length };
}

/**
 * Device-stability gate. `samples` is the recent accelerometer window,
 * `now` the evaluation time. Fails closed: insufficient or stale data fails.
 */
export function deviceStablePassed(
  samples: readonly AccelSample[],
  now: number,
): boolean {
  'worklet';
  if (samples.length < ACCEL_MIN_SAMPLES) return false;
  const latest = samples[samples.length - 1];
  if (!latest || now - latest.at > ACCEL_MAX_AGE_MS) return false;
  const stats = accelStats(samples);
  if (stats.mean < ACCEL_MIN_MAGNITUDE || stats.mean > ACCEL_MAX_MAGNITUDE) {
    return false;
  }
  return stats.stddev <= ACCEL_MAX_STDDEV;
}
