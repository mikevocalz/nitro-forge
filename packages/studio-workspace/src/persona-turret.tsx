import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { AccessibilityInfo, Platform, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Stop } from 'react-native-svg';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { Pressable, Text, View, type StudioViewRef } from './ui';
import { StudioGesture } from './studio-gesture';
import type { GesturePoint } from './studio-gesture-types';
import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import { personaManifest, personasOn, type PersonaSpec, type PersonaSurface } from './persona';
import { turretReduce, turretStopAngle, type TurretEffect, type TurretEvent, type TurretState } from './turret';
import { workspaceScale as scale, type WorkspaceColors } from './theme';
import {
  DEFAULT_TURRET_DIRECTION, detentDurationMs, forgeDirections, turretGeometry as geo,
  type ForgeDirectionId, type ForgeRenderPrefs, type ForgeScheme,
} from './forge-directions';

export { BUILT_IN_PERSONAS } from './persona';
export type { PersonaSurface } from './persona';

/** Width of the turret's drawing box. Hosts size their panel from it. */
export const TURRET_SIZE = geo.boxWidth;

/** Every string the turret shows. Capability lines come from persona manifests. */
export const turretCopy = {
  ringLabel: 'Persona',
  stopsHeading: 'Personas',
  position: (n: number, of: number) => `${n} of ${of}`,
  idleTouch: (of: number) => `Drag the ring or tap a name · ${of} stops`,
  idleKeys: (of: number) => `Drag, or arrows to preview · ⌘1 to ⌘${of}`,
  peekDrag: (to: string) => `Release to switch to ${to}`,
  peekKey: (to: string, from: string) => `Enter switches to ${to} · Esc keeps ${from}`,
  srHint: 'Swipe up or down to preview a persona, double-tap to switch',
  srValue: (label: string, peeking: boolean) => peeking ? `${label}, previewing` : label,
  srStop: (label: string, digit: number | undefined, committed: boolean) =>
    `${label}${committed ? ', current' : ''}${digit ? `, Command ${digit}` : ''}`,
  actionNext: 'Next persona',
  actionPrevious: 'Previous persona',
  actionActivate: 'Switch to previewed persona',
  actionEscape: 'Cancel preview',
  allReady: (label: string) => `Everything in ${label} works here.`,
  noStops: 'No persona runs on this device',
  disabled: 'Persona switching waits for the engine to finish',
} as const;

export type PersonaTurretProps = {
  personas: readonly PersonaSpec[];
  surface: PersonaSurface;
  activeId: string;
  /** Called once per committed switch. The document is never touched here. */
  onSwitch: (personaId: string) => void;
  /** Host feedback for detents, end stops and commits (haptics, sound). */
  onEffect?: (effect: TurretEffect) => void;
  /** Forge direction. The Prism editor uses the default; the lab passes the others. */
  direction?: ForgeDirectionId;
  scheme?: ForgeScheme;
  /** Host palette. Only its accent is used, so the studio keeps its own. */
  colors?: WorkspaceColors;
  disabled?: boolean;
  /** Host control. `cancel()` drops an open peek exactly as Escape does, for
   * input the turret cannot see itself (Android Back, a closing sheet). */
  handle?: Ref<PersonaTurretHandle>;
};

export type PersonaTurretHandle = Readonly<{ cancel: () => void }>;

type PeekSource = 'drag' | 'key' | null;
type LocalState = { turret: TurretState; origin: { x: number; y: number } | null; focused: boolean; source: PeekSource };

