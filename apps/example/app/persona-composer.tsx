import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Share, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Button, Text, View } from '@nitro-forge/studio-workspace/ui';
import { PersonaComposer } from '@nitro-forge/studio-workspace/composer';
import { prismThemes, workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import { findPersonaSession } from '../src/persona/persona-session';

/** Native Persona Composer for the open design document. Export goes through
 * the platform share sheet; a dismissed sheet is reported, not counted as shared. */
export default function PersonaComposerScreen() {
  const { session: key } = useLocalSearchParams<{ session?: string }>();
  const router = useRouter();
  const theme = useColorScheme() === 'light' ? 'light' : 'dark';
  const colors = prismThemes[theme];
  const session = findPersonaSession(key);
  // Opened by a link there is nothing to go back to; Close then goes home.
  const close = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  if (!session) return <View style={{ flex: 1, padding: scale.space.group, gap: scale.space.element, backgroundColor: colors.base }}>
    <Text accessibilityRole="alert" style={{ color: colors.text, fontSize: scale.type.body }}>No design document is open.</Text>
    <Button title="Close" onPress={close} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" />
  </View>;
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.base }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: scale.space.group, gap: scale.space.group }}>
      <PersonaComposer store={session.personas} theme={theme} colors={colors}
        onExportPersona={async (json, persona) => {
          const result = await Share.share({ title: `${persona.label} persona`, message: json });
          if (result.action !== Share.sharedAction) throw new Error('Share sheet closed without sharing');
          return 'shared';
        }} />
    </ScrollView>
  </GestureHandlerRootView>;
}
