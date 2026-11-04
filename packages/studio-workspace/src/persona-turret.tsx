import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { AccessibilityInfo, Dimensions, I18nManager, PixelRatio, Platform, findNodeHandle, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Stop } from 'react-native-svg';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { Pressable, Text, View, type StudioViewRef } from './ui';
import { StudioGesture } from './studio-gesture';
import type { GesturePoint } from './studio-gesture-types';
import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import { personaManifest, personasOn, type PersonaSpec, type PersonaSurface } from './persona';
import {
  scaleTurretGeometry, turretAnnouncement, turretArrowKey, turretDisplayAngle, turretFrame, turretLogicalAngle, turretReduce,
  turretShortcutDigit, turretShortcutFor, type TurretEffect, type TurretEvent, type TurretShortcut, type TurretState,
} from './turret';
import { workspaceScale as scale, type WorkspaceColors } from './theme';
import {
  DEFAULT_TURRET_DIRECTION, detentDurationMs, forgeDirections, forgeFeedbackMotion, turretGeometry as geo,
  systemColor, type ForgeDirectionId, type ForgeRenderPrefs, type ForgeScheme,
} from './forge-directions';
import { TurretPointer, TurretRim, type TurretPulse } from './turret-motion';

export { BUILT_IN_PERSONAS } from './persona';
export type { PersonaSurface } from './persona';

/** Width of the turret's drawing box at 100 % text. Hosts size their panel
 * from {@linkcode turretBoxWidth}, which grows with the text. */
export const TURRET_SIZE = geo.boxWidth;

/** The user's text size as a multiple of 100 %: Dynamic Type or Android font
 * scale on native, the browser's default font size on web (RN Web sets text
 * in px, so the turret applies it itself). Browser zoom needs nothing: it
 * scales the whole page and the frame fits the narrower width. */
export function turretTextScale(): number {
  if (Platform.OS !== 'web') return PixelRatio.getFontScale();
  const g = globalThis as { document?: { documentElement?: unknown }; getComputedStyle?: (e: unknown) => { fontSize?: string } };
  const root = g.document?.documentElement;
  const px = root && g.getComputedStyle ? parseFloat(g.getComputedStyle(root).fontSize ?? '') : NaN;
  return Number.isFinite(px) && px > 0 ? Math.max(1, px / 16) : 1;
}

/** Width a host panel gives the turret so `count` stops keep their ring at
 * `textScale`. Narrower panels get the stacked names instead. */
export function turretBoxWidth(textScale: number, count: number): number {
  return turretFrame(0, textScale, count, scaleTurretGeometry(geo, textScale)).boxWidth;
}

