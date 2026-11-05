import { ScrollView, Text } from "react-native";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { HsvPicker } from "@nyc-tron/ui/components/forge/color/HsvPicker";
import { rgbToHsv, type HsvColor } from "@nyc-tron/ui/components/forge/color";

interface DemoState {
  hsv: HsvColor;
  lastCommitted: string;
}
const store = createStore<DemoState>(() => ({
  hsv: rgbToHsv({ r: 116, g: 66, b: 219, alpha: 1 }),
  lastCommitted: "Not committed",
}));

export default function App() {
  const hsv = useStore(store, (s) => s.hsv);
  const lastCommitted = useStore(store, (s) => s.lastCommitted);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#101018" }}
      contentContainerStyle={{ padding: 22, gap: 20, minHeight: 700 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", color: "white" }}>
        Nitro Forge native color editor · SDK 58
      </Text>
      <Text style={{ color: "#CBCBDE" }}>
        Saturation/value field, native hue slider and RGBA channels.
        Interactive on iOS, Android and the web.
      </Text>
      <HsvPicker
        value={hsv}
        testID="forge-hsv-picker"
        onValueChange={(next) => store.setState({ hsv: next })}
        onApply={(color) => store.setState({
          lastCommitted: `Applied HSV: ${color.h.toFixed(0)}°, ${color.s.toFixed(2)}, ${color.v.toFixed(2)}`,
        })}
        onCancel={() => store.setState({
          hsv: rgbToHsv({ r: 116, g: 66, b: 219, alpha: 1 }),
          lastCommitted: "Cancelled",
        })}
      />
      <Text style={{ color: "#FFFFFF" }}>{lastCommitted}</Text>
      <Text style={{ color: "#9999AF", fontSize: 12 }}>
        Live previews are display-space sRGB. The editor's actual ICC/CMYK/HDR
        and spot-color values remain the responsibility of the Rust engine.
      </Text>
    </ScrollView>
  );
}
