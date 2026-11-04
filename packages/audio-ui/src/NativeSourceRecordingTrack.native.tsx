import { Button, Column, Host, Text } from "@expo/ui";
import { View } from "react-native";
import { useStore } from "zustand";
import { WaveformLane } from "@nitro-forge/media-ui";
import { useForgePcmRecorder } from "./useForgePcmRecorder";
import type { NativeSourceRecordingTrackProps } from "./sourceRecordingTypes";

/**
 * iOS/Android: actual 16-bit PCM buffers and a native-generated WAV file.
 * Displayed peaks are sampled from actual PCM; no synthesized bars.
 */
export function NativeSourceRecordingTrack({
  store, onSaved, disabled = false, testID,
}: NativeSourceRecordingTrackProps) {
  const phase = useStore(store, (s) => s.phase);
  const history = useStore(store, (s) => s.levelHistory);
  const { controller, stop } = useForgePcmRecorder(store);
  const active = phase.kind === "recording";
  const busy = ["requesting-permission", "preparing", "stopping"].includes(phase.kind);
  const duration = active || phase.kind === "stopping" || phase.kind === "saved"
    ? phase.durationMs : 0;
  const label = phase.kind === "error"
    ? phase.message : phase.kind === "permission-denied"
      ? "Microphone permission required"
      : phase.kind === "saved" ? "WAV saved: " + phase.uri
        : active ? "Recording PCM audio" : busy ? "Preparing native audio" : "Ready to record";

  const toggle = () => {
    if (disabled || busy) return;
    if (active) {
      void stop().then(onSaved).catch(() => undefined);
    } else {
      void controller.start().catch(() => undefined);
    }
  };

  return (
    <View style={{ width: "100%", gap: 10 }} {...(testID ? { testID } : {})}>
      <Host style={{ width: "100%" }}>
        <Column spacing={8}>
          <Text>{label}</Text>
          <Text>{`Elapsed: ${(duration / 1000).toFixed(1)}s`}</Text>
          <Button
            label={active ? "Stop and save WAV" : "Record PCM WAV"}
            disabled={disabled || busy}
            onPress={toggle}
            {...(testID ? { testID: testID + "-toggle" } : {})}
          />
        </Column>
      </Host>
      <WaveformLane
        peaks={history}
        height={72}
        columns={96}
        {...(testID ? { testID: testID + "-waveform" } : {})}
      />
    </View>
  );
}
