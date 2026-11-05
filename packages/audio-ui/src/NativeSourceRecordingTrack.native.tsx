import { useStore } from "zustand";
import { RecordingTrack } from "@nyc-tron/ui/components/forge/audio/RecordingTrack";
import { useForgePcmRecorder } from "./useForgePcmRecorder";
import { inputLevel, toRecordingViewState } from "./recordingView";
import type { NativeSourceRecordingTrackProps } from "./sourceRecordingTypes";

/**
 * iOS/Android: Forge's PCM recorder drawn with NYC-Tron's RecordingTrack.
 * Peaks come from the captured PCM buffers; no synthesized bars. While
 * recording the lane shows the last 160 live buffer peaks; after saving it
 * shows the 512 full-recording columns from stop(), resampled to the lane's
 * 128-column maximum (each column keeps its min/max).
 */
export function NativeSourceRecordingTrack({
  store, onSaved, disabled = false, title, testID,
}: NativeSourceRecordingTrackProps) {
  const phase = useStore(store, (s) => s.phase);
  const history = useStore(store, (s) => s.levelHistory);
  const { controller, stop } = useForgePcmRecorder(store);
  const level = phase.kind === "recording" ? inputLevel(history) : undefined;

  // Failures land in the store as an "error" phase, which the view shows.
  const start = () => { void controller.start().catch(() => undefined); };
  const save = () => { void stop().then((file) => onSaved?.(file)).catch(() => undefined); };

  return (
    <RecordingTrack
      state={toRecordingViewState(phase)}
      peaks={history}
      columns={phase.kind === "saved" ? 128 : 96}
      height={72}
      onStart={start}
      onStop={save}
      disabled={disabled}
      {...(level === undefined ? {} : { level })}
      {...(title === undefined ? {} : { title })}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
