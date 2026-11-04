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
