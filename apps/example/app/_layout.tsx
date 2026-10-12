import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Nitro-Forge" }} />
      <Stack.Screen name="editor/[product]" options={{ title: "Editor" }} />
    </Stack>
  );
}
