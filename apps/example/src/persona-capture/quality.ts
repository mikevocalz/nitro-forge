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

/* ------------------------------------------------------------------ */
/* Face detection gates (VisionCamera CameraObjectOutput 'face')       */
/* ------------------------------------------------------------------ */

/** Normalized face bounding box in camera space (0..1). */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Latest face detection snapshot kept by the screen (JS side only). */
export interface FaceDetection {
  /** Exactly one face must be present. */
  faceCount: number;
  /** Primary face bounding box, normalized camera space. */
  box: FaceBox | null;
  /** Measured head rotation in degrees; null when unavailable. */
  yawDeg: number | null;
  rollDeg: number | null;
  /** ms timestamp (Date.now) when the detection was produced. */
  at: number;
}

/** A detection older than this is treated as stale and not evaluated. */
export const FACE_DETECTION_MAX_AGE_MS = 750;
/** Face bbox must cover at least this fraction of frame area. */
export const FACE_MIN_AREA_RATIO = 0.08;
/** Face bbox must not exceed this fraction of frame area. */
export const FACE_MAX_AREA_RATIO = 0.85;
/** Face center must stay within this normalized distance of frame center. */
export const FACE_MAX_CENTER_OFFSET = 0.28;
/** Head yaw/roll tolerances in degrees for the "looking at camera" gates. */
export const HEAD_POSE_MAX_YAW_DEG = 25;
export const HEAD_POSE_MAX_ROLL_DEG = 20;

function boxCenterOffset(box: FaceBox): number {
  'worklet';
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return Math.hypot(cx - 0.5, cy - 0.5);
}

/**
 * Face-coverage gate: exactly one face, plausible size, roughly centered.
 * This mirrors the reference app's RequirementsStatus/face-coverage check —
 * measured from the platform detector's bounding box, not inferred.
 */
export function faceCoveragePassed(det: FaceDetection | null, now: number): boolean {
  'worklet';
  if (!det || det.faceCount !== 1 || !det.box) return false;
  if (now - det.at > FACE_DETECTION_MAX_AGE_MS) return false;
  const { width, height } = det.box;
  if (!(width > 0) || !(height > 0)) return false;
  const area = width * height;
  if (area < FACE_MIN_AREA_RATIO || area > FACE_MAX_AREA_RATIO) return false;
  return boxCenterOffset(det.box) <= FACE_MAX_CENTER_OFFSET;
}

/**
 * Head-pose gate from measured yaw/roll. Pitch is not provided by the
 * platform detector, so it is not claimed: when either angle is unavailable
 * the gate cannot pass (unmeasured is never treated as passed).
 */
export function headPosePassed(det: FaceDetection | null, now: number): boolean {
  'worklet';
  if (!det || det.faceCount !== 1 || det.yawDeg === null || det.rollDeg === null) {
    return false;
  }
  if (now - det.at > FACE_DETECTION_MAX_AGE_MS) return false;
  return (
    Math.abs(det.yawDeg) <= HEAD_POSE_MAX_YAW_DEG &&
    Math.abs(det.rollDeg) <= HEAD_POSE_MAX_ROLL_DEG
  );
}

/**
 * Full gate verdict for a capture attempt: lighting (frame stats) plus the
 * face gates when a fresh detection is available. Face gates are only
 * included when the detector actually produced a result — a missing
 * detection omits them rather than silently passing.
 */
export function qualityForCapture(
  stats: LumaStats,
  det: FaceDetection | null,
  now: number,
): QualityVerdict {
  'worklet';
  const gateNames: QualityGateName[] = ['lighting'];
  const gatePassed: boolean[] = [lightingPassed(stats)];
  if (det !== null) {
    gateNames.push('face_coverage', 'head_pose');
    gatePassed.push(faceCoveragePassed(det, now), headPosePassed(det, now));
  }
  return { gateNames, gatePassed };
}
