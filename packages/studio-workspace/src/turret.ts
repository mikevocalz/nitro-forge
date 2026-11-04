/** Persona turret: the design studio's persona switcher as one state machine
 * shared by the native, web and XR hosts. A drag or arrow key only peeks; the
 * persona changes on release, Enter or a ⌘-digit, and Escape or a cancelled
 * gesture (predictive back, responder termination) drops the peek.
 * Structure references: design/references/mobbin-studio-switch-web.md
 * (rotary detent dial, change/commit split). No visuals are taken from them.
 */

/** Committed stop plus an optional peeked stop, both indices into the stops. */
export type TurretState = Readonly<{ committed: number; peek: number | undefined }>;

/** Input the hosts feed the reducer. Angles are degrees, 0 at the top,
 * clockwise positive, measured by the host from the ring centre. */
export type TurretEvent =
  | Readonly<{ type: 'drag'; angleDeg: number }>
  | Readonly<{ type: 'release' }>
  | Readonly<{ type: 'cancel' }>
  | Readonly<{ type: 'key'; key: 'next' | 'previous' | 'first' | 'last' | 'commit' | 'cancel' }>
  | Readonly<{ type: 'shortcut'; digit: number }>;

/** What the host does after a transition: `detent` plays the detent haptic and
 * announces the peeked persona, `end-stop` plays the firmer end cue, `commit`
 * switches persona, `cancel` restores the committed readout. */
export type TurretEffect = 'none' | 'detent' | 'end-stop' | 'commit' | 'cancel';

/** Arc the stops spread over, centred on the top of the ring. */
export const TURRET_ARC_DEG = 240;

/** Angle of stop `index` of `count`, spread evenly across {@linkcode TURRET_ARC_DEG}. */
export function turretStopAngle(index: number, count: number): number {
  if (count === 1) return 0;
  return -TURRET_ARC_DEG / 2 + index * TURRET_ARC_DEG / (count - 1);
}

/** Nearest stop to a drag angle. Angles past either end clamp to that end. */
export function turretStopAt(angleDeg: number, count: number): number {
  if (count === 1) return 0;
  const a = ((angleDeg + 540) % 360) - 180;
  const step = TURRET_ARC_DEG / (count - 1);
  return Math.min(count - 1, Math.max(0, Math.round((a + TURRET_ARC_DEG / 2) / step)));
}

function peekTo(state: TurretState, index: number, count: number, clamped: boolean): [TurretState, TurretEffect] {
  const current = state.peek === undefined ? state.committed : state.peek;
  if (index === current) return [state, clamped ? 'end-stop' : 'none'];
  return [{ committed: state.committed, peek: index }, 'detent'];
}

function commit(state: TurretState, index: number): [TurretState, TurretEffect] {
  if (index === state.committed) return [{ committed: index, peek: undefined }, state.peek === undefined ? 'none' : 'cancel'];
  return [{ committed: index, peek: undefined }, 'commit'];
}

/** Where stop `index` is drawn. Right-to-left mirrors the dial, so the first
 * persona sits on the right and the order reads from the leading edge. */
export function turretDisplayAngle(index: number, count: number, rtl: boolean): number {
  const deg = turretStopAngle(index, count);
  return rtl && deg !== 0 ? -deg : deg;
}

/** A drag angle measured on screen, as the reducer's logical angle. */
export function turretLogicalAngle(screenDeg: number, rtl: boolean): number {
  return rtl ? -screenDeg : screenDeg;
}

/** Arrow keys follow reading direction: the leading arrow goes back a stop. */
export function turretArrowKey(key: string, rtl: boolean): 'next' | 'previous' | undefined {
  switch (key) {
    case 'ArrowDown': return 'next';
    case 'ArrowUp': return 'previous';
    case 'ArrowRight': return rtl ? 'previous' : 'next';
    case 'ArrowLeft': return rtl ? 'next' : 'previous';
    default: return undefined;
  }
}

