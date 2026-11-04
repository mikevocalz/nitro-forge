import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useStore } from 'zustand';
import { Button, ScrollView, Text, View } from '@nitro-forge/studio-workspace/ui';
import { PersonaTurret } from '@nitro-forge/studio-workspace/turret';
import { prismThemes, workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import type { PersonaSession } from './persona-session';
import { playTurretHaptic } from './turret-haptics-driver';
import type { TurretEffect } from './turret-haptics';

const colors = prismThemes.dark;

export type PersonaTurretHostProps = {
  session: PersonaSession;
  /** `sheet`: a formSheet route, Back with no peek pops it through the navigator.
   * `dock`: a pane-docked panel, Back with no peek closes it here. */
  presentation: 'sheet' | 'dock';
  onClose: () => void;
};

/**
 * The turret inside a native host. Android Back (predictive or button, both
 * reach BackHandler through ReactActivity's OnBackPressedCallback in RN 0.88)
 * first cancels an open peek, then closes the panel.
 */
export function PersonaTurretHost({ session, presentation, onClose }: PersonaTurretHostProps) {
  const persona = useStore(session.personas, s => s);
  const turretKey = useStore(session.ui, s => s.turretKey);
  const latest = useRef({ onClose, presentation }); latest.current = { onClose, presentation };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const ui = session.ui.getState();
      if (ui.peeking) {
        session.ui.setState({ peeking: false, turretKey: ui.turretKey + 1 });
        playTurretHaptic('cancel');
        return true;
      }
      if (latest.current.presentation === 'dock') { latest.current.onClose(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [session]);

  // A remounted turret's old instance may still finalize its gesture; only
  // the mounted key may move host state or play haptics.
  const onEffect = (effect: TurretEffect) => {
    if (session.ui.getState().turretKey !== turretKey) return;
    if (effect === 'detent') session.ui.setState({ peeking: true });
    else if (effect === 'commit' || effect === 'cancel') session.ui.setState({ peeking: false });
    playTurretHaptic(effect);
  };

  return (
    <ScrollView testID={`persona-${presentation}`} style={{ backgroundColor: colors.base }}
      contentContainerStyle={{ alignItems: 'center', gap: scale.space.group, padding: scale.space.group }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: scale.type.body, fontWeight: '600', alignSelf: 'stretch' }}>Persona</Text>
      <PersonaTurret key={turretKey} personas={persona.personas} surface={persona.surface} activeId={persona.activeId} colors={colors}
        onSwitch={id => { persona.switchTo(id); session.ui.setState({ peeking: false }); onClose(); }}
        onEffect={onEffect} />
      {persona.error && <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: scale.type.label, maxWidth: 240 }}>{persona.error}</Text>}
      <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
        <Button title="Close" aria-label="Close personas" onPress={onClose} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" />
      </View>
    </ScrollView>
  );
}
