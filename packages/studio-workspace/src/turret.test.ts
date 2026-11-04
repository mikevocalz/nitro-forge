import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TURRET_ARC_DEG, turretAnnouncement, turretArrowKey, turretDialScale, turretDisplayAngle, turretLogicalAngle, turretReduce,
  turretShortcutDigit, turretShortcutFor, turretStopAngle, turretStopAt, type TurretEvent, type TurretState,
} from './turret.ts';

const rest: TurretState = { committed: 0, peek: undefined };
const run = (events: TurretEvent[], count = 4, from = rest) => {
  let state = from;
  const effects: string[] = [];
  for (const e of events) { const [next, effect] = turretReduce(state, e, count); state = next; effects.push(effect); }
  return { state, effects };
};

test('stop angles span the arc symmetrically and map back to themselves', () => {
  for (const n of [1, 2, 3, 4, 5, 9]) for (let i = 0; i < n; i += 1) assert.equal(turretStopAt(turretStopAngle(i, n), n), i);
  assert.equal(turretStopAngle(0, 4), -TURRET_ARC_DEG / 2);
  assert.equal(turretStopAngle(3, 4), TURRET_ARC_DEG / 2);
  assert.equal(turretStopAt(179, 4), 3);
  assert.equal(turretStopAt(-179, 4), 0);
  assert.equal(turretStopAt(360 + 40, 4), turretStopAt(40, 4));
});

test('dragging peeks with one detent per stop and commits only on release', () => {
  const { state, effects } = run([
    { type: 'drag', angleDeg: -120 }, { type: 'drag', angleDeg: -38 }, { type: 'drag', angleDeg: -42 },
    { type: 'drag', angleDeg: 40 }, { type: 'release' },
  ]);
  assert.deepEqual(effects, ['none', 'detent', 'none', 'detent', 'commit']);
  assert.deepEqual(state, { committed: 2, peek: undefined });
});

test('cancel drops the peek and keeps the committed persona', () => {
  const { state, effects } = run([{ type: 'drag', angleDeg: 120 }, { type: 'cancel' }, { type: 'release' }]);
  assert.deepEqual(effects, ['detent', 'cancel', 'none']);
  assert.deepEqual(state, rest);
});

test('peeking back to the committed stop and releasing changes nothing', () => {
  const { state, effects } = run([{ type: 'drag', angleDeg: 40 }, { type: 'drag', angleDeg: -120 }, { type: 'release' }]);
  assert.deepEqual(effects, ['detent', 'detent', 'cancel']);
  assert.deepEqual(state, rest);
});

test('keyboard moves the peek, signals end stops, and commits on Enter', () => {
  const { state, effects } = run([
    { type: 'key', key: 'previous' }, { type: 'key', key: 'next' }, { type: 'key', key: 'last' },
    { type: 'key', key: 'next' }, { type: 'key', key: 'commit' },
  ]);
  assert.deepEqual(effects, ['end-stop', 'detent', 'detent', 'end-stop', 'commit']);
  assert.deepEqual(state, { committed: 3, peek: undefined });
  assert.deepEqual(run([{ type: 'key', key: 'last' }, { type: 'key', key: 'cancel' }]).state, rest);
  assert.deepEqual(run([{ type: 'key', key: 'commit' }]).effects, ['none']);
});

test('command-digit shortcuts commit directly and ignore digits past the stops', () => {
  assert.deepEqual(run([{ type: 'shortcut', digit: 3 }]).state, { committed: 2, peek: undefined });
  assert.deepEqual(run([{ type: 'shortcut', digit: 5 }]).effects, ['none']);
  assert.deepEqual(run([{ type: 'shortcut', digit: 4 }], 3).effects, ['none']);
  assert.deepEqual(run([{ type: 'shortcut', digit: 1 }]).effects, ['none']);
});

test('non-finite drag angles are ignored and bad state throws', () => {
  assert.deepEqual(run([{ type: 'drag', angleDeg: Number.NaN }]).effects, ['none']);
  assert.throws(() => turretReduce(rest, { type: 'release' }, 0), /at least one stop/);
  assert.throws(() => turretReduce({ committed: 4, peek: undefined }, { type: 'release' }, 4), /outside 4 stops/);
});

