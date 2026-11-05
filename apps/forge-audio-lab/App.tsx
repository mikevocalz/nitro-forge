import { ScrollView, Text, View } from "react-native";
import { useStore } from "zustand";
import {
  createRecordingStore,
} from "@nitro-forge/audio-ui";
import { NativeAudioPreview } from "@nitro-forge/audio-ui/playback";
import { NativeSourceRecordingTrack } from "@nitro-forge/audio-ui/pcm";

/** Single track owner; one vanilla Zustand store, never React useState. */
const track = createRecordingStore();

export default function App() {
  const phase = useStore(track, (s) => s.phase);
  const peaks = useStore(track, (s) => s.levelHistory);
  return (
    <ScrollView
      style={{ backgroundColor: "#101018", flex: 1 }}
      contentContainerStyle={{ minHeight: 560, padding: 22, gap: 20 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", color: "#FFFFFF" }}>
        Nitro Forge · Native Audio Lab
      </Text>
      <Text style={{ fontSize: 15, color: "#CBCBE1" }}>
        Audio API 1.0 PCM WAV capture and native audio graph playback; compressed recording with decoded peaks where supported on web
      </Text>
      <NativeSourceRecordingTrack
        store={track}
        title="Microphone"
        testID="forge-recording-track"
        onSaved={(result) => {
          // Studio host receives the real media URI. Rust must explicitly
          // confirm attachment before a clip is shown as saved in the project.
          console.info("Native recording completed:", result.uri, result.kind, result.peaks.length);
        }}
      />
      <NativeAudioPreview uri={phase.kind === "saved" ? phase.uri : null}
        durationSeconds={phase.kind === "saved" ? phase.durationMs / 1000 : 0}
        {...(phase.kind === "saved" ? { peaks } : {})}
        testID="forge-audio-preview"
        // A paused take still owns the audio session, so preview waits for save.
        disabled={["recording", "interrupted", "preparing", "requesting-permission", "stopping"].includes(phase.kind)} />
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, color: "#AAAAAA" }}>
          Phase: {phase.kind}
        </Text>
        <Text style={{ fontSize: 12, color: "#9999AF" }}>
          This recording UI now uses actual PCM peak extrema on iOS/Android.
          Web records compressed media and decodes when supported. A Rust clip
          is not created until its host confirms the saved source.
        </Text>
      </View>
    </ScrollView>
  );
}
