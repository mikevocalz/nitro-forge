import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { Pressable, Text, View, type StudioViewRef } from './ui';
import { StudioGesture } from './studio-gesture';
import type { GesturePoint } from './studio-gesture-types';
import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import { personaManifest, personasOn, type PersonaSpec, type PersonaSurface } from './persona';
import { turretReduce, turretStopAngle, type TurretEffect, type TurretEvent, type TurretState } from './turret';
import { workspaceScale as scale, type WorkspaceColors, workspaceThemes } from './theme';

/** Ring geometry in logical points. 44 pt stops keep every detent a real target. */
export const TURRET_SIZE = 148;
const STOP = scale.size.target;
const RADIUS = (TURRET_SIZE - STOP) / 2;

export type PersonaTurretProps = {
  personas: readonly PersonaSpec[];
  surface: PersonaSurface;
  activeId: string;
  /** Called once per committed switch. The document is never touched here. */
  onSwitch: (personaId: string) => void;
  /** Host feedback for detents, end stops and commits (haptics, sound). */
  onEffect?: (effect: TurretEffect) => void;
  colors?: WorkspaceColors;
  disabled?: boolean;
};

type LocalState = { turret: TurretState; origin: { x: number; y: number } | null; focused: boolean };

const angleFrom = (origin: { x: number; y: number }, point: GesturePoint) =>
  Math.atan2(point.x - origin.x, origin.y - point.y) * 180 / Math.PI;

/**
 * The design studio's persona switcher: a four-stop machined ring with
 * detents. Drag or arrow keys peek; release, Enter or ⌘-digit commit;
 * Escape or a cancelled gesture returns to the committed persona. The readout
 * names the persona and lists, in plain words, what it cannot do here.
 */