/** Keyboard shortcut for the stops. Apple keeps ⌘-digit. Elsewhere Ctrl-digit
 * belongs to the browser's tab switching, so the turret takes Alt-digit. */
export type TurretShortcut = Readonly<{ modifier: 'meta' | 'alt'; tag: (digit: number) => string; spoken: (digit: number) => string }>;

const APPLE_SHORTCUT: TurretShortcut = { modifier: 'meta', tag: d => `⌘${d}`, spoken: d => `Command ${d}` };
const ALT_SHORTCUT: TurretShortcut = { modifier: 'alt', tag: d => `Alt ${d}`, spoken: d => `Alt ${d}` };

/** `platform` is `navigator.platform` (or `userAgentData.platform`) on web. */
export function turretShortcutFor(platform: string): TurretShortcut {
  return /mac|iphone|ipad|ipod|ios/i.test(platform) ? APPLE_SHORTCUT : ALT_SHORTCUT;
}

/** Whether a key event carries the shortcut modifier and nothing that would
 * make it another command (⌘⌥1, Ctrl+Alt+1 for AltGr layouts). */
export function turretShortcutDigit(
  event: Readonly<{ key: string; metaKey?: boolean; altKey?: boolean; ctrlKey?: boolean; code?: string }>,
  shortcut: TurretShortcut,
): number | undefined {
  const held = shortcut.modifier === 'meta'
    ? !!event.metaKey && !event.altKey && !event.ctrlKey
    : !!event.altKey && !event.metaKey && !event.ctrlKey;
  if (!held) return undefined;
  // Alt changes `key` on macOS layouts and some others; the physical digit is in `code`.
  const source = /^Digit[1-9]$/.test(event.code ?? '') ? event.code!.slice(5) : event.key;
  const digit = Number(source);
  return Number.isInteger(digit) && digit >= 1 && digit <= 9 ? digit : undefined;
}

/** Scale for a dial box `boxWidth` wide in `available` points: never larger
 * than drawn, and small enough that nothing clips. Narrow boxes come from
 * browser zoom or split windows, where the zoom itself keeps targets large;
 * the floor only stops a zero-width first layout from collapsing the dial. */
export function turretDialScale(available: number, boxWidth: number): number {
  if (!Number.isFinite(available) || available <= 0 || available >= boxWidth) return 1;
  return Math.max(0.5, available / boxWidth);
}

/** Drawn sizes a turret frame is built from, in points at 100 % text. */
export type TurretFrameGeometry = Readonly<{
  bezel: number; labelGap: number; labelWidth: number; labelHeight: number;
  boxWidth: number; boxTop: number; boxHeight: number;
}>;

/** Where the stop names go at one text size. `ring`: around the bezel, the
 * box grown so every name keeps its full size. `stacked`: the ring alone,
 * the names as a list under it, for widths the grown ring cannot fit. */
export type TurretFrame = Readonly<{
  layout: 'ring' | 'stacked';
  /** Uniform scale applied to the drawing box. Never above 1. */
  scale: number;
  boxWidth: number; boxHeight: number; boxTop: number;
  labelWidth: number; labelHeight: number;
}>;

/** Smallest scale a ring of names may be drawn at before they move to a list:
 * below it a 13 pt name would render under 11 pt. */
export const TURRET_MIN_RING_SCALE = 0.85;

/** The turret's drawing box for `count` stops at `textScale` (1 = 100 %),
 * fitted to `available` points. Names grow with the text; the box grows
 * around them; when the grown box cannot fit, the names stack instead of
 * shrinking. `available` of 0 means not measured yet. */
