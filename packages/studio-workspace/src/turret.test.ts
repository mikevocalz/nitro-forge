import assert from 'node:assert/strict';
import test from 'node:test';
import { TURRET_ARC_DEG, turretReduce, turretStopAngle, turretStopAt, type TurretEvent, type TurretState } from './turret.ts';

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
