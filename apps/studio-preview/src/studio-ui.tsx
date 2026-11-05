// The Studio UI for the browser preview. NYC-Tron UI styles React Native
// primitives with `className`, which React Native Web drops, so the
// primitives come from the className binding (src/react-native-classname.tsx)
// that vite.config.ts also routes NYC-Tron's own `react-native` imports to.
// One React Native Web copy: the binding re-exports the rest of RNW (Image).
import { Image, Pressable, ScrollView, Text, TextInput, View } from './react-native-classname';
import { Select } from '@nyc-tron/expo-controls/Select';
import { NativeActionMenu } from '@nyc-tron/expo-controls/NativeActionMenu';
import { nycTronStudioUI } from '@nitro-forge/studio-workspace/nyc-tron-host';
import type { StudioUIComponents } from '@nitro-forge/studio-workspace/ui';

type Parts = Parameters<typeof nycTronStudioUI>[0];

/** Web has no TokenScope: ui.tsx scopes variables on a `display: contents` view. */
export const studioUI: StudioUIComponents = nycTronStudioUI({
  View: View as unknown as Parts['View'],
  Text: Text as unknown as Parts['Text'],
  Pressable: Pressable as unknown as Parts['Pressable'],
  ScrollView: ScrollView as unknown as Parts['ScrollView'],
  TextInput: TextInput as unknown as Parts['TextInput'],
  Image: Image as unknown as Parts['Image'],
  Select, ActionMenu: NativeActionMenu,
});
