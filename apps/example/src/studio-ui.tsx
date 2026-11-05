import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ScopedVariables } from 'uniwind';
import { Select } from '@nyc-tron/expo-controls/Select';
import { NativePopover } from '@nyc-tron/expo-controls/NativePopover';
import { NativeActionMenu } from '@nyc-tron/expo-controls/NativeActionMenu';
import { nycTronStudioUI } from '@nitro-forge/studio-workspace/nyc-tron-host';
import type { StudioTokenScopeProps, StudioUIComponents } from '@nitro-forge/studio-workspace/ui';

// NYC-Tron parts read semantic variables; Uniwind scopes them to one subtree.
const TokenScope = ({ variables, children }: StudioTokenScopeProps) => <ScopedVariables variables={variables}>{children}</ScopedVariables>;

/** The Studio UI for this Expo host. Uniwind maps `className` on the React
 * Native primitives, so they pass straight through. RN 0.88 types the
 * ScrollView and TextInput refs as instance interfaces where the Studio
 * contract names the classes; the runtime refs are the same objects. */
export const studioUI = nycTronStudioUI({
  View, Text, Pressable, Image, Select, ActionMenu: NativeActionMenu, NativePopover, GroupedSelect: Select, TokenScope,
  ScrollView: ScrollView as unknown as StudioUIComponents['ScrollView'],
  TextInput: TextInput as unknown as StudioUIComponents['TextInput'],
});
