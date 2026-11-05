import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { RecordingTrack } from "@nyc-tron/ui/components/forge/audio/RecordingTrack";
import { useForgeAudioRecorder } from "./useForgeAudioRecorder";
import type { RecordingSnapshot } from "./recording";
import { inputLevel, toRecordingViewState } from "./recordingView";

export interface NativeRecordingTrackProps {
  /** Stable Zustand store scoped to exactly one recording session/track. */
  readonly store: StoreApi<RecordingSnapshot>;
  readonly onSaved?: (uri: string) => void;
  /** Track name shown above the status. */
  readonly title?: string;
  readonly testID?: string;
  /** Blocks starting a take. Stopping and saving a live take stay enabled. */
  readonly disabled?: boolean;
}

/**
 * Forge's recording controller drawn with NYC-Tron's RecordingTrack. The
 * controller owns the microphone and file; this component maps its phase and
 * meter history onto the view and routes the view's callbacks back to it.
 */
export function NativeRecordingTrack({
  store, onSaved, title, testID, disabled = false,
}: NativeRecordingTrackProps) {
  const phase = useStore(store, (s) => s.phase);
  const levelHistory = useStore(store, (s) => s.levelHistory);
  const controller = useForgeAudioRecorder(store);
  const level = inputLevel(levelHistory);

  // Failures land in the store as an "error" phase, which the view shows.
  const start = () => { void controller.start().catch(() => undefined); };
  const stop = () => {
    void controller.stop().then((uri) => onSaved?.(uri)).catch(() => undefined);
  };

  return (
    <RecordingTrack
      state={toRecordingViewState(phase)}
      peaks={levelHistory}
      columns={64}
      height={64}
      onStart={start}
      onStop={stop}
      disabled={disabled}
      {...(level === undefined ? {} : { level })}
      {...(title === undefined ? {} : { title })}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
