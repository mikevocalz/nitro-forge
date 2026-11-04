import { useEffect, useRef } from 'react';
import { I18nManager, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { useReservedRegions } from '@acme/ui/adaptive-panes';
import { View } from '@nitro-forge/studio-workspace/ui';
import { TURRET_SIZE } from '@nitro-forge/studio-workspace/turret';
import { workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import { forgeDirections } from '@nitro-forge/studio-workspace/directions';
import { acquirePersonaSession, releasePersonaSession, type PersonaSession } from './persona-session';
import { planPersonaPlacement, type PersonaPlacement } from './persona-dock';
import { PersonaTurretHost } from './persona-turret-host';

const PANEL = { width: TURRET_SIZE + 48, height: 380 };
const workbench = forgeDirections.workbench;

/** Holds the document's persona session for the life of the editor. */
export function usePersonaSession(key: string): PersonaSession {
  const ref = useRef<{ key: string; session: PersonaSession } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, session: acquirePersonaSession(key) };
  useEffect(() => () => releasePersonaSession(key), [key]);
  return ref.current.session;
}

/** Where the panel goes on this window, from real fold geometry. On Android
 * a WindowManager folding feature (a `division` region) makes the window an
 * `android-foldable` surface for the persona manifests. */
export function usePersonaPlacement(session?: PersonaSession): PersonaPlacement {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const regions = useReservedRegions();
  const folding = Platform.OS === 'android' && regions.some(r => r.kind === 'division');
  useEffect(() => {
    if (Platform.OS === 'android') session?.personas.getState().setSurface(folding ? 'android-foldable' : 'android-phone');
  }, [folding, session]);
  return planPersonaPlacement({ window, regions, insets, panel: PANEL, direction: I18nManager.isRTL ? 'rtl' : 'ltr' });
}

/** The pane-docked panel. Closes when the posture stops offering a dock, so
 * it never stays behind a hinge or across panes after a fold change. */
export function PersonaDock({ session, sessionKey, placement }: { session: PersonaSession; sessionKey: string; placement: PersonaPlacement }) {
  const router = useRouter();
  const open = useStore(session.ui, s => s.open);
  const docked = placement.mode === 'dock';
  useEffect(() => { if (!docked && session.ui.getState().open) session.ui.setState({ open: false, peeking: false }); }, [docked, session]);
  if (!open || placement.mode !== 'dock') return null;
  const { rect } = placement;
  return <View testID="persona-dock" pointerEvents="box-none" style={{
    position: 'absolute', zIndex: 80, left: rect.x, top: rect.y, width: rect.width, maxHeight: rect.height,
    borderWidth: 1, borderColor: workbench.materials.dark.panelEdge, borderRadius: scale.radius.panel, backgroundColor: workbench.materials.dark.panelSolid, overflow: 'hidden',
    boxShadow: workbench.depth.dark.panel,
  }}>
    <PersonaTurretHost session={session} presentation="dock" onClose={() => session.ui.setState({ open: false, peeking: false })}
      onCompose={() => { session.ui.setState({ open: false, peeking: false }); router.push({ pathname: '/persona-composer', params: { session: sessionKey } }); }} />
  </View>;
}