test('a phone with three stops still reaches every persona by drag and key', () => {
  for (let i = 0; i < 3; i += 1) {
    assert.equal(run([{ type: 'drag', angleDeg: turretStopAngle(i, 3) }, { type: 'release' }], 3).state.committed, i);
    assert.equal(run([{ type: 'shortcut', digit: i + 1 }], 3).state.committed, i);
  }
});

test('right-to-left mirrors the stop order, the drag and the arrows', () => {
  for (const n of [1, 3, 4]) for (let i = 0; i < n; i += 1) {
    assert.equal(turretDisplayAngle(i, n, false), turretStopAngle(i, n));
    assert.equal(turretDisplayAngle(i, n, true), -turretStopAngle(i, n) + 0);
    // A drag onto a stop's drawn position lands on that stop in either direction.
    assert.equal(turretStopAt(turretLogicalAngle(turretDisplayAngle(i, n, true), true), n), i);
  }
  assert.ok(turretDisplayAngle(0, 4, true) > 0, 'the first persona sits on the right in RTL');
  assert.equal(turretArrowKey('ArrowRight', false), 'next');
  assert.equal(turretArrowKey('ArrowRight', true), 'previous');
  assert.equal(turretArrowKey('ArrowLeft', true), 'next');
  assert.equal(turretArrowKey('ArrowDown', true), 'next');
  assert.equal(turretArrowKey('ArrowUp', true), 'previous');
  assert.equal(turretArrowKey('a', false), undefined);
});

test('the shortcut is Command on Apple and Alt elsewhere, never Ctrl', () => {
  const mac = turretShortcutFor('MacIntel'), ipad = turretShortcutFor('iPad'), win = turretShortcutFor('Win32'), linux = turretShortcutFor('Linux x86_64');
  assert.equal(mac.modifier, 'meta'); assert.equal(ipad.modifier, 'meta');
  assert.equal(win.modifier, 'alt'); assert.equal(linux.modifier, 'alt'); assert.equal(turretShortcutFor('').modifier, 'alt');
  assert.equal(mac.tag(2), '⌘2'); assert.equal(win.tag(2), 'Alt 2'); assert.equal(mac.spoken(1), 'Command 1');
  assert.equal(turretShortcutDigit({ key: '2', metaKey: true }, mac), 2);
  assert.equal(turretShortcutDigit({ key: '2', ctrlKey: true }, mac), undefined);
  assert.equal(turretShortcutDigit({ key: '2', ctrlKey: true }, win), undefined, 'Ctrl+digit stays with the browser');
  assert.equal(turretShortcutDigit({ key: '™', code: 'Digit2', altKey: true }, win), 2, 'Alt changes key; code still names the digit');
  assert.equal(turretShortcutDigit({ key: '2', altKey: true, ctrlKey: true }, win), undefined, 'AltGr is Ctrl+Alt');
  assert.equal(turretShortcutDigit({ key: '0', altKey: true }, win), undefined);
  assert.equal(turretShortcutDigit({ key: '2' }, win), undefined);
});

test('announcements name the persona for each effect', () => {
  assert.equal(turretAnnouncement('commit', 'Pixel', 'Pixel'), 'Persona: Pixel');
  assert.equal(turretAnnouncement('cancel', 'Layout', 'Vector'), 'Persona: Vector, kept');
  assert.equal(turretAnnouncement('detent', 'Layout', 'Vector'), 'Layout, previewing');
  assert.equal(turretAnnouncement('end-stop', 'Sketch', 'Vector', 'last'), 'Sketch, last persona');
  assert.equal(turretAnnouncement('end-stop', 'Vector', 'Vector', 'first'), 'Vector, first persona');
  assert.equal(turretAnnouncement('none', 'Vector', 'Vector'), '');
});

test('the dial scales down to fit the measured width and never grows', () => {
  assert.equal(turretDialScale(0, 300), 1, 'no measurement yet: draw at size');
  assert.equal(turretDialScale(340, 300), 1);
  assert.equal(turretDialScale(288, 300), 0.96);
  assert.equal(turretDialScale(175, 300), 175 / 300, '390 px at 200 % zoom');
  assert.equal(turretDialScale(60, 300), 0.5);
});