/** Every string the turret shows. Capability lines come from persona manifests. */
export const turretCopy = {
  ringLabel: 'Persona',
  stopsHeading: 'Personas',
  position: (n: number, of: number) => `${n} of ${of}`,
  idleTouch: (of: number) => `Drag the ring or tap a name · ${of} stops`,
  idleKeys: (of: number, shortcut: TurretShortcut) => `Drag, or arrows to preview · ${shortcut.tag(1)} to ${shortcut.tag(of)}`,
  peekDrag: (to: string) => `Release to switch to ${to}`,
  peekKey: (to: string, from: string) => `Enter switches to ${to} · Esc keeps ${from}`,
  srHint: 'Swipe up or down to preview a persona, double-tap to switch',
  srValue: (label: string, peeking: boolean) => peeking ? `${label}, previewing` : label,
  srStop: (label: string, shortcut: string | undefined) => `${label}${shortcut ? `, ${shortcut}` : ''}`,
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
  /** Web: the host's status node, which outlives the panel. Without it the
   * turret keeps its own. Native always announces through AccessibilityInfo. */
  onAnnounce?: (text: string) => void;
  /** Escape with no preview open. Hosts close their panel here. */
  onDismiss?: () => void;
  /** Move focus to the ring when the turret mounts (a panel opening). */
  autoFocus?: boolean;
  /** Forces the reading direction. Default: the document (web) or I18nManager. */
  rtl?: boolean;
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

export type PersonaTurretHandle = Readonly<{ cancel: () => void; focus: () => void }>;

type PeekSource = 'drag' | 'key' | null;
type LocalState = {
  turret: TurretState; origin: { x: number; y: number } | null; focused: boolean; source: PeekSource;
  focusedStop: number | null; width: number; pulse: TurretPulse | null; status: string;
};

type HostPrefs = ForgeRenderPrefs & { finePointer: boolean; platform: string; textScale: number };
type MediaList = { matches: boolean; addEventListener?: (t: 'change', cb: () => void) => void };

// Accessibility settings shared by every turret, read once per process.
const prefsStore = createStore<HostPrefs>(() => ({
  reduceMotion: false, reduceTransparency: false, moreContrast: false, forcedColors: false, finePointer: false, platform: Platform.OS, textScale: 1,
}));
let prefsWatching = false;
function watchPrefs() {
  if (prefsWatching) return;
  prefsWatching = true;
  const media = (globalThis as { matchMedia?: (q: string) => MediaList }).matchMedia;
  if (Platform.OS === 'web' && media) {
    const watch = (query: string, key: 'reduceMotion' | 'reduceTransparency' | 'moreContrast' | 'forcedColors' | 'finePointer') => {
      const list = media(query);
      prefsStore.setState({ [key]: list.matches });
      list.addEventListener?.('change', () => prefsStore.setState({ [key]: media(query).matches }));
    };
    watch('(prefers-reduced-motion: reduce)', 'reduceMotion');
    watch('(prefers-reduced-transparency: reduce)', 'reduceTransparency');
    watch('(prefers-contrast: more)', 'moreContrast');
    watch('(forced-colors: active)', 'forcedColors');
    // Shortcut tags belong to hosts with a mouse or trackpad, not to touch.
    watch('(pointer: fine)', 'finePointer');
    const nav = (globalThis as { navigator?: { platform?: string; userAgentData?: { platform?: string } } }).navigator;
    prefsStore.setState({ platform: nav?.userAgentData?.platform || nav?.platform || '' });
    watchWebTextScale();
    return;
  }
  prefsStore.setState({ textScale: PixelRatio.getFontScale() });
  Dimensions.addEventListener('change', () => prefsStore.setState({ textScale: PixelRatio.getFontScale() }));
  void AccessibilityInfo.isReduceMotionEnabled().then(v => prefsStore.setState({ reduceMotion: v }));
  AccessibilityInfo.addEventListener('reduceMotionChanged', v => prefsStore.setState({ reduceMotion: v }));
  if (Platform.OS === 'ios') {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(v => prefsStore.setState({ reduceTransparency: v }));
    AccessibilityInfo.addEventListener('reduceTransparencyChanged', v => prefsStore.setState({ reduceTransparency: v }));
    void AccessibilityInfo.isDarkerSystemColorsEnabled?.().then(v => prefsStore.setState({ moreContrast: v }));
    AccessibilityInfo.addEventListener('darkerSystemColorsChanged', v => prefsStore.setState({ moreContrast: v }));
  }
}

/** Web: a 1rem probe reports every change to the root font size (the
 * browser's text size setting, or a page that sets it), so layouts sized from
 * the text follow it without a reload. */
function watchWebTextScale() {
  const g = globalThis as unknown as { document?: { createElement: (t: string) => { style: Record<string, string>; setAttribute: (k: string, v: string) => void }; body?: { appendChild: (n: unknown) => void } };
    ResizeObserver?: new (cb: () => void) => { observe: (n: unknown) => void } };
  const update = () => { const next = turretTextScale(); if (next !== prefsStore.getState().textScale) prefsStore.setState({ textScale: next }); };
  update();
  if (!g.document?.body || !g.ResizeObserver) return;
  const probe = g.document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', width: '1rem', height: '1rem', top: '0', left: '0' });
  g.document.body.appendChild(probe);
  new g.ResizeObserver(update).observe(probe);
}

/** The user's text size as a multiple of 100 %, kept current: the browser's
 * root font size on web, the system font scale on native. */
export function useStudioTextScale(): number {
  watchPrefs();
  return useStore(prefsStore, s => s.textScale);
}

/** Reduce Motion, Reduce Transparency, Increase Contrast and forced colours, as one store. */
export function useForgeRenderPrefs(): ForgeRenderPrefs {
  watchPrefs();
  return useStore(prefsStore, s => s);
}

/** Whether this host shows shortcut tags (a fine pointer on web), and which
 * modifier the stops take there. */
export function useTurretShortcut(): Readonly<{ keys: boolean; shortcut: TurretShortcut }> {
  watchPrefs();
  const finePointer = useStore(prefsStore, s => s.finePointer);
  const platform = useStore(prefsStore, s => s.platform);
  return { keys: Platform.OS === 'web' && finePointer, shortcut: turretShortcutFor(platform) };
}

/** Reading direction: the document's `dir` on web, I18nManager on native. */
export function documentRtl(): boolean {
  if (Platform.OS !== 'web') return I18nManager.isRTL;
  const doc = (globalThis as { document?: { documentElement?: { dir?: string }; body?: { dir?: string } } }).document;
  return doc?.documentElement?.dir === 'rtl' || doc?.body?.dir === 'rtl';
}

const angleFrom = (origin: { x: number; y: number }, point: GesturePoint) =>
  Math.atan2(point.x - origin.x, origin.y - point.y) * 180 / Math.PI;
const polar = (deg: number, r: number) => {
  const rad = deg * Math.PI / 180;
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) };
};
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, clip: 'rect(0 0 0 0)' } as unknown as ViewStyle;

