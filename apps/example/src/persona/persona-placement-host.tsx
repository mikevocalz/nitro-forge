import { useEffect, useRef } from 'react';
import { I18nManager, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { useReservedRegions } from '@acme/ui/adaptive-panes';
import { Button, View } from '@nitro-forge/studio-workspace/ui';
import { TURRET_SIZE } from '@nitro-forge/studio-workspace/turret';
import { prismThemes, workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import { acquirePersonaSession, releasePersonaSession, type PersonaSession } from './persona-session';
import { planPersonaPlacement, type PersonaPlacement } from './persona-dock';
import { PersonaTurretHost } from './persona-turret-host';

const PANEL = { width: TURRET_SIZE + 48, height: 380 };
const colors = prismThemes.dark;

/** Holds the document's persona session for the life of the editor. */
export function usePersonaSession(key: string): PersonaSession {
  const ref = useRef<{ key: string; session: PersonaSession } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, session: acquirePersonaSession(key) };
  useEffect(() => () => releasePersonaSession(key), [key]);
  return ref.current.session;
}

/** Where the panel goes on this window, from real fold geometry. */
export function usePersonaPlacement(): PersonaPlacement {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const regions = useReservedRegions();
  return planPersonaPlacement({ window, regions, insets, panel: PANEL, direction: I18nManager.isRTL ? 'rtl' : 'ltr' });
}

/** Header trigger: phones present the formSheet route, two-pane foldables
 * open the docked panel. Regular-width windows keep PrismEditor's own panel. */
export function PersonaTrigger({ sessionKey, session, placement }: { sessionKey: string; session: PersonaSession; placement: PersonaPlacement }) {
  const router = useRouter();
  const label = useStore(session.personas, s => s.personas.find(p => p.id === s.activeId)?.label ?? 'Persona');
  if (placement.mode === 'inline') return null;
  return <Button title={label} aria-label={`Persona: ${label}`} accessibilityHint="Switch between Vector, Pixel, Layout and Sketch"
    onPress={() => {
      if (placement.mode === 'sheet') router.push({ pathname: '/personas', params: { session: sessionKey } });
      else session.ui.setState({ open: true });
    }}
    variant="ghost" tone="carolina" size="sm" cornerRadius={4} className="rounded-[4px]" />;
}

/** The pane-docked panel. Closes when the posture stops offering a dock, so
 * it never stays behind a hinge or across panes after a fold change. */
export function PersonaDock({ session, placement }: { session: PersonaSession; placement: PersonaPlacement }) {
  const open = useStore(session.ui, s => s.open);
  const docked = placement.mode === 'dock';
  useEffect(() => { if (!docked && session.ui.getState().open) session.ui.setState({ open: false, peeking: false }); }, [docked, session]);
  if (!open || placement.mode !== 'dock') return null;
  const { rect } = placement;
  return <View testID="persona-dock" pointerEvents="box-none" style={{
    position: 'absolute', zIndex: 80, left: rect.x, top: rect.y, width: rect.width, maxHeight: rect.height,
    borderWidth: 1, borderColor: colors.line, borderRadius: scale.radius.panel, backgroundColor: colors.base, overflow: 'hidden',
    boxShadow: '0 8px 24px #00000033',
  }}>
    <PersonaTurretHost session={session} presentation="dock" onClose={() => session.ui.setState({ open: false, peeking: false })} />
  </View>;
}
