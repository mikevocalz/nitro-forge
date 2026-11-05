import { ScrollView, Text, View } from "react-native";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { NativeSeekBar } from "@nyc-tron/ui/components/forge/NativeSeekBar";
import { WaveformLane } from "@nyc-tron/ui/components/forge/WaveformLane";
import { FRAME_RATES } from "@nyc-tron/ui/components/forge/timebase";
import type { WaveformPeak } from "@nyc-tron/ui/components/forge/waveform";
import { LevelFader } from "@nyc-tron/ui/components/forge/audio/LevelFader";

interface DemoState { frame: number; gain: number }
const store = createStore<DemoState>(() => ({ frame: 1800, gain: 0.72 }));
/** Synthetic static fixture: NOT a microphone, decoding, or playback claim. */
const syntheticPeakFixture: WaveformPeak[] = Array.from({length: 160}, (_, i) => {
  const magnitude = Math.abs(Math.sin(i * 0.19) * Math.cos(i * 0.032)) * 0.85;
  return { min: -magnitude, max: magnitude * 0.91 };
});
export default function App() {
  const frame = useStore(store, (s) => s.frame);
  const gain = useStore(store, (s) => s.gain);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#101018" }}
      contentContainerStyle={{ padding: 22, gap: 20, minHeight: 500 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", color: "white" }}>
        Forge media controls · SDK 58
      </Text>
      <Text style={{ color: "#CBCBDE" }}>
        Universal SwiftUI / Compose / web transport and responsive waveform
      </Text>
      <NativeSeekBar frame={frame} durationFrames={18000}
        frameRate={FRAME_RATES.NTSC_2997} dropFrameTimecode
        testID="forge-seekbar"
        onSeek={(next) => store.setState({ frame: next })} />
      <View style={{ gap: 8 }}>
        <Text style={{ color: "white" }}>Waveform display fixture (not live audio)</Text>
        <WaveformLane
          peaks={syntheticPeakFixture}
          position={frame / 18000}
          height={74} columns={96} testID="forge-waveform"
          onSeekNormalized={(p) => store.setState({ frame: Math.round(p * 18000) })}
        />
      </View>
      <LevelFader value={gain} label="Gain" orientation="horizontal" testID="forge-level"
        onCommit={(next) => store.setState({ gain: next })} />
      <Text style={{ color: "#9999AF", fontSize: 12 }}>
        This test surface demonstrates control state only. No actual video decoding,
        microphone recording, or Rust timeline mutation is attached.
      </Text>
    </ScrollView>
  );
}
