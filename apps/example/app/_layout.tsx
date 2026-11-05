import "../global.css";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StudioUIProvider } from "@nitro-forge/studio-workspace/ui";
import { studioControls } from "@acme/ui/studio-controls";
import { ScopedVariables } from "uniwind";
import type { StudioTokenScopeProps, StudioUIComponents } from "@nitro-forge/studio-workspace/ui";

// NYC-Tron parts read semantic variables; Uniwind scopes them to one subtree on native.
const TokenScope = ({ variables, children }: StudioTokenScopeProps) => <ScopedVariables variables={variables}>{children}</ScopedVariables>;
const components: StudioUIComponents = { ...studioControls, TokenScope };

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StudioUIProvider components={components}>
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
