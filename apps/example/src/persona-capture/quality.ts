/**
 * Frame quality evaluation for the persona capture pipeline.
 *
 * Pure, worklet-safe functions: no RN/Nitro/WebGPU imports so the same code
 * runs inside a VisionCamera frame-processor worklet and under node --test.
 *
 * Honest scope: only signals we actually measure are reported. Lighting is
 * computed from the Y plane's luma statistics. Head pose, device pose,
 * glasses and face coverage stay unmeasured until a real landmark/pose
 * evaluator lands — they are simply absent from the gate list, which the
 * native CaptureQuality contract treats as "not evaluated", never "passed".
 */

export type QualityGateName =
  | 'lighting'
  | 'head_pose'
  | 'device_pose'
  | 'glasses'
  | 'face_coverage';

/** Luma statistics sampled from a Y (luma) plane. Values normalized 0..1. */
export interface LumaStats {
  mean: number;
  /** Fraction of samples below LUMA_DARK. */
  darkRatio: number;
  /** Number of pixels actually sampled. */
  samples: number;
}

/** Sampling stride: every Nth row and column keeps cost bounded. */
export const LUMA_SAMPLE_STRIDE = 8;
/** Luma below this counts as "dark" for the darkRatio metric. */
export const LUMA_DARK = 0.18;
/** Acceptable mean-luma window for capture (normalized). */
export const LIGHTING_MIN_MEAN = 0.12;
export const LIGHTING_MAX_MEAN = 0.9;
/** Too much of the frame in near-black fails the lighting gate. */
export const LIGHTING_MAX_DARK_RATIO = 0.65;

/**
 * Compute luma statistics over a Y plane's pixel buffer.
 * `data` is the plane's ArrayBuffer (or a Uint8Array view), `width`/`height`
 * the plane's dimensions, `bytesPerRow` its row stride in bytes.
 * Worklet-safe: plain loops only.
 */
export function lumaStats(
  data: ArrayBuffer | Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
 ): LumaStats {
  'worklet';
  const px = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (width <= 0 || height <= 0 || bytesPerRow <= 0) {
    return { mean: 0, darkRatio: 1, samples: 0 };
  }
  let sum = 0;
  let dark = 0;
  let samples = 0;
  for (let y = 0; y < height; y += LUMA_SAMPLE_STRIDE) {
    const row = y * bytesPerRow;
    for (let x = 0; x < width; x += LUMA_SAMPLE_STRIDE) {
      const v = px[row + x];
      if (v === undefined) continue;
      const l = v / 255;
      sum += l;
      if (l < LUMA_DARK) dark += 1;
      samples += 1;
    }
  }
  if (samples === 0) return { mean: 0, darkRatio: 1, samples: 0 };
  return { mean: sum / samples, darkRatio: dark / samples, samples };
}

/** Lighting gate verdict from measured stats. */
export function lightingPassed(stats: LumaStats): boolean {
  'worklet';
  return (
    stats.samples > 0 &&
    stats.mean >= LIGHTING_MIN_MEAN &&
    stats.mean <= LIGHTING_MAX_MEAN &&
    stats.darkRatio <= LIGHTING_MAX_DARK_RATIO
  );
}

export interface QualityVerdict {
  gateNames: QualityGateName[];
  gatePassed: boolean[];
}

/**
 * Map measured frame stats to the gate list the native session expects.
 * Only measured gates appear; unevaluated capabilities are omitted.
 */
export function qualityForFrame(stats: LumaStats): QualityVerdict {
  'worklet';
  return {
    gateNames: ['lighting'],
    gatePassed: [lightingPassed(stats)],
  };
}
