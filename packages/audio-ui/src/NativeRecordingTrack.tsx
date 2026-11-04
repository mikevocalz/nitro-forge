import { Button, Column, Host, Text } from "@expo/ui";
import { View } from "react-native";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { WaveformLane } from "@nitro-forge/media-ui";
import { useForgeAudioRecorder } from "./useForgeAudioRecorder";
import type { RecordingSnapshot } from "./recording";

export interface NativeRecordingTrackProps {
  /** Stable Zustand store scoped to exactly one recording session/track. */
  readonly store: StoreApi<RecordingSnapshot>;
  readonly onSaved?: (uri: string) => void;
  readonly testID?: string;
  readonly disabled?: boolean;
}

/**
 * Actual microphone recording controls on iOS/Android/Web via Expo Audio.
 * Visible peaks are sampled input *level history*, not decoded file samples.
 * The underlying recorder produces a genuine .m4a / WebM media file.
 */
export function NativeRecordingTrack({
  store, onSaved, testID, disabled = false,
}: NativeRecordingTrackProps) {
  const phase = useStore(store, (s) => s.phase);
  const levelHistory = useStore(store, (s) => s.levelHistory);
  const controller = useForgeAudioRecorder(store);
  const isRecording = phase.kind === "recording";
  const canSave = isRecording || phase.kind === "interrupted";
  const pending = phase.kind === "requesting-permission" ||
    phase.kind === "preparing" || phase.kind === "stopping";
  const durationMs =
    phase.kind === "recording" || phase.kind === "stopping" ||
    phase.kind === "interrupted" ||
    phase.kind === "saved" ? phase.durationMs : 0;

  const act = () => {
    if (disabled || pending) return;
    if (canSave) {
      void controller.stop()
        .then((uri) => onSaved?.(uri))
        .catch(() => undefined); // Controller displays the error state.
    } else {
      void controller.start().catch(() => undefined);
    }
  };

  const statusText = phase.kind === "permission-denied"
    ? "Microphone permission denied"
    : phase.kind === "error" || phase.kind === "interrupted"
      ? phase.message
      : phase.kind === "saved"
        ? "Saved recording: " + phase.uri
        : phase.kind === "recording"
          ? "Recording microphone"
          : phase.kind === "preparing"
            ? "Preparing microphone"
            : phase.kind === "requesting-permission"
              ? "Requesting microphone permission"
              : phase.kind === "stopping"
                ? "Finalizing recording"
                : "Microphone ready";

  return (
    <View testID={testID} style={{ width: "100%", gap: 12 }}>
      <Host style={{ width: "100%" }}>
        <Column spacing={8}>
          <Text>{statusText}</Text>
          <Text>{`Elapsed: ${(durationMs / 1000).toFixed(1)} seconds`}</Text>
          <Button
            label={isRecording
              ? "Stop and save recording"
              : phase.kind === "interrupted"
                ? "Save interrupted recording"
                : "Start microphone recording"}
            disabled={disabled || pending}
            onPress={act}
            {...(testID ? { testID: testID + "-action" } : {})}
          />
        </Column>
      </Host>
      <WaveformLane
        peaks={levelHistory}
        height={64}
        columns={64}
        {...(testID ? { testID: testID + "-meter-history" } : {})}
      />
    </View>
  );
}
