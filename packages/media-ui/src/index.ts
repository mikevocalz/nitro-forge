// NativeSeekBar, WaveformLane, LevelFader, timebase and waveform math come from NYC-Tron UI
// (pinned in tooling/nyc-tron.json). New code should import the NYC-Tron
// subpaths directly; these re-exports keep existing Forge call sites working.
export { NativeSeekBar } from "@nitro-forge/editor-controls/NativeSeekBar";
export type { NativeSeekBarProps } from "@nitro-forge/editor-controls/NativeSeekBar";
export { WaveformLane } from "@nitro-forge/editor-controls/WaveformLane";
export type { WaveformLaneProps } from "@nitro-forge/editor-controls/WaveformLane";
export { normalizePeak, peaksToBars, resamplePeaks } from "@nitro-forge/editor-controls/waveform";
export type { WaveformPeak, WaveformBar } from "@nitro-forge/editor-controls/waveform";

export { LevelFader } from "@nitro-forge/editor-controls/audio/LevelFader";
export type { LevelFaderProps } from "@nitro-forge/editor-controls/audio/LevelFader";
export {
  FRAME_RATES, assertFrameRate, clampFrame, formatTimecode,
  framesToSeconds, secondsToFrame, frameToPosition, positionToFrame,
} from "./timebase";
export type { FrameRate, TimecodeOptions } from "./timebase";