// Accessibility settings shared by every turret, read once per process.
const prefsStore = createStore<ForgeRenderPrefs>(() => ({ reduceMotion: false, reduceTransparency: false, moreContrast: false }));
let prefsWatching = false;
function watchPrefs() {
  if (prefsWatching) return;
  prefsWatching = true;
  const media = (globalThis as { matchMedia?: (q: string) => { matches: boolean; addEventListener?: (t: 'change', cb: () => void) => void } }).matchMedia;
  if (Platform.OS === 'web' && media) {
    const watch = (query: string, key: keyof ForgeRenderPrefs) => {
      const list = media(query);
      prefsStore.setState({ [key]: list.matches });
      list.addEventListener?.('change', () => prefsStore.setState({ [key]: media(query).matches }));
    };
    watch('(prefers-reduced-motion: reduce)', 'reduceMotion');
    watch('(prefers-reduced-transparency: reduce)', 'reduceTransparency');
    watch('(prefers-contrast: more)', 'moreContrast');
    return;
  }
  void AccessibilityInfo.isReduceMotionEnabled().then(v => prefsStore.setState({ reduceMotion: v }));
  AccessibilityInfo.addEventListener('reduceMotionChanged', v => prefsStore.setState({ reduceMotion: v }));
  if (Platform.OS === 'ios') {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(v => prefsStore.setState({ reduceTransparency: v }));
    AccessibilityInfo.addEventListener('reduceTransparencyChanged', v => prefsStore.setState({ reduceTransparency: v }));
  }
}

/** Reduce Motion, Reduce Transparency and Increase Contrast, as one store. */
export function useForgeRenderPrefs(): ForgeRenderPrefs {
  watchPrefs();
  return useStore(prefsStore, s => s);
}

const angleFrom = (origin: { x: number; y: number }, point: GesturePoint) =>
  Math.atan2(point.x - origin.x, origin.y - point.y) * 180 / Math.PI;
const polar = (deg: number, r: number) => {
  const rad = deg * Math.PI / 180;
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) };
};
const ringSize = geo.bezel * 2;
const cx = geo.boxWidth / 2;
const keyboardHost = (surface: PersonaSurface) => surface === 'web' || surface === 'desktop';

/**
 * The design studio's persona switcher: a machined four-stop turret with a
 * detent slot per persona. Drag or arrow keys peek; release, Enter or
 * ⌘-digit commit; Escape or a cancelled gesture returns to the committed
 * persona. The indicator moves one detent at a time from discrete state; on
 * web a CSS transition eases it, on native it steps (Reanimated is not a
 * dependency of this package). The readout lists what the persona cannot do.
 */
