import { ScrollView, Text, View } from "react-native";
import { useStore } from "zustand";
import {
  createRecordingStore,
  NativeRecordingTrack,
} from "@nitro-forge/audio-ui";

/** Single track owner; one vanilla Zustand store, never React useState. */
const track = createRecordingStore();

export default function App() {
  const phase = useStore(track, (s) => s.phase);
  return (
    <ScrollView
      style={{ backgroundColor: "#101018", flex: 1 }}
      contentContainerStyle={{ minHeight: 560, padding: 22, gap: 20 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", color: "#FFFFFF" }}>
        Nitro Forge · Native Audio Lab
      </Text>
      <Text style={{ fontSize: 15, color: "#CBCBE1" }}>
        SDK 58 microphone recording + real level meter · iOS, Android and web
      </Text>
      <NativeRecordingTrack
        store={track}
        title="Microphone"
        testID="forge-recording-track"
        onSaved={(uri) => {
          // Studio host receives the real media URI. Rust must explicitly
          // confirm attachment before a clip is shown as saved in the project.
          console.info("Native recording completed:", uri);
        }}
      />
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, color: "#AAAAAA" }}>
          Phase: {phase.kind}
        </Text>
        <Text style={{ fontSize: 12, color: "#9999AF" }}>
          Important: metering history is not a decoded source PCM waveform.
          The app records a real audio file; edit-accurate waveform analysis
          and Rust project attachment remain separate work.
        </Text>
      </View>
    </ScrollView>
  );
}
