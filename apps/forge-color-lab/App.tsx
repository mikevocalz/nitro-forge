import { ScrollView, Text } from "react-native";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { ColorChannels } from "@nyc-tron/ui/components/forge/ColorChannels";
import type { RgbaColor } from "@nyc-tron/ui/components/forge/color";

interface DemoState { color: RgbaColor }
const store = createStore<DemoState>(() => ({
  color: { r: 116, g: 66, b: 219, alpha: 1 },
}));
export default function App() {
  const color = useStore(store, (s) => s.color);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#101018" }}
      contentContainerStyle={{ padding: 22, gap: 20, minHeight: 500 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", color: "white" }}>
        Forge color controls · SDK 58
      </Text>
      <Text style={{ color: "#CBCBDE" }}>
        Universal SwiftUI / Compose / web display-color editor
      </Text>
      <ColorChannels
        value={color}
        testID="forge-color-channels"
        onValueChange={(next) => store.setState({ color: next })}
      />
      <Text style={{ color: "#9999AF", fontSize: 12 }}>
        This demonstration edits an sRGB preview value only. The Rust document's
        ICC/CMYK/HDR/spot color and undo integrations are still pending.
      </Text>
    </ScrollView>
  );
}