export function PersonaTurret(props: PersonaTurretProps) {
  const ref = useRef(props); ref.current = props;
  const stops = personasOn(props.personas, props.surface);
  const committedIndex = Math.max(0, stops.findIndex(p => p.id === props.activeId));
  const localRef = useRef<StoreApi<LocalState> | null>(null);
  if (!localRef.current) localRef.current = createStore<LocalState>(() => ({ turret: { committed: committedIndex, peek: undefined }, origin: null, focused: false, source: null }));
  const store = localRef.current;
  const state = useStore(store, x => x);
  const prefs = useForgeRenderPrefs();
  const ring = useRef<StudioViewRef | null>(null);
  const direction = forgeDirections[props.direction ?? DEFAULT_TURRET_DIRECTION];
  const base = direction.materials[props.scheme ?? 'dark'];
  const m = props.colors ? { ...base, accent: props.colors.accent } : base;
  const depth = direction.depth[props.scheme ?? 'dark'];

  // The host owns which persona is active; follow it when no peek is open.
  useEffect(() => {
    const current = store.getState().turret;
    if (current.peek === undefined && current.committed !== committedIndex) store.setState({ turret: { committed: committedIndex, peek: undefined }, source: null });
  }, [committedIndex, store]);

  const dispatch = (event: TurretEvent, source: PeekSource) => {
    const list = personasOn(ref.current.personas, ref.current.surface);
    if (list.length === 0 || ref.current.disabled) return;
    const [next, effect] = turretReduce(store.getState().turret, event, list.length);
    store.setState({ turret: next, source: next.peek === undefined ? null : source ?? store.getState().source });
    if (effect !== 'none') ref.current.onEffect?.(effect);
    const target = list[next.committed];
    if (effect === 'commit' && target) ref.current.onSwitch(target.id);
  };

  useImperativeHandle(props.handle, () => ({ cancel: () => dispatch({ type: 'cancel' }, null) }));

  const measureOrigin = () => new Promise<{ x: number; y: number } | null>(resolve => {
    const view = ring.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (!view?.measureInWindow) return resolve(null);
    view.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x: x + w / 2, y: y + h / 2 } : null));
  });

  const shown = state.turret.peek ?? state.turret.committed;
  const persona = stops[shown];
  const committedPersona = stops[state.turret.committed];
  const manifest = persona ? personaManifest(persona, props.surface) : undefined;
  const missing = manifest?.lines.filter(l => !l.ready) ?? [];
  const peeking = state.turret.peek !== undefined;
  const keys = keyboardHost(props.surface);
  const indicatorDeg = stops.length ? turretStopAngle(shown, stops.length) : 0;
  const travel = detentDurationMs(direction, prefs);
  const hint = stops.length === 0 ? turretCopy.noStops
    : props.disabled ? turretCopy.disabled
    : peeking && persona && committedPersona
      ? state.source === 'key' ? turretCopy.peekKey(persona.label, committedPersona.label) : turretCopy.peekDrag(persona.label)
      : keys ? turretCopy.idleKeys(stops.length) : turretCopy.idleTouch(stops.length);
  // Discrete state; the browser eases between detents, native steps.
  const indicatorMotion = (Platform.OS === 'web' && travel > 0
    ? { transitionProperty: 'transform', transitionDuration: `${travel}ms`, transitionTimingFunction: direction.motion.easing }
    : {}) as ViewStyle;
  const lightDeg = direction.light.angleDeg;
  const from = polar(lightDeg, 0.5), to = polar(lightDeg + 180, 0.5);
  const gradient = { x1: 0.5 + from.x, y1: 0.5 + from.y, x2: 0.5 + to.x, y2: 0.5 + to.y };
  const R = geo.bezel;

  return (
    <View testID="persona-turret" style={{ alignItems: 'center', gap: scale.space.inset, opacity: props.disabled ? 0.5 : 1 }}
      {...{ onKeyDown: (event: StudioKeyboardEvent & { metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }) => {
        const key = keyboardKey(event);
        if (!key) return;
        const digit = Number(key);
        if ((event.metaKey || event.ctrlKey) && Number.isInteger(digit) && digit >= 1 && digit <= 9) { event.preventDefault?.(); dispatch({ type: 'shortcut', digit }, null); return; }
        const map: Record<string, 'next' | 'previous' | 'first' | 'last' | 'commit' | 'cancel'> = {
          ArrowRight: 'next', ArrowDown: 'next', ArrowLeft: 'previous', ArrowUp: 'previous', Home: 'first', End: 'last', Enter: 'commit', ' ': 'commit', Escape: 'cancel',
        };
        const action = map[key];
        if (action) { event.preventDefault?.(); dispatch({ type: 'key', key: action }, 'key'); }
      } }}>
      <View style={{ width: geo.boxWidth, height: geo.boxHeight }}>
        {/* Focus ring sits outside the bezel so it never covers a detent. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: cx - R - 5, top: geo.boxTop - R - 5, width: ringSize + 10, height: ringSize + 10, borderRadius: R + 5, borderWidth: 2, borderColor: state.focused ? m.accent : 'transparent' }} />
        <StudioGesture disabled={!!props.disabled}
          onBegin={point => { void measureOrigin().then(origin => { store.setState({ origin }); if (origin) dispatch({ type: 'drag', angleDeg: angleFrom(origin, point) }, 'drag'); }); }}
          onMove={(point, touches) => { const origin = store.getState().origin; if (touches > 1) { dispatch({ type: 'cancel' }, null); return; } if (origin) dispatch({ type: 'drag', angleDeg: angleFrom(origin, point) }, 'drag'); }}
          onRelease={() => { dispatch({ type: 'release' }, null); store.setState({ origin: null }); }}
          onCancel={() => { dispatch({ type: 'cancel' }, null); store.setState({ origin: null }); }}>
          <View ref={ring} testID="persona-turret-ring" focusable={!props.disabled}
            accessibilityRole="adjustable"
            accessibilityLabel={turretCopy.ringLabel}
            accessibilityValue={{ text: persona ? turretCopy.srValue(persona.label, peeking) : turretCopy.noStops }}
            accessibilityHint={turretCopy.srHint}
            accessibilityActions={[{ name: 'increment', label: turretCopy.actionNext }, { name: 'decrement', label: turretCopy.actionPrevious }, { name: 'activate', label: turretCopy.actionActivate }, { name: 'escape', label: turretCopy.actionEscape }]}
            onAccessibilityAction={event => {
              const name = event.nativeEvent.actionName;
              if (name === 'increment') dispatch({ type: 'key', key: 'next' }, 'key');
              else if (name === 'decrement') dispatch({ type: 'key', key: 'previous' }, 'key');
              else if (name === 'activate') dispatch({ type: 'key', key: 'commit' }, null);
              else if (name === 'escape') dispatch({ type: 'cancel' }, null);
            }}
            {...{ onFocus: () => store.setState({ focused: true }), onBlur: () => { store.setState({ focused: false }); dispatch({ type: 'cancel' }, null); } }}
            style={{
              position: 'absolute', left: cx - R, top: geo.boxTop - R, width: ringSize, height: ringSize, borderRadius: R,
              // The face colour under the drawing, so the readout has a real ground for contrast checks.
              backgroundColor: m.face[1],
              ...(depth.dial ? { boxShadow: depth.dial } : {}),
              outlineStyle: 'none',
            } as unknown as ViewStyle}>
            <Svg width={ringSize} height={ringSize} viewBox={`${-R} ${-R} ${ringSize} ${ringSize}`} pointerEvents="none">
              <Defs>
                <LinearGradient id={`bezel-${direction.id}`} {...gradient}>
                  {m.bezel.map((c, i) => <Stop key={i} offset={m.bezel.length === 1 ? 0 : i / (m.bezel.length - 1)} stopColor={c} />)}
                </LinearGradient>
                <LinearGradient id={`rim-${direction.id}`} {...gradient}>
                  <Stop offset={0} stopColor={m.bezel[0] ?? m.knurl} stopOpacity={1} /><Stop offset={0.5} stopColor={m.bezel[0] ?? m.knurl} stopOpacity={0} />
                </LinearGradient>
                <LinearGradient id={`face-${direction.id}`} {...gradient}>
                  <Stop offset={0} stopColor={m.face[0]} /><Stop offset={1} stopColor={m.face[1]} />
                </LinearGradient>
              </Defs>
              <Circle r={R - 2} fill={`url(#bezel-${direction.id})`} />
              <Circle r={R - 2.5} fill="none" stroke={`url(#rim-${direction.id})`} strokeWidth={1.5} />
              {/* Knurl: fine cuts around the bezel, skipped where a detent slot sits. */}
              {Array.from({ length: geo.knurlCount }, (_, i) => {
                const deg = i * 360 / geo.knurlCount;
                const nearStop = stops.some((_, s) => Math.abs((((deg - turretStopAngle(s, stops.length)) % 360) + 540) % 360 - 180) < 4);
                if (nearStop) return null;
                const a = polar(deg, R - 3), b = polar(deg, R - 8);
                return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={m.knurl} strokeWidth={1} strokeOpacity={0.55} />;
              })}
              {/* Detent slots, one per persona. The committed slot carries the accent. */}
              {stops.map((p, s) => {
                const deg = turretStopAngle(s, stops.length);
                const a = polar(deg, R - 2), b = polar(deg, R - geo.notch);
                const committed = s === state.turret.committed;
                return <G key={p.id}>
                  <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={m.notch} strokeWidth={5} strokeLinecap="round" />
                  <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={committed ? m.accent : m.knurl} strokeWidth={committed ? 2 : 1} strokeLinecap="round" />
                </G>;
              })}
              <Circle r={geo.face} fill={`url(#face-${direction.id})`} stroke={m.notch} strokeWidth={1} />
              {[6, 13, 20, 27, 34].map(d => <Circle key={d} r={geo.face - d} fill="none" stroke={m.lathe} strokeWidth={0.6} strokeOpacity={direction.light.model === 'refract' ? 0.14 : 0.07} />)}
            </Svg>
            {/* The pointer: a slot milled from the face to the shown detent. */}
            <View pointerEvents="none" testID="persona-turret-indicator"
              style={{ position: 'absolute', left: 0, top: 0, width: ringSize, height: ringSize, transform: [{ rotate: `${indicatorDeg}deg` }], ...indicatorMotion }}>
              <View style={{ position: 'absolute', left: R - 1.5, top: R - geo.face + 3, width: 3, height: 10, borderRadius: 1.5, backgroundColor: peeking ? m.faceText : m.accent }} />
            </View>
            <View pointerEvents="none" style={{ position: 'absolute', left: R - geo.face + 6, width: (geo.face - 6) * 2, top: R - 22, alignItems: 'center', gap: 2 }}>
              <Text numberOfLines={1} style={{ color: m.faceText, fontSize: scale.type.body + 2, fontWeight: '700', letterSpacing: -0.2 }}>{persona?.label ?? turretCopy.ringLabel}</Text>
              <Text style={{ color: m.faceText, opacity: peeking ? 1 : 0.78, fontWeight: peeking ? '700' : '400', fontSize: scale.type.micro + 1, fontVariant: ['tabular-nums'] }}>
                {stops.length ? turretCopy.position(shown + 1, stops.length) : '0 of 0'}
              </Text>
            </View>
          </View>
        </StudioGesture>
        {stops.map((p, s) => {
          // The name's near edge sits labelGap off the bezel, on the outside of its detent.
          const pos = polar(turretStopAngle(s, stops.length), geo.bezel + geo.labelGap);
          const committed = s === state.turret.committed;
          const lit = s === shown;
          const digit = s < 9 ? s + 1 : undefined;
          const side = pos.x < -8 ? 'flex-end' : pos.x > 8 ? 'flex-start' : 'center';
          return (
            <Pressable key={p.id} testID={`persona-stop-${p.id}`}
              accessibilityRole="radio" accessibilityState={{ selected: committed, disabled: !!props.disabled }}
              accessibilityLabel={turretCopy.srStop(p.label, digit, committed)}
              onPress={() => dispatch({ type: 'shortcut', digit: s + 1 }, null)}
              style={{
                position: 'absolute', width: geo.labelWidth, minHeight: geo.labelHeight,
                left: cx + pos.x - (pos.x < -8 ? geo.labelWidth : pos.x > 8 ? 0 : geo.labelWidth / 2),
                top: geo.boxTop + pos.y - (Math.abs(pos.x) <= 8 ? geo.labelHeight : geo.labelHeight / 2),
                alignItems: side, justifyContent: 'center', paddingHorizontal: scale.space.stack,
                // A transparent edge keeps the stop's shape under Windows High Contrast.
                borderRadius: scale.radius.control, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'transparent',
              }}>
              <Text numberOfLines={1} style={{ color: lit ? m.text : m.muted, fontSize: scale.type.label + 1, fontWeight: committed || lit ? '700' : '500' }}>{p.label}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale.space.stack, minHeight: 14 }}>
                {committed && <View style={{ width: 6, height: 2, borderRadius: 1, backgroundColor: m.accent }} />}
                {keys && digit !== undefined && <Text style={{ color: m.muted, fontSize: scale.type.micro + 1, fontVariant: ['tabular-nums'] }}>⌘{digit}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text testID="persona-turret-hint" accessibilityLiveRegion="polite" numberOfLines={2}
        style={{ color: peeking ? m.accent : m.muted, fontSize: scale.type.label, fontWeight: peeking ? '600' : '400', textAlign: 'center', maxWidth: geo.boxWidth }}>{hint}</Text>
      <View testID="persona-turret-readout" accessibilityLiveRegion="polite" style={{ width: geo.boxWidth, gap: scale.space.stack, borderTopWidth: 1, borderTopColor: m.panelEdge, paddingTop: scale.space.element }}>
        {persona && (missing.length === 0
          ? <Text style={{ color: m.muted, fontSize: scale.type.label }}>{turretCopy.allReady(persona.label)}</Text>
          : missing.map(line => <Text key={line.id} style={{ color: m.muted, fontSize: scale.type.label }}>{line.note}</Text>))}
      </View>
    </View>
  );
}
