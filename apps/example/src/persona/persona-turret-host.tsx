import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useStore } from 'zustand';
import { Button, IconButton, ScrollView, Text, View } from '@nitro-forge/studio-workspace/ui';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { PersonaTurret, type PersonaTurretHandle } from '@nitro-forge/studio-workspace/turret';
import { prismThemes, workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import { forgeDirections, forgeFeedbackMotion } from '@nitro-forge/studio-workspace/directions';
import type { PersonaSession } from './persona-session';
import { playTurretHaptic } from './turret-haptics-driver';
import type { TurretEffect } from './turret-haptics';

const colors = prismThemes.dark;
/** Workbench chrome: the graphite panel the turret is milled for. */
const material = forgeDirections.workbench.materials.dark;

export type PersonaTurretHostProps = {
  session: PersonaSession;
  /** `sheet`: a formSheet route, Back with no peek pops it through the navigator.
   * `dock`: a pane-docked panel, Back with no peek closes it here. */
  presentation: 'sheet' | 'dock';
  onClose: () => void;
  /** Opens the Persona Composer for this document. */
  onCompose?: () => void;
};

/**
 * The turret inside a native host. Android Back (predictive or button, both
 * reach BackHandler through ReactActivity's OnBackPressedCallback in RN 0.88)
 * first cancels an open peek, then closes the panel.
 */
export function PersonaTurretHost({ session, presentation, onClose, onCompose }: PersonaTurretHostProps) {
  const persona = useStore(session.personas, s => s);
  const turret = useRef<PersonaTurretHandle>(null);
  const latest = useRef({ onClose, presentation }); latest.current = { onClose, presentation };
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closing.current) clearTimeout(closing.current); }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const ui = session.ui.getState();
      if (ui.peeking) {
        turret.current?.cancel();
        return true;
      }
      if (latest.current.presentation === 'dock') { latest.current.onClose(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [session]);

  const onEffect = (effect: TurretEffect) => {
    if (effect === 'detent') session.ui.setState({ peeking: true });
    else if (effect === 'commit' || effect === 'cancel') session.ui.setState({ peeking: false });
    playTurretHaptic(effect);
  };

  return (
    <ScrollView testID={`persona-${presentation}`} style={{ backgroundColor: material.panelSolid }}
      contentContainerStyle={{ alignItems: 'center', gap: scale.space.element, paddingHorizontal: scale.space.group, paddingBottom: scale.space.group }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', minHeight: 48, borderBottomWidth: 1, borderBottomColor: material.panelEdge }}>
        <Text accessibilityRole="header" style={{ color: material.text, fontSize: scale.type.body, fontWeight: '600', flex: 1 }}>Persona</Text>
        <IconButton aria-label="Close personas" onPress={onClose} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]"
          icon={<ForgeIcon name="close" size={17} color={colors.muted} reducedMotion />} />
      </View>
      <PersonaTurret handle={turret} personas={persona.personas} surface={persona.surface} activeId={persona.activeId} colors={colors} autoFocus
        onSwitch={id => {
          persona.switchTo(id); session.ui.setState({ peeking: false });
          // Hold the panel for the rim flash that confirms the switch.
          closing.current = setTimeout(() => { closing.current = null; latest.current.onClose(); }, forgeFeedbackMotion.commit.ms);
        }}
        onEffect={onEffect} />
      {persona.error && <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: scale.type.label, alignSelf: 'stretch' }}>{persona.error}</Text>}
      {onCompose && <View style={{ alignSelf: 'stretch', alignItems: 'flex-start', borderTopWidth: 1, borderTopColor: material.panelEdge, paddingTop: scale.space.stack }}>
        <Button title="Compose new persona" aria-label="Compose new persona" onPress={onCompose} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]"
          icon={<ForgeIcon name="plus" size={17} color={colors.muted} reducedMotion />} />
      </View>}
    </ScrollView>
  );
}