export function turretFrame(available: number, textScale: number, count: number, g: TurretFrameGeometry): TurretFrame {
  const t = Math.max(1, Number.isFinite(textScale) ? textScale : 1);
  const labelWidth = Math.ceil(g.labelWidth * t), labelHeight = Math.max(g.labelHeight, Math.ceil(g.labelHeight * t));
  const reach = g.bezel + g.labelGap;
  let half = g.bezel + 5, top = g.bezel + 5, bottom = g.bezel + 5;
  for (let i = 0; i < count; i++) {
    const rad = turretStopAngle(i, count) * Math.PI / 180;
    const x = Math.abs(reach * Math.sin(rad)), y = -reach * Math.cos(rad);
    const centred = x <= 8;
    half = Math.max(half, x + (centred ? labelWidth / 2 : labelWidth));
    top = Math.max(top, -y + (centred ? labelHeight : labelHeight / 2));
    bottom = Math.max(bottom, y + labelHeight / 2);
  }
  const boxWidth = Math.max(g.boxWidth, Math.ceil(half * 2));
  const boxTop = Math.max(g.boxTop, Math.ceil(top));
  const boxHeight = Math.max(g.boxHeight, boxTop + Math.ceil(bottom));
  const fit = turretDialScale(available, boxWidth);
  if (fit >= TURRET_MIN_RING_SCALE) return { layout: 'ring', scale: fit, boxWidth, boxHeight, boxTop, labelWidth, labelHeight };
  const ring = (g.bezel + 5) * 2;
  return { layout: 'stacked', scale: turretDialScale(available, ring), boxWidth: ring, boxHeight: ring, boxTop: ring / 2, labelWidth, labelHeight };
}

/** What a screen reader hears for one effect. `commit` reads the new persona,
 * `cancel` the one kept; a detent reads the previewed one. */
export function turretAnnouncement(effect: TurretEffect, shown: string, committed: string, atEnd: 'first' | 'last' | null = null): string {
  switch (effect) {
    case 'none': return '';
    case 'detent': return `${shown}, previewing`;
    case 'end-stop': return atEnd === 'first' ? `${shown}, first persona` : `${shown}, last persona`;
    case 'commit': return `Persona: ${shown}`;
    case 'cancel': return `Persona: ${committed}, kept`;
  }
}

/** Advance the turret. `count` is the number of stops on this surface.
 * @throws when `count` is below 1 or the state is outside it. */
export function turretReduce(state: TurretState, event: TurretEvent, count: number): [TurretState, TurretEffect] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Turret needs at least one stop, got ${count}`);
  if (state.committed < 0 || state.committed >= count || (state.peek !== undefined && (state.peek < 0 || state.peek >= count)))
    throw new Error(`Turret state ${JSON.stringify(state)} is outside ${count} stops`);
  const current = state.peek === undefined ? state.committed : state.peek;
  switch (event.type) {
    case 'drag':
      if (!Number.isFinite(event.angleDeg)) return [state, 'none'];
      return peekTo(state, turretStopAt(event.angleDeg, count), count, false);
    case 'release':
      return state.peek === undefined ? [state, 'none'] : commit(state, state.peek);
    case 'cancel':
      return state.peek === undefined ? [state, 'none'] : [{ committed: state.committed, peek: undefined }, 'cancel'];
    case 'shortcut':
      // ⌘1..⌘9 map to stops; digits past the stop count do nothing.
      if (!Number.isInteger(event.digit) || event.digit < 1 || event.digit > count) return [state, 'none'];
      return commit(state, event.digit - 1);
    case 'key':
      switch (event.key) {
        case 'next': return peekTo(state, Math.min(count - 1, current + 1), count, current === count - 1);
        case 'previous': return peekTo(state, Math.max(0, current - 1), count, current === 0);
        case 'first': return peekTo(state, 0, count, current === 0);
        case 'last': return peekTo(state, count - 1, count, current === count - 1);
        case 'commit': return state.peek === undefined ? [state, 'none'] : commit(state, state.peek);
        case 'cancel': return turretReduce(state, { type: 'cancel' }, count);
      }
  }
}
