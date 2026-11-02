import { useEffect, useMemo } from "react";
import { SafeAreaView, Text, View } from "react-native";
import { compileQuickDrawScene } from "@nitro-forge/board-skia";
import { NativeBoardCanvasWithInput } from "@nitro-forge/board-skia/native";
import { createNativeBoardPointerRouter } from "@nitro-forge/board-skia";

const empty = compileQuickDrawScene({
  document: { store: {
    "demo-ink": {
      id: "demo-ink", typeName: "shape", type: "draw",
      x: 18, y: 18, rot: 0, z: 0,
      props: {
        color: "blue", size: "m", dash: "draw", done: true,
        pts: [0, 0, 0.2, 25, 15, 0.6, 60, 0, 0.7],
      },
      inkOutline: [0, 0, 25, 15, 60, 0, 25, -5],
    },
  } },
});
export default function App() {
  const pointer = useMemo(() => createNativeBoardPointerRouter({
    surfaceWidth: 320, surfaceHeight: 200,
    boardWidth: 320, boardHeight: 200,
    // Native renderer here only reads the store. The consumer app is
    // responsible for sending these to its one QuickDraw session.
    onPointer: () => {},
  }), []);
  useEffect(() => () => pointer.dispose(), [pointer]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F0F2F5" }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Text style={{ fontSize: 20 }}>Nitro-Forge Graphite Native Board Lab</Text>
        <NativeBoardCanvasWithInput
          pointer={pointer}
          scene={empty}
          width={320}
          height={200}
          boardWidth={320}
          boardHeight={200}
          fallback={<Text>Graphite unavailable on this device</Text>}
        />
      </View>
    </SafeAreaView>
  );
}
