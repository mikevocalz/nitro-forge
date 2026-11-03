import { Stack } from "expo-router";
import { StudioUIProvider } from "@nitro-forge/studio-workspace/ui";
import { studioControls } from "@acme/ui/studio-controls";

export default function RootLayout() {
  return (
    <StudioUIProvider components={studioControls}><Stack>
      <Stack.Screen name="index" options={{ title: "Nitro-Forge" }} />
      <Stack.Screen name="editor/[product]" options={{ title: "Editor" }} />
    </Stack></StudioUIProvider>
  );
}
