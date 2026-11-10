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
      /** Unreadable stream buffers; their time span shows as an empty gap. */
      readonly droppedBuffers: number;
    }
  | {
      readonly kind: "compressed-web";
      readonly uri: string;
      readonly peaks: readonly WaveformPeak[];
      readonly waveform: "decoded" | "unavailable";
      /** Why the waveform is unavailable (codec, size bound, fetch failure). */
      readonly reason?: string;
    };

export interface NativeSourceRecordingTrackProps {
  readonly store: StoreApi<RecordingSnapshot>;
  readonly onSaved?: (result: SourceRecordingFile) => void;
  /** Blocks starting a take. Stopping and saving a live take stay enabled. */
  readonly disabled?: boolean;
  /** Track name shown above the status. */
  readonly title?: string;
  readonly testID?: string;
}
