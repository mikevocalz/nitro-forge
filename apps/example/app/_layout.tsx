import "../global.css";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StudioUIProvider } from "@nitro-forge/studio-workspace/ui";
import { studioControls } from "@acme/ui/studio-controls";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StudioUIProvider components={studioControls}>
        <Stack>
          <Stack.Screen name="index" options={{ title: "Nitro-Forge" }} />
          <Stack.Screen name="editor/[product]" options={{ title: "Editor" }} />
          <Stack.Screen name="personas" options={{ presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 4, headerShown: false, title: "Persona" }} />
          <Stack.Screen name="persona-composer" options={{ presentation: "modal", title: "New persona" }} />
        </Stack>
      </StudioUIProvider>
    </GestureHandlerRootView>
  );
}
