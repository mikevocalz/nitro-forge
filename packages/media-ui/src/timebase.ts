/**
 * Frame/timebase math, including the seconds conversions, is owned by NYC-Tron
 * UI (@nitro-forge/editor-controls/timebase). These are re-exports only.
 */
import type { formatTimecode } from "@nitro-forge/editor-controls/timebase";

export {
  FRAME_RATES,
  assertFrameRate,
  clampFrame,
  formatTimecode,
  framesToSeconds,
  frameToPosition,
  positionToFrame,
  secondsToFrame,
} from "@nitro-forge/editor-controls/timebase";
export type { FrameRate } from "@nitro-forge/editor-controls/timebase";

/** Options accepted by NYC-Tron's formatTimecode. */
export type TimecodeOptions = NonNullable<Parameters<typeof formatTimecode>[2]>;
