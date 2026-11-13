import "../global.css";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StudioUIProvider } from "@nitro-forge/studio-workspace/ui";
import { studioUI } from "../src/studio-ui";
import { surfaces } from "../src/brand";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StudioUIProvider components={studioUI}>
        <Stack>
          <Stack.Screen name="index" options={{ title: surfaces.homeTitle }} />
          <Stack.Screen name="about" options={{ presentation: "modal", title: surfaces.about.title }} />
          <Stack.Screen name="editor/[product]" options={{ title: "Editor" }} />
          <Stack.Screen name="personas" options={{ presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 4, headerShown: false, title: "Persona" }} />
          <Stack.Screen name="persona-composer" options={{ presentation: "modal", title: "New persona" }} />
        </Stack>
      </StudioUIProvider>
    </GestureHandlerRootView>
  );
}
