import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TURRET_ARC_DEG, TURRET_MIN_RING_SCALE, scaleTurretGeometry, turretAnnouncement, turretFrame, turretArrowKey, turretDialScale, turretDisplayAngle, turretLogicalAngle, turretReduce,
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

const geometry = { bezel: 66, labelGap: 14, labelWidth: 80, labelHeight: 44, boxWidth: 300, boxTop: 128, boxHeight: 200 };

test('at 100 % text the frame is the drawn 300 x 200 box', () => {
  const f = turretFrame(358, 1, 3, geometry);
  assert.deepEqual(f, { layout: 'ring', scale: 1, boxWidth: 300, boxHeight: 200, boxTop: 128, labelWidth: 80, labelHeight: 44 });
  assert.equal(turretFrame(288, 1, 3, geometry).scale, 0.96, '320 px phone: a 4 % fit, names stay on the ring');
});

test('larger text grows the names and the box instead of capping them', () => {
  const f = turretFrame(0, 2, 3, geometry);
  assert.equal(f.layout, 'ring');
  assert.equal(f.labelWidth, 160);
  assert.equal(f.labelHeight, 88);
  assert.ok(f.boxWidth >= 2 * (80 * Math.sin(Math.PI * 2 / 3) + 160), `box ${f.boxWidth} holds both side names`);
  assert.ok(f.boxTop >= 80 + 88, 'the top name sits wholly inside the box');
  assert.equal(turretFrame(900, 2, 3, geometry).scale, 1, 'a wide panel draws the grown ring at size');
});

test('when the grown ring cannot fit, names stack under the ring instead of shrinking', () => {
  for (const [available, scale] of [[358, 2], [288, 2], [163, 1], [128, 1]] as const) {
    const f = turretFrame(available, scale, 3, geometry);
    assert.equal(f.layout, 'stacked', `${available} pt at ${scale}x`);
    assert.ok(f.boxWidth * f.scale <= available, 'the ring fits');
    assert.ok(f.scale >= TURRET_MIN_RING_SCALE, 'the ring keeps its drawn size within a few percent');
  }
  for (const count of [1, 2, 4]) assert.equal(turretFrame(358, 1, count, geometry).layout, 'ring', `${count} stops at 100 %`);
});

test('the dial grows with the text, so the face readout keeps pace with the stop names', () => {
  const dial = { ...geometry, face: 48, notch: 14 };
  assert.equal(scaleTurretGeometry(dial, 1), dial, '100 % keeps the drawn dial');
  assert.equal(scaleTurretGeometry(dial, 0.8), dial, 'smaller text never shrinks the dial');
  for (const t of [1.5, 2, 3]) {
    const g = scaleTurretGeometry(dial, t);
    assert.equal(g.face, 48 * t);
    assert.equal(g.bezel, 66 * t);
    // The readout is 16 pt at 100 % and the stop names 13 pt; both follow the text.
    const readout = 16 * t, stopName = 13 * t;
    assert.ok(readout > stopName, `${t}x: the readout stays the largest type`);
    // Room across the face for "Layout" in a bold 16 pt face (about 3.6 em) at this size.
    assert.ok((g.face - 6) * 2 >= readout * 3.6, `${t}x: the readout fits the face`);
    const f = turretFrame(0, t, 3, g);
    assert.ok(f.boxTop >= g.bezel + g.labelGap + f.labelHeight, `${t}x: the top name clears the grown bezel`);
  }
});