/**
 * The design studio's persona switcher: a machined four-stop turret with a
 * detent slot per persona. Drag or arrow keys peek; release, Enter or the
 * shortcut digit commit; Escape or a cancelled gesture returns to the
 * committed persona. The pointer eases between detents on the UI thread
 * (CSS on web, Reanimated on native) and steps under Reduce Motion.
 */
export function PersonaTurret(props: PersonaTurretProps) {
  const ref = useRef(props); ref.current = props;
  const stops = personasOn(props.personas, props.surface);
  const committedIndex = Math.max(0, stops.findIndex(p => p.id === props.activeId));
  const localRef = useRef<StoreApi<LocalState> | null>(null);
  if (!localRef.current) localRef.current = createStore<LocalState>(() => ({
    turret: { committed: committedIndex, peek: undefined }, origin: null, focused: false, source: null,
    focusedStop: null, width: 0, pulse: null, status: '',
  }));
  const store = localRef.current;
  const state = useStore(store, x => x);
  watchPrefs();
  const prefs = useStore(prefsStore, s => s);
  const ring = useRef<StudioViewRef | null>(null);
  const direction = forgeDirections[props.direction ?? DEFAULT_TURRET_DIRECTION];
  const base = direction.materials[props.scheme ?? 'dark'];
  const m = props.colors ? { ...base, accent: props.colors.accent } : base;
  const depth = direction.depth[props.scheme ?? 'dark'];
  const rtl = props.rtl ?? documentRtl();
  const shortcut = turretShortcutFor(prefs.platform);
  const keys = Platform.OS === 'web' && prefs.finePointer;
  const forced = !!prefs.forcedColors;
  const focusColor = forced ? systemColor('Highlight') : m.accent;

  // The host owns which persona is active; follow it when no peek is open.
  useEffect(() => {
    const current = store.getState().turret;
    if (current.peek === undefined && current.committed !== committedIndex) store.setState({ turret: { committed: committedIndex, peek: undefined }, source: null });
  }, [committedIndex, store]);

  const focusRing = () => {
    const node = ring.current as unknown as { focus?: () => void } | null;
    if (Platform.OS === 'web') { node?.focus?.(); return; }
    const tag = ring.current ? findNodeHandle(ring.current as never) : null;
    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
  };
  useEffect(() => {
    if (!props.autoFocus) return;
    // One frame so the panel is laid out before focus or VoiceOver lands on it.
    const id = requestAnimationFrame(focusRing);
    return () => cancelAnimationFrame(id);
  }, []);

  const announce = (text: string) => {
    if (!text) return;
    if (Platform.OS !== 'web') { AccessibilityInfo.announceForAccessibility(text); return; }
    if (ref.current.onAnnounce) { ref.current.onAnnounce(text); return; }
    // Same words twice still need to be read: alternate a trailing no-break space.
    store.setState(s => ({ status: s.status === text ? `${text} ` : text }));
  };

  const dispatch = (event: TurretEvent, source: PeekSource) => {
    const list = personasOn(ref.current.personas, ref.current.surface);
    if (list.length === 0 || ref.current.disabled) return;
    const before = store.getState();
    const [next, effect] = turretReduce(before.turret, event, list.length);
    const shownIndex = next.peek ?? next.committed;
    const atEnd = shownIndex === 0 ? 'first' : shownIndex === list.length - 1 ? 'last' : null;
    const seq = (before.pulse?.seq ?? 0) + 1;
    const screenDir = (atEnd === 'first' ? -1 : 1) * (rtl ? -1 : 1) as 1 | -1;
    const pulse: TurretPulse | null = effect === 'end-stop' ? { kind: 'end-stop', dir: screenDir, seq }
      : effect === 'commit' ? { kind: 'commit', dir: 1, seq } : before.pulse;
    store.setState({ turret: next, pulse, source: next.peek === undefined ? null : source ?? before.source });
    if (effect !== 'none') ref.current.onEffect?.(effect);
    const shown = list[shownIndex], committed = list[next.committed];
    if (shown && committed) announce(turretAnnouncement(effect, shown.label, committed.label, atEnd));
    if (effect === 'commit' && committed) ref.current.onSwitch(committed.id);
  };

  useImperativeHandle(props.handle, () => ({ cancel: () => dispatch({ type: 'cancel' }, null), focus: focusRing }));

  const measureOrigin = () => new Promise<{ x: number; y: number } | null>(resolve => {
    const view = ring.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (!view?.measureInWindow) return resolve(null);
    view.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x: x + w / 2, y: y + h / 2 } : null));
  });
  const dragTo = (origin: { x: number; y: number }, point: GesturePoint) =>
    dispatch({ type: 'drag', angleDeg: turretLogicalAngle(angleFrom(origin, point), rtl) }, 'drag');

  const shown = state.turret.peek ?? state.turret.committed;
  const persona = stops[shown];
  const committedPersona = stops[state.turret.committed];
  const manifest = persona ? personaManifest(persona, props.surface) : undefined;
  const missing = manifest?.lines.filter(l => !l.ready) ?? [];
  const peeking = state.turret.peek !== undefined;
  const indicatorDeg = stops.length ? turretDisplayAngle(shown, stops.length, rtl) : 0;
  const travel = detentDurationMs(direction, prefs);
  const hint = stops.length === 0 ? turretCopy.noStops
    : props.disabled ? turretCopy.disabled
    : peeking && persona && committedPersona
      ? state.source === 'key' ? turretCopy.peekKey(persona.label, committedPersona.label) : turretCopy.peekDrag(persona.label)
      : keys ? turretCopy.idleKeys(stops.length, shortcut) : turretCopy.idleTouch(stops.length);
  const lightDeg = direction.light.angleDeg;
  const from = polar(lightDeg, 0.5), to = polar(lightDeg + 180, 0.5);
  const gradient = { x1: 0.5 + from.x, y1: 0.5 + from.y, x2: 0.5 + to.x, y2: 0.5 + to.y };
  const textScale = prefs.textScale;
  // The dial grows with the text, so the readout in its face follows the text
  // size like the stop names and stays the largest type on the instrument.
  const g = scaleTurretGeometry(geo, textScale);
  const k = g.face / geo.face;
  const R = g.bezel;
  const ringSize = R * 2;
  // Native scales text itself; RN Web sets px, so the turret multiplies.
  const fs = (size: number) => Platform.OS === 'web' ? Math.round(size * textScale) : size;
  const frame = turretFrame(state.width, textScale, stops.length, g);
  const stacked = frame.layout === 'stacked';
  const cx = frame.boxWidth / 2;
  const lineWidth = Math.min(frame.boxWidth * frame.scale, state.width || g.boxWidth);
  const notchBoost = prefs.moreContrast || forced ? 1 : 0;

  // Focus is tracked on the group: focus and blur bubble from the stops, and
  // the kit's web Pressable keeps its own blur handler.
  const stopGroup = (
    <View accessibilityRole="radiogroup" accessibilityLabel={turretCopy.stopsHeading} pointerEvents="box-none"
      {...{
        onFocus: (event: { target?: unknown }) => {
          const id = (event.target as { getAttribute?: (n: string) => string | null } | undefined)?.getAttribute?.('data-testid') ?? '';
          const index = stops.findIndex(p => `persona-stop-${p.id}` === id);
          store.setState({ focusedStop: index >= 0 ? index : null });
        },
        onBlur: () => store.setState({ focusedStop: null }),
      } as object}
      style={stacked
        // Stacked: a scale printed under the dial, one row per detent.
        ? { alignSelf: 'stretch', gap: scale.space.stack }
        : { position: 'absolute', left: 0, top: 0, width: frame.boxWidth, height: frame.boxHeight }}>
      {stops.map((p, s) => {
        // On the ring the name's near edge sits labelGap off the bezel, outside its detent.
        const pos = polar(turretDisplayAngle(s, stops.length, rtl), g.bezel + g.labelGap);
        const committed = s === state.turret.committed;
        const lit = s === shown;
        const digit = s < 9 ? s + 1 : undefined;
        const tag = keys && digit !== undefined ? shortcut.tag(digit) : undefined;
        const side = pos.x < -8 ? 'flex-end' : pos.x > 8 ? 'flex-start' : 'center';
        const focusedStop = state.focusedStop === s;
        const place: ViewStyle = stacked
          ? { minHeight: frame.labelHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: scale.space.element, paddingHorizontal: scale.space.element }
          : { position: 'absolute', width: frame.labelWidth, minHeight: frame.labelHeight, alignItems: side, justifyContent: 'center', paddingHorizontal: scale.space.stack,
            left: cx + pos.x - (pos.x < -8 ? frame.labelWidth : pos.x > 8 ? 0 : frame.labelWidth / 2),
            top: frame.boxTop + pos.y - (Math.abs(pos.x) <= 8 ? frame.labelHeight : frame.labelHeight / 2) };
        return (
          <Pressable key={p.id} testID={`persona-stop-${p.id}`}
            accessibilityRole="radio" accessibilityState={{ checked: committed, disabled: !!props.disabled }} aria-checked={committed}
            accessibilityLabel={turretCopy.srStop(p.label, keys && digit !== undefined ? shortcut.spoken(digit) : undefined)}
            onPress={() => dispatch({ type: 'shortcut', digit: s + 1 }, null)}
            style={({ pressed }) => ({
              ...place,
              borderRadius: scale.radius.control, borderWidth: 1,
              // A transparent edge keeps the stop's shape under Windows High Contrast.
              borderColor: focusedStop ? focusColor : 'transparent',
              // Pressed: the name sinks into the panel, an inset of the notch colour.
              backgroundColor: pressed ? `${m.notch}33` : 'transparent',
              transform: [{ scale: pressed ? forgeFeedbackMotion.press.scale : 1 }],
              ...(Platform.OS === 'web' ? {
                transitionProperty: 'transform, background-color', transitionDuration: prefs.reduceMotion ? '0ms' : `${forgeFeedbackMotion.press.ms}ms`, transitionTimingFunction: 'ease-out',
                outlineStyle: focusedStop ? 'solid' : 'none', outlineWidth: 2, outlineColor: focusColor, outlineOffset: 1,
              } : {}),
            }) as ViewStyle}>
            <Text numberOfLines={stacked ? undefined : 1} style={{ flexShrink: 1, color: lit ? m.text : m.muted, fontSize: fs(scale.type.label + 1), fontWeight: committed || lit ? '700' : '500' }}>{p.label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale.space.stack, minHeight: 14 }}>
              {committed && <View style={{ width: 6, height: 2, borderRadius: 1, backgroundColor: m.accent }} />}
              {tag && <Text style={{ color: m.muted, fontSize: fs(scale.type.micro + 1), fontVariant: ['tabular-nums'] }}>{tag}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View testID="persona-turret" style={{ alignSelf: 'stretch', alignItems: 'center', gap: scale.space.inset, opacity: props.disabled ? 0.5 : 1 }}
      onLayout={event => { const w = event.nativeEvent.layout.width; if (w > 0 && Math.abs(w - store.getState().width) > 0.5) store.setState({ width: w }); }}
      {...{ onKeyDown: (event: StudioKeyboardEvent & { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; code?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
        const key = keyboardKey(event);
        if (!key) return;
        const consume = () => { event.preventDefault?.(); event.stopPropagation?.(); };
        const digit = turretShortcutDigit({ ...event, key }, shortcut);
        if (digit !== undefined) { consume(); dispatch({ type: 'shortcut', digit }, null); return; }
        if (key === 'Escape') {
          // Escape first drops a preview; with none open it belongs to the panel.
          if (store.getState().turret.peek !== undefined) { consume(); dispatch({ type: 'cancel' }, null); }
          else if (ref.current.onDismiss) { consume(); ref.current.onDismiss(); }
          return;
        }
        const arrow = turretArrowKey(key, rtl);
        const action = arrow ?? ({ Home: 'first', End: 'last', Enter: 'commit', ' ': 'commit' } as const)[key as 'Home'];
        if (!action) return;
        // Space and Enter on a focused stop press that stop; the ring owns them otherwise.
        if ((key === 'Enter' || key === ' ') && store.getState().focusedStop !== null) return;
        consume();
        dispatch({ type: 'key', key: action }, 'key');
      } }}>
      <View style={{ width: frame.boxWidth * frame.scale, height: frame.boxHeight * frame.scale }}>
        {/* Physical layout: RTL is mirrored by the angles, never by a second flip. */}
        <View style={{ width: frame.boxWidth, height: frame.boxHeight, direction: 'ltr', transform: [{ scale: frame.scale }], transformOrigin: 'top left' } as ViewStyle}>
          {/* Focus ring sits outside the bezel so it never covers a detent. */}
          <View pointerEvents="none" style={{
            position: 'absolute', left: cx - R - 5, top: frame.boxTop - R - 5, width: ringSize + 10, height: ringSize + 10, borderRadius: R + 5,
            borderWidth: state.focused ? 2 : 0, borderColor: focusColor,
            ...(state.focused && Platform.OS === 'web' ? { outlineStyle: 'solid', outlineWidth: forced ? 2 : 0, outlineColor: focusColor, outlineOffset: 1 } : {}),
          } as ViewStyle} />
          <StudioGesture disabled={!!props.disabled}
            onBegin={point => { void measureOrigin().then(origin => { store.setState({ origin }); if (origin) dragTo(origin, point); }); }}
            onMove={(point, touches) => { const origin = store.getState().origin; if (touches > 1) { dispatch({ type: 'cancel' }, null); return; } if (origin) dragTo(origin, point); }}
            onRelease={() => { dispatch({ type: 'release' }, null); store.setState({ origin: null }); }}
            onCancel={() => { dispatch({ type: 'cancel' }, null); store.setState({ origin: null }); }}>
            <View ref={ring} testID="persona-turret-ring" focusable={!props.disabled}
              accessibilityRole="adjustable"
              accessibilityLabel={turretCopy.ringLabel}
              accessibilityValue={stops.length
                ? { min: 1, max: stops.length, now: shown + 1, text: persona ? turretCopy.srValue(persona.label, peeking) : turretCopy.noStops }
                : { text: turretCopy.noStops }}
              accessibilityHint={turretCopy.srHint}
              {...(Platform.OS === 'web' && stops.length ? { 'aria-valuemin': 1, 'aria-valuemax': stops.length, 'aria-valuenow': shown + 1, 'aria-valuetext': persona ? turretCopy.srValue(persona.label, peeking) : turretCopy.noStops } : {})}
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
                position: 'absolute', left: cx - R, top: frame.boxTop - R, width: ringSize, height: ringSize, borderRadius: R,
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
                  const nearStop = stops.some((_, s) => Math.abs((((deg - turretDisplayAngle(s, stops.length, rtl)) % 360) + 540) % 360 - 180) < 4);
                  if (nearStop) return null;
                  const a = polar(deg, R - 3 * k), b = polar(deg, R - 8 * k);
                  return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={m.knurl} strokeWidth={1} strokeOpacity={0.55} />;
                })}
                {/* Detent slots, one per persona. The committed slot carries the
                    accent over a halo, so it holds 3:1 on a light bezel. */}
                {stops.map((p, s) => {
                  const deg = turretDisplayAngle(s, stops.length, rtl);
                  const a = polar(deg, R - 2), b = polar(deg, R - g.notch);
                  const committed = s === state.turret.committed;
                  return <G key={p.id}>
                    <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={m.notch} strokeWidth={5 + notchBoost} strokeLinecap="round" />
                    {committed && <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={m.accentHalo} strokeWidth={4 + notchBoost} strokeLinecap="round" />}
                    <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={committed ? m.accent : m.knurl} strokeWidth={(committed ? 2.5 : 1) + notchBoost} strokeLinecap="round" />
                  </G>;
                })}
                <Circle r={g.face} fill={`url(#face-${direction.id})`} stroke={m.notch} strokeWidth={1} />
                {[6, 13, 20, 27, 34].map(d => <Circle key={d} r={g.face - d * k} fill="none" stroke={m.lathe} strokeWidth={0.6} strokeOpacity={direction.light.model === 'refract' ? 0.14 : 0.07} />)}
              </Svg>
              <TurretRim pulse={state.pulse} reduceMotion={prefs.reduceMotion} size={ringSize} commitColor={m.accent} limitColor={m.muted} />
              {/* The pointer: a slot milled from the face to the shown detent. */}
              <TurretPointer deg={indicatorDeg} durationMs={travel} easing={direction.motion.easing} bezier={direction.motion.bezier}
                reduceMotion={prefs.reduceMotion} pulse={state.pulse} size={ringSize}>
                <View style={{ position: 'absolute', left: R - 1.5 * k, top: R - g.face + 3 * k, width: 3 * k, height: 10 * k, borderRadius: 1.5 * k, backgroundColor: peeking ? m.faceText : m.accent }} />
              </TurretPointer>
              <View pointerEvents="none" style={{ position: 'absolute', left: R - g.face + 6 * k, width: (g.face - 6 * k) * 2, top: R - 22 * k, alignItems: 'center', gap: 2 * k }}>
                <Text numberOfLines={1} style={{ color: m.faceText, fontSize: fs(scale.type.body + 2), fontWeight: '700', letterSpacing: -0.2 }}>{persona?.label ?? turretCopy.ringLabel}</Text>
                {/* The count is a readout: 13 pt, the phone floor for readouts. */}
                <Text style={{ color: m.faceText, opacity: peeking ? 1 : 0.78, fontWeight: peeking ? '700' : '400', fontSize: fs(scale.type.micro + 3), fontVariant: ['tabular-nums'] }}>
                  {stops.length ? turretCopy.position(shown + 1, stops.length) : '0 of 0'}
                </Text>
              </View>
            </View>
          </StudioGesture>
          {!stacked && stopGroup}
        </View>
      </View>
      {stacked && stopGroup}
      <Text testID="persona-turret-hint" numberOfLines={textScale > 1.3 ? undefined : 2}
        style={{ color: peeking ? m.accent : m.muted, fontSize: fs(scale.type.label), fontWeight: peeking ? '600' : '400', textAlign: 'center', maxWidth: stacked ? undefined : lineWidth, alignSelf: stacked ? 'stretch' : 'auto' }}>{hint}</Text>
      {/* Full width, so the capability lines share the panel's gutter with its title and footer. */}
      <View testID="persona-turret-readout" style={{ alignSelf: 'stretch', gap: scale.space.stack, borderTopWidth: 1, borderTopColor: m.panelEdge, paddingTop: scale.space.element }}>
        {persona && (missing.length === 0
          ? <Text style={{ color: m.muted, fontSize: fs(scale.type.label) }}>{turretCopy.allReady(persona.label)}</Text>
          : missing.map(line => <Text key={line.id} style={{ color: m.muted, fontSize: fs(scale.type.label) }}>{line.note}</Text>))}
      </View>
      {Platform.OS === 'web' && !props.onAnnounce && <Text testID="persona-turret-status" accessibilityLiveRegion="polite" style={visuallyHidden}>{state.status}</Text>}
    </View>
  );
}
