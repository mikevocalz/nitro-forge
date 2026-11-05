// NativeSeekBar, WaveformLane, timebase and waveform math come from NYC-Tron UI
// (pinned in tooling/nyc-tron.json). New code should import the NYC-Tron
// subpaths directly; these re-exports keep existing Forge call sites working.
export { NativeSeekBar } from "@nyc-tron/ui/components/forge/NativeSeekBar";
export type { NativeSeekBarProps } from "@nyc-tron/ui/components/forge/NativeSeekBar";
export { WaveformLane } from "@nyc-tron/ui/components/forge/WaveformLane";
export type { WaveformLaneProps } from "@nyc-tron/ui/components/forge/WaveformLane";
export { normalizePeak, peaksToBars, resamplePeaks } from "@nyc-tron/ui/components/forge/waveform";
export type { WaveformPeak, WaveformBar } from "@nyc-tron/ui/components/forge/waveform";

// Local until NYC-Tron-UI PR #20 (LevelFader, seconds helpers) ships in alpha.2.
export { NativeLevelSlider } from "./NativeLevelSlider";
export type { NativeLevelSliderProps } from "./NativeLevelSlider";
export {
  FRAME_RATES, assertFrameRate, clampFrame, formatTimecode,
  framesToSeconds, secondsToFrame, frameToPosition, positionToFrame,
} from "./timebase";
export type { FrameRate, TimecodeOptions } from "./timebase";
