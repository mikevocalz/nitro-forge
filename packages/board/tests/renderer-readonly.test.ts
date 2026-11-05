import { expect, it } from 'vitest';
import type { Diff, Snapshot, Store } from '@quickdrawjs/core';
import { createWhiteboardRendererBinding } from '../src/renderer/createWhiteboardRendererBinding';
import type { WhiteboardRendererTarget } from '../src/renderer/WhiteboardRendererTarget';

it('renders a read-only authoritative source, coalesces diffs and detaches without editing it', () => {
  const snapshot: Snapshot = { document: { store: {} } };
  let listener: Parameters<Store['listen']>[0] | undefined;
  let detached = false;
  const source: Pick<Store, 'getSnapshot' | 'listen'> = {
    getSnapshot: () => snapshot,
    listen(callback) { listener = callback; return () => { detached = true; listener = undefined; }; },
  };
  const snapshots: string[] = [];
  const diffs: string[] = [];
  const renderer: WhiteboardRendererTarget = {
    loadSnapshot: (_revision, json) => { snapshots.push(json); },
    applyDiff: (_revision, json) => { diffs.push(json); },
    setCamera: () => {},
    setOverlay: () => {},
    addOnStateChangedListener: () => ({ remove() {} }),
  };
  const frames = new Map<number, (timestamp: number) => void>();
  let next = 0;
  const binding = createWhiteboardRendererBinding({
    store: source, renderer, getInkOutline: () => undefined,
    requestFrame(callback) { frames.set(++next, callback); return next; },
    cancelFrame(handle) { frames.delete(handle); },
  });
  binding.flush();
  expect(snapshots).toEqual([JSON.stringify(snapshot)]);
  const change: Diff = { added: {}, updated: {}, removed: {} };
  listener?.(change, 'user');
  listener?.(change, 'user');
  expect(frames.size).toBe(1);
  binding.flush();
  expect(diffs).toHaveLength(1);
  expect(source.getSnapshot()).toBe(snapshot);
  binding.dispose();
  binding.dispose();
  expect(detached).toBe(true);
  expect(frames.size).toBe(0);
});
