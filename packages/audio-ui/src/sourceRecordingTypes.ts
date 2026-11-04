import type { StoreApi } from "zustand/vanilla";
import type { WaveformPeak } from "@nitro-forge/media-ui";
import type { RecordingSnapshot } from "./recording";

export type SourceRecordingFile =
  | {
      readonly kind: "pcm-wav";
      readonly uri: string;
      readonly peaks: readonly WaveformPeak[];
      readonly sampleRate: number;
      readonly channels: number;
      readonly durationSeconds: number;
    }
  | {
      readonly kind: "compressed-web";
      readonly uri: string;
      readonly peaks: readonly WaveformPeak[];
      readonly waveform: "decoded" | "unavailable";
    };

export interface NativeSourceRecordingTrackProps {
  readonly store: StoreApi<RecordingSnapshot>;
  readonly onSaved?: (result: SourceRecordingFile) => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}
