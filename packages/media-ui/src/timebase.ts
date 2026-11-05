/**
 * Frame/timebase math, including the seconds conversions, is owned by NYC-Tron
 * UI (@nyc-tron/ui/components/forge/timebase). These are re-exports only.
 */
import type { formatTimecode } from "@nyc-tron/ui/components/forge/timebase";

export {
  FRAME_RATES,
  assertFrameRate,
  clampFrame,
  formatTimecode,
  framesToSeconds,
  frameToPosition,
  positionToFrame,
  secondsToFrame,
} from "@nyc-tron/ui/components/forge/timebase";
export type { FrameRate } from "@nyc-tron/ui/components/forge/timebase";

/** Options accepted by NYC-Tron's formatTimecode. */
export type TimecodeOptions = NonNullable<Parameters<typeof formatTimecode>[2]>;
