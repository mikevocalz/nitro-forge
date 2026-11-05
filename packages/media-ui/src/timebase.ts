/**
 * Frame/timebase math is owned by NYC-Tron UI (@nyc-tron/ui/components/forge/timebase).
 * Only the seconds conversions below are still local: NYC-Tron v0.1.0-alpha.1
 * does not ship them. They move to NYC-Tron in NYC-Tron-UI PR #20 (alpha.2);
 * delete them here and re-export once Forge pins that release.
 */
import { assertFrameRate, formatTimecode, type FrameRate } from "@nyc-tron/ui/components/forge/timebase";

export {
  FRAME_RATES,
  assertFrameRate,
  clampFrame,
  formatTimecode,
  frameToPosition,
  positionToFrame,
} from "@nyc-tron/ui/components/forge/timebase";
export type { FrameRate } from "@nyc-tron/ui/components/forge/timebase";

/** Options accepted by NYC-Tron's formatTimecode. */
export type TimecodeOptions = NonNullable<Parameters<typeof formatTimecode>[2]>;

/** Local until NYC-Tron-UI PR #20 ships in alpha.2. */
export function framesToSeconds(frame: number, rate: FrameRate): number {
  assertFrameRate(rate);
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError("Frame must be a nonnegative safe integer");
  }
  return frame * rate.denominator / rate.numerator;
}

/** Local until NYC-Tron-UI PR #20 ships in alpha.2. */
export function secondsToFrame(seconds: number, rate: FrameRate): number {
  assertFrameRate(rate);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError("Seconds must be finite and nonnegative");
  }
  const rounded = Math.round(seconds * rate.numerator / rate.denominator);
  if (!Number.isSafeInteger(rounded)) throw new RangeError("Frame exceeds safe integer");
  return rounded;
}
