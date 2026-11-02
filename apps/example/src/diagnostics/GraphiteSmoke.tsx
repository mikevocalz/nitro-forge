/**
 * Development-only Skia v3 Graphite smoke scene.
 *
 * This renders known geometry without pretending the Ignition Rust engine is
 * already connected. Fixed colors are deliberate pixel-test fixture values,
 * not app theme tokens or a user-facing visual design.
 */
import { Canvas, Circle, Rect } from "react-native-skia";
import { Text, View } from "react-native";

export function GraphiteSmoke() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
      <Text accessibilityRole="header">Graphite v3 smoke scene</Text>
      <Text>Expected: a dark square, a cyan rectangle and an orange circle.</Text>
      <Canvas
        testID="nitroforge-graphite-v3-canvas"
        style={{ width: 256, height: 256 }}
      >
        <Rect x={0} y={0} width={256} height={256} color="#121923" />
        <Rect x={24} y={24} width={112} height={72} color="#21d4dd" />
        <Circle cx={177} cy={168} r={52} color="#ff9c43" />
      </Canvas>
      <Text>Verify on actual Metal/Vulkan devices and web CanvasKit separately.</Text>
    </View>
  );
}
