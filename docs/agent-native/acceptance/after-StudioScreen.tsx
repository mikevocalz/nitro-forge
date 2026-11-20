// Place at src/screens/StudioScreen.tsx in the app. '@/' maps to ./src/* (tsconfig paths).
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Select } from '@nyc-tron/expo-controls/Select';
import { NativePopover } from '@nyc-tron/expo-controls/NativePopover';
import { NativeActionMenu } from '@nyc-tron/expo-controls/NativeActionMenu';
import { StudioUIProvider, TokenScope, Toolbar } from '@/components/forge/ui';
import { nycTronStudioUI } from '@/components/forge/nyc-tron-host';
import { ForgeIconButton } from '@/components/forge/icons/ForgeIcon';
import { ForgeDocumentStage } from '@/components/forge/stage';
import { brandCssVariables, brandThemeOverrides, brandThemeProblems } from '@/components/forge/brand-theme';
import brandTheme from '@/components/forge/brand.theme.json';

// Host wiring, copied from the nyc-tron-host doc example (app code, not installable by shadcn).
const studioUI = nycTronStudioUI({
  View, Text, Pressable, Image, Select, ActionMenu: NativeActionMenu, NativePopover, GroupedSelect: Select,
  ScrollView: ScrollView as never, TextInput: TextInput as never,
});

const scheme = 'dark' as const;
if (brandThemeProblems(brandTheme).length > 0) throw new Error('brand.theme.json breaks the rebrand contract');
const brandVariables = brandCssVariables(brandTheme, scheme); // channel 1: NYC-Tron controls
const brandColors = brandThemeOverrides(brandTheme, scheme); // channel 2: JS colours

export default function StudioScreen() {
  return (
    <StudioUIProvider components={studioUI}>
      <TokenScope variables={brandVariables}>
        <View className="flex-1 bg-surface-sunken">
          <Toolbar
            title="Studio"
            actions={<ForgeIconButton name="save" label="Save" color={brandColors.accent} onPress={() => {}} />}
          />
          <View className="flex-1">
            <ForgeDocumentStage studioId="quill" state={null} theme={scheme} />
          </View>
        </View>
      </TokenScope>
    </StudioUIProvider>
  );
}
