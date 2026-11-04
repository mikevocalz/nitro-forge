import { ScrollView, Text, View } from "react-native";
import { NativeVideoMonitor, createVideoMonitorStore } from "@nitro-forge/media-ui/video";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import {
  FRAME_RATES,
  NativeLevelSlider,
  NativeSeekBar,
  WaveformLane,
  type WaveformPeak,
} from "@nitro-forge/media-ui";

interface DemoState { frame: number; gain: number }
const store = createStore<DemoState>(() => ({ frame: 1800, gain: 0.72 }));
const nativeVideoStore = createVideoMonitorStore();
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
          height={74} columns={96} testID="forge-waveform"
          onSeekNormalized={(p) => store.setState({ frame: Math.round(p * 18000) })}
        />
      </View>
      <NativeLevelSlider value={gain} testID="forge-level"
        onValueChange={(next) => store.setState({ gain: next })} />
      <View style={{ gap: 8 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 19, fontWeight: "700" }}>
          Native decoded video monitor
        </Text>
        <Text style={{ color: "#CBCBDE", fontSize: 12 }}>
          Online reference fixture from official Expo Video docs; requires network access
        </Text>
        <NativeVideoMonitor
          source="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
          store={nativeVideoStore}
          frameRate={FRAME_RATES.NTSC_2997}
          height={218}
          testID="forge-native-video-monitor"
        />
      </View>
      <Text style={{ color: "#9999AF", fontSize: 12 }}>
        The top transport and waveform are isolated fixtures. The native video monitor
        below uses real decoded media and seeks; no microphone recording or Rust
        timeline mutation is attached.
      </Text>
    </ScrollView>
  );
}
