import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitCadenceTrackGain } from './cadence-gain-wiring.ts';

test('E-14 a fader commit is one setTrackGain with the linear gain as volume; out-of-range never reaches the engine', async () => {
  const calls: unknown[][] = [];
  const doc = { setTrackGain: async (...args: unknown[]) => { calls.push(['setTrackGain', ...args]); return { data: { ok: true }, events: [] }; } } as never;
  await commitCadenceTrackGain(doc, 3, 0.25);
  assert.throws(() => commitCadenceTrackGain(doc, 3, 1.2), /between silence and 0 dB/);
  assert.throws(() => commitCadenceTrackGain(doc, -1, 0.5), /track id/);
  assert.deepEqual(calls, [['setTrackGain', 3, 0.25]]);
});
