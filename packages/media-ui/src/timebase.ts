/** Shared frame/timebase mathematics. No React or platform imports. */
export interface FrameRate {
  /** Exact frames per second = numerator / denominator. */
  readonly numerator: number;
  readonly denominator: number;
}
export const FRAME_RATES = {
  FILM_24: { numerator: 24, denominator: 1 },
  PAL_25: { numerator: 25, denominator: 1 },
  NTSC_2997: { numerator: 30000, denominator: 1001 },
  NTSC_5994: { numerator: 60000, denominator: 1001 },
  VIDEO_30: { numerator: 30, denominator: 1 },
  VIDEO_60: { numerator: 60, denominator: 1 },
} as const satisfies Record<string, FrameRate>;

export function assertFrameRate(rate: FrameRate): void {
  if (!Number.isSafeInteger(rate.numerator) || rate.numerator < 1 ||
      rate.numerator > 120000 || !Number.isSafeInteger(rate.denominator) ||
      rate.denominator < 1 || rate.denominator > 100000) {
    throw new RangeError("Frame rate must be a positive bounded rational");
  }
}

export function clampFrame(frame: number, durationFrames: number): number {
  if (!Number.isFinite(frame) || !Number.isSafeInteger(durationFrames) ||
      durationFrames < 0) {
    throw new RangeError("Invalid frame or duration");
  }
  return Math.min(durationFrames, Math.max(0, Math.round(frame)));
}

export function framesToSeconds(frame: number, rate: FrameRate): number {
  assertFrameRate(rate);
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError("Frame must be a nonnegative safe integer");
  }
  return frame * rate.denominator / rate.numerator;
}

export function secondsToFrame(seconds: number, rate: FrameRate): number {
  assertFrameRate(rate);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError("Seconds must be finite and nonnegative");
  }
  const rounded = Math.round(seconds * rate.numerator / rate.denominator);
  if (!Number.isSafeInteger(rounded)) throw new RangeError("Frame exceeds safe integer");
  return rounded;
}

export interface TimecodeOptions {
  /** SMPTE drop-frame timecode is defined here for 30000/1001 or 60000/1001 only. */
  readonly dropFrame?: boolean;
}
export function formatTimecode(
  frame: number,
  rate: FrameRate,
  options: TimecodeOptions = {},
): string {
  assertFrameRate(rate);
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError("Frame must be a nonnegative safe integer");
  }
  const nominalFps = Math.round(rate.numerator / rate.denominator);
  if (nominalFps < 1 || nominalFps > 120) {
    throw new RangeError("Timecode frame rate outside supported range");
  }
  let labeledFrames = frame;
  if (options.dropFrame) {
    const ntsc29 = rate.numerator === 30000 && rate.denominator === 1001;
    const ntsc59 = rate.numerator === 60000 && rate.denominator === 1001;
    if (!ntsc29 && !ntsc59) {
      throw new RangeError("Drop-frame timecode requires NTSC 30000/1001 or 60000/1001");
    }
    const dropped = ntsc59 ? 4 : 2;
    const framesPer10Minutes = 60 * nominalFps * 10 - dropped * 9;
    const framesPerMinute = 60 * nominalFps - dropped;
    const blocks = Math.floor(frame / framesPer10Minutes);
    const remainder = frame % framesPer10Minutes;
    const extra = dropped * Math.max(0, Math.floor((remainder - dropped) / framesPerMinute));
    labeledFrames += (blocks * dropped * 9) + extra;
  }
  const frames = labeledFrames % nominalFps;
  const seconds = Math.floor(labeledFrames / nominalFps) % 60;
  const minutes = Math.floor(labeledFrames / (nominalFps * 60)) % 60;
  const hours = Math.floor(labeledFrames / (nominalFps * 3600));
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const sep = options.dropFrame ? ";" : ":";
  return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds) + sep + pad(frames);
}
