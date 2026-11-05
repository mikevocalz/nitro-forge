import { useLocalSearchParams, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Button, Text, View } from '@nitro-forge/studio-workspace/ui';
import { prismThemes, workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import { forgeDirections } from '@nitro-forge/studio-workspace/directions';
import { findPersonaSession } from '../src/persona/persona-session';
import { PersonaTurretHost } from '../src/persona/persona-turret-host';

/** Phone host for the persona turret: a native formSheet
 * (UISheetPresentationController on iOS, the screens bottom sheet on Android). */
export default function PersonaSheet() {
  const { session: key } = useLocalSearchParams<{ session?: string }>();
  const router = useRouter();
  const session = findPersonaSession(key);
  // Opened by a link there is nothing to go back to; Close then goes home.
  const close = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  // Sheet content is presented outside the root view's gesture tree on Android.
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: forgeDirections.workbench.materials.dark.panelSolid }}>
    {session
      ? <PersonaTurretHost session={session} presentation="sheet" onClose={close}
        onCompose={() => router.replace({ pathname: '/persona-composer', params: { session: key } })} />
      : <View style={{ padding: scale.space.group, gap: scale.space.element }}>
        <Text accessibilityRole="alert" style={{ color: prismThemes.dark.text, fontSize: scale.type.body }}>No design document is open.</Text>
        <Button title="Close" onPress={close} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" />
      </View>}
  </GestureHandlerRootView>;
}
