export { NativeRecordingTrack } from "./NativeRecordingTrack";
export type { NativeRecordingTrackProps } from "./NativeRecordingTrack";
export { useForgeAudioRecorder } from "./useForgeAudioRecorder";
export {
  ForgeRecordingController,
  INTERRUPTED_MESSAGE,
  MAX_METER_HISTORY,
  createRecordingStore,
  dbfsToPeak,
  pushMeterLevel,
} from "./recording";
export type {
  RecordingDriver,
  RecordingPhase,
  RecordingSnapshot,
  RecordingStatus,
} from "./recording";

export { NativeSourceRecordingTrack } from "./NativeSourceRecordingTrack";
export type { NativeSourceRecordingTrackProps, SourceRecordingFile } from "./sourceRecordingTypes";
export { WaveformPeakAccumulator, peakFromPcmBuffer } from "./pcmPeaks";
export type { PcmEncoding, PcmPeakChunk } from "./pcmPeaks";
