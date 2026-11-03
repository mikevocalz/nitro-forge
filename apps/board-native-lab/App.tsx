import { useEffect, useMemo } from "react";
import { Pressable, SafeAreaView, Text, View } from "react-native";
import { useStore } from "zustand";
import { compileNativeInkScene } from "@nitro-forge/board/ink";
import { NativeBoardCanvasWithInput } from "@nitro-forge/board/skia/native";
import { createNativeBoardPointerRouter } from "@nitro-forge/board/skia";
import { createInkLabSession, type InkLabTool } from "./InkLabSession";

const BOARD_WIDTH = 320;
const BOARD_HEIGHT = 200;
const tools: readonly InkLabTool[] = ["pen","highlighter","eraser"];

/** Native Skia v3 drawing smoke lab (no WebView or duplicate production doc). */
export default function App() {
  const session = useMemo(() => createInkLabSession(), []);
  const state = useStore(session.state);
  const pointer = useMemo(() => createNativeBoardPointerRouter({
    surfaceWidth: BOARD_WIDTH, surfaceHeight: BOARD_HEIGHT,
    boardWidth: BOARD_WIDTH, boardHeight: BOARD_HEIGHT,
    onPointer: session.onPointer,
    palmRejection: "after-pen",
  }), [session]);
  useEffect(() => () => {
    pointer.dispose();
    session.dispose();
  }, [pointer,session]);
  const scene = useMemo(() => compileNativeInkScene(
    state.draft ? [...state.strokes, state.draft] : state.strokes
  ), [state.strokes,state.draft]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F0F2F5" }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: "700" }}>Forge Board + Ink</Text>
        <Text style={{ color: "#526071", fontSize: 12 }}>
          Real native Android pen/touch input. Local smoke session only.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {tools.map((tool) => (
            <Pressable
              key={tool}
              accessibilityRole="button"
              accessibilityLabel={tool}
              accessibilityState={{ selected: state.tool === tool }}
              onPress={() => session.setTool(tool)}
              style={{
                minWidth: 68, minHeight: 44, paddingHorizontal: 8,
                alignItems: "center", justifyContent: "center",
                backgroundColor: state.tool === tool ? "#263344" : "#FFFFFF",
                borderRadius: 10,
              }}
            >
              <Text style={{ fontWeight: "700", color: state.tool === tool ? "#FFFFFF" : "#263344" }}>
                {tool.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
        <NativeBoardCanvasWithInput
          pointer={pointer}
          scene={scene}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          boardWidth={BOARD_WIDTH}
          boardHeight={BOARD_HEIGHT}
          fallback={<Text accessibilityRole="alert">Graphite unavailable on this device</Text>}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo"
            accessibilityState={{ disabled: state.undoCount === 0 }}
            disabled={state.undoCount === 0}
            onPress={session.undo}
            style={{ padding: 12, backgroundColor: "#FFFFFF", borderRadius: 8 }}
          ><Text>Undo</Text></Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Redo"
            accessibilityState={{ disabled: state.redoCount === 0 }}
            disabled={state.redoCount === 0}
            onPress={session.redo}
            style={{ padding: 12, backgroundColor: "#FFFFFF", borderRadius: 8 }}
          ><Text>Redo</Text></Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear canvas"
            onPress={session.clear}
            style={{ padding: 12, backgroundColor: "#FFFFFF", borderRadius: 8 }}
          ><Text>Clear</Text></Pressable>
        </View>
        <Text style={{ fontSize: 12, color: "#526071" }}>
          Strokes: {state.strokes.length} · tool: {state.tool}
        </Text>
      </View>
    </SafeAreaView>
  );
}
