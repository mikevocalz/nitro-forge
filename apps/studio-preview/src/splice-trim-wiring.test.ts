import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spliceTrimHandlers } from './splice-trim-wiring.ts';

// The commit stub mirrors useDocumentSurface.commit: it runs the write and rejects with the engine error.
const commit = async (write: () => Promise<unknown>) => { await write(); };
const edit = { kind: 'roll', leftClipId: '4', rightClipId: '5', trackId: '1', deltaFrames: 3, deltaSeconds: 0.125 } as const;

test('trim edits and track flags reach the Splice bindings with the control payload', async () => {
  const calls: unknown[][] = [];
  const handlers = spliceTrimHandlers({
    onEdit: async e => { calls.push(['onEdit', e]); },
    onSetFlag: async (...args) => { calls.push(['onSetFlag', ...args]); },
  }, commit);
  await handlers.onEdit(edit);
  await handlers.onSetFlag('2', 'locked', true);
  assert.deepEqual(calls, [['onEdit', edit], ['onSetFlag', '2', 'locked', true]]);
});

test('an engine rejection is not swallowed: it reaches commit and stays observed', async () => {
  const failure = new Error('rollEdit: clips must touch on one track');
  const seen: string[] = [];
  const handlers = spliceTrimHandlers({
    onEdit: async () => { throw failure; },
    onSetFlag: async () => { throw new Error('setTrackFlags: hidden applies to video and overlay tracks only'); },
  }, async write => { try { await write(); } catch (error) { seen.push((error as Error).message); throw error; } });
  await assert.rejects(handlers.onEdit(edit), failure);
  await assert.rejects(handlers.onSetFlag('3', 'hidden', true), /hidden applies/);
  assert.deepEqual(seen, [failure.message, 'setTrackFlags: hidden applies to video and overlay tracks only']);
});

test('a write the admission gate refuses never calls the engine', async () => {
  let engineCalls = 0;
  const handlers = spliceTrimHandlers({
    onEdit: async () => { engineCalls++; },
    onSetFlag: async () => { engineCalls++; },
  }, async () => { throw new Error('Wait for the timeline to finish loading.'); });
  await assert.rejects(handlers.onEdit(edit), /finish loading/);
  await assert.rejects(handlers.onSetFlag('2', 'muted', true), /finish loading/);
  assert.equal(engineCalls, 0);
});