export function PersonaTurret(props: PersonaTurretProps) {
  const ref = useRef(props); ref.current = props;
  const stops = personasOn(props.personas, props.surface);
  const committedIndex = Math.max(0, stops.findIndex(p => p.id === props.activeId));
  const localRef = useRef<StoreApi<LocalState> | null>(null);
  if (!localRef.current) localRef.current = createStore<LocalState>(() => ({ turret: { committed: committedIndex, peek: undefined }, origin: null, focused: false }));
  const store = localRef.current;
  const state = useStore(store, x => x);
  const ring = useRef<StudioViewRef | null>(null);
  const palette = props.colors ?? workspaceThemes.dark;

  // The host owns which persona is active; follow it when no peek is open.
  useEffect(() => {
    const current = store.getState().turret;
    if (current.peek === undefined && current.committed !== committedIndex) store.setState({ turret: { committed: committedIndex, peek: undefined } });
  }, [committedIndex, store]);

  const dispatch = (event: TurretEvent) => {
    const list = personasOn(ref.current.personas, ref.current.surface);
    if (list.length === 0 || ref.current.disabled) return;
    const [next, effect] = turretReduce(store.getState().turret, event, list.length);
    store.setState({ turret: next });
    if (effect !== 'none') ref.current.onEffect?.(effect);
    const target = list[next.committed];
    if (effect === 'commit' && target) ref.current.onSwitch(target.id);
  };

  const measureOrigin = () => new Promise<{ x: number; y: number } | null>(resolve => {
    const view = ring.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (!view?.measureInWindow) return resolve(null);
    view.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x: x + w / 2, y: y + h / 2 } : null));
  });

  const shown = state.turret.peek ?? state.turret.committed;
  const persona = stops[shown];
  const manifest = persona ? personaManifest(persona, props.surface) : undefined;
  const missing = manifest?.lines.filter(l => !l.ready) ?? [];
  const peeking = state.turret.peek !== undefined;

  return (
    <View testID="persona-turret" style={{ alignItems: 'center', gap: scale.space.element }}
      {...{ onKeyDown: (event: StudioKeyboardEvent & { metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }) => {
        const key = keyboardKey(event);
        if (!key) return;
        const digit = Number(key);
        if ((event.metaKey || event.ctrlKey) && Number.isInteger(digit) && digit >= 1 && digit <= 9) { event.preventDefault?.(); dispatch({ type: 'shortcut', digit }); return; }
        const map: Record<string, 'next' | 'previous' | 'first' | 'last' | 'commit' | 'cancel'> = {
          ArrowRight: 'next', ArrowDown: 'next', ArrowLeft: 'previous', ArrowUp: 'previous', Home: 'first', End: 'last', Enter: 'commit', ' ': 'commit', Escape: 'cancel',
        };
        const action = map[key];
        if (action) { event.preventDefault?.(); dispatch({ type: 'key', key: action }); }
      } }}>
      <StudioGesture disabled={!!props.disabled}
        onBegin={point => { void measureOrigin().then(origin => { store.setState({ origin }); if (origin) dispatch({ type: 'drag', angleDeg: angleFrom(origin, point) }); }); }}
        onMove={(point, touches) => { const origin = store.getState().origin; if (touches > 1) { dispatch({ type: 'cancel' }); return; } if (origin) dispatch({ type: 'drag', angleDeg: angleFrom(origin, point) }); }}
        onRelease={() => { dispatch({ type: 'release' }); store.setState({ origin: null }); }}
        onCancel={() => { dispatch({ type: 'cancel' }); store.setState({ origin: null }); }}>
        <View ref={ring} testID="persona-turret-ring" focusable
          accessibilityRole="adjustable"
          accessibilityLabel="Persona"
          accessibilityValue={{ text: persona ? `${persona.label}${peeking ? ', previewing' : ''}` : 'No persona available' }}
          accessibilityHint="Swipe up or down to preview a persona, double-tap to switch"
          accessibilityActions={[{ name: 'increment', label: 'Next persona' }, { name: 'decrement', label: 'Previous persona' }, { name: 'activate', label: 'Switch to previewed persona' }, { name: 'escape', label: 'Cancel preview' }]}
          onAccessibilityAction={event => {
            const name = event.nativeEvent.actionName;
            if (name === 'increment') dispatch({ type: 'key', key: 'next' });
            else if (name === 'decrement') dispatch({ type: 'key', key: 'previous' });
            else if (name === 'activate') dispatch({ type: 'key', key: 'commit' });
            else if (name === 'escape') dispatch({ type: 'cancel' });
          }}
          {...{ onFocus: () => store.setState({ focused: true }), onBlur: () => { store.setState({ focused: false }); dispatch({ type: 'cancel' }); } }}
          style={{ width: TURRET_SIZE, height: TURRET_SIZE, borderRadius: TURRET_SIZE / 2, backgroundColor: palette.deep, borderWidth: 1, borderColor: state.focused ? palette.accent : palette.line, opacity: props.disabled ? 0.5 : 1 }}>
          {stops.map((p, i) => {
            const rad = turretStopAngle(i, stops.length) * Math.PI / 180;
            const committed = i === state.turret.committed;
            const lit = i === shown;
            return (
              <Pressable key={p.id} testID={`persona-stop-${p.id}`}
                accessibilityRole="radio" accessibilityState={{ selected: committed, disabled: !!props.disabled }}
                accessibilityLabel={`${p.label}${i < 9 ? `, Command ${i + 1}` : ''}`}
                onPress={() => dispatch({ type: 'shortcut', digit: i + 1 })}
                style={{
                  position: 'absolute', width: STOP, height: STOP, borderRadius: STOP / 2,
                  left: TURRET_SIZE / 2 - STOP / 2 + RADIUS * Math.sin(rad), top: TURRET_SIZE / 2 - STOP / 2 - RADIUS * Math.cos(rad),
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: lit ? palette.soft : 'transparent',
                  borderWidth: committed ? 2 : 1, borderColor: committed ? palette.accent : lit ? palette.muted : palette.line,
                }}>
                <Text style={{ color: lit ? palette.text : palette.muted, fontSize: scale.type.label, fontWeight: committed ? '700' : '500' }}>{p.label.slice(0, 1)}</Text>
              </Pressable>
            );
          })}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: TURRET_SIZE / 2 - 14, alignItems: 'center' }}>
            <Text style={{ color: palette.text, fontSize: scale.type.body, fontWeight: '700' }} numberOfLines={1}>{persona?.label ?? 'No persona'}</Text>
            <Text style={{ color: peeking ? palette.accent : palette.muted, fontSize: scale.type.micro }}>{peeking ? 'Release to switch' : `${shown + 1} of ${stops.length}`}</Text>
          </View>
        </View>
      </StudioGesture>
      <View testID="persona-turret-readout" accessibilityLiveRegion="polite" style={{ maxWidth: 240, gap: scale.space.stack }}>
        {missing.length === 0
          ? <Text style={{ color: palette.muted, fontSize: scale.type.label }}>Everything in {persona?.label ?? 'this persona'} works here.</Text>
          : missing.map(line => <Text key={line.id} style={{ color: palette.muted, fontSize: scale.type.label }}>{line.note}</Text>)}
      </View>
    </View>
  );
}
