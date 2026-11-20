import { useMemo } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View as RNView, useColorScheme } from 'react-native';
import { ScopedVariables } from 'uniwind';
import { Select } from '@nyc-tron/expo-controls/Select';
import { NativePopover } from '@nyc-tron/expo-controls/NativePopover';
import { NativeActionMenu } from '@nyc-tron/expo-controls/NativeActionMenu';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { ForgeDocumentStage } from '@nitro-forge/studio-workspace';
import { nycTronStudioUI } from '@nitro-forge/studio-workspace/nyc-tron-host';
import { workspaceThemes } from '@nitro-forge/studio-workspace/theme';
import { nycTronTokensFor } from '@nitro-forge/studio-workspace/directions';
import {
  StudioUIProvider, TokenScope, Toolbar, IconButton, View,
  type StudioTokenScopeProps, type StudioUIComponents,
} from '@nitro-forge/studio-workspace/ui';

// The one brand input. It is a value you supply, so it is the only literal colour here.
// Both are placeholders: check on-accent against accent for WCAG contrast yourself.
const STUDIO_BRAND = { accent: '#0B7A75', onAccent: '#FFFFFF' } as const;

// Uniwind scopes NYC-Tron's semantic variables to one subtree (same binding as apps/example/src/studio-ui.tsx).
const HostTokenScope = ({ variables, children }: StudioTokenScopeProps) =>
  <ScopedVariables variables={variables}>{children}</ScopedVariables>;

const studioUI = nycTronStudioUI({
  View: RNView, Text, Pressable, Image, Select, ActionMenu: NativeActionMenu, NativePopover, GroupedSelect: Select,
  TokenScope: HostTokenScope,
  ScrollView: ScrollView as unknown as StudioUIComponents['ScrollView'],
  TextInput: TextInput as unknown as StudioUIComponents['TextInput'],
});

export type StudioScreenProps = {
  /** Engine document state (for example DocumentHandle state). null renders the stage's "Opening document" state. */
  state?: unknown;
  title?: string;
  onNew?: () => void;
};

function Screen({ state = null, title = 'Studio', onNew }: StudioScreenProps) {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  // Brand override: take the library's own palette for this scheme, swap accent/ink,
  // and let the library turn it into --color-primary / --color-accent / --color-focus / --color-on-primary.
  const brandTokens = useMemo(() => nycTronTokensFor({
    ...workspaceThemes[scheme], accent: STUDIO_BRAND.accent, ink: STUDIO_BRAND.onAccent,
  }), [scheme]);

  return (
    <TokenScope variables={brandTokens}>
      <View className="flex-1 bg-surface-sunken">
        <Toolbar
          title={title}
          density="compact"
          actions={
            <IconButton
              aria-label="New document"
              variant="primary"
              size="md"
              icon={<ForgeIcon name="plus" size={18} color={STUDIO_BRAND.onAccent} />}
              {...(onNew ? { onPress: onNew } : {})}
            />
          }
        />
        <View className="flex-1">
          <ForgeDocumentStage studioId="quill" state={state} theme={scheme} />
        </View>
      </View>
    </TokenScope>
  );
}

export default function StudioScreen(props: StudioScreenProps) {
  return <StudioUIProvider components={studioUI}><Screen {...props} /></StudioUIProvider>;
}
