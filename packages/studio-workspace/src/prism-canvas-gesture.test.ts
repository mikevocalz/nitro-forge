import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasGesture, type CanvasPreview } from './prism-canvas-model.ts';
import type { CanvasDocument, CanvasRect } from './prism-canvas-model.ts';
const start = { x: 120, y: 220 }, end = { x: 170, y: 245 };
function fixture() {
  const document: CanvasDocument = { width: 4, height: 4, layers: [{ id: 1, visible: true, opacity: 1, content: { type: 'shape', shape: { kind: 'rect', x: 0, y: 0, w: 4, h: 4, fill: [0, 0, 0, 255] } } }] };
  let context = { document, width: 200, height: 100, disabled: false, selectedId: null as number | null };
  let resolve!: (rect: CanvasRect | null) => void;
  const measured = new Promise<CanvasRect | null>(r => { resolve = r; });
  let measures = 0;
  let releaseRect: CanvasRect | null = { x: 100, y: 200, width: 200, height: 100 };
  const selected: (number | null)[] = [], previews: CanvasPreview[] = [], commits: number[][] = [];
  const gesture = createCanvasGesture({ context: () => context, measure: () => measures++ === 0 ? measured : Promise.resolve(releaseRect), select: id => { selected.push(id); context = { ...context, selectedId: id }; }, preview: value => previews.push(value), commit: (...args) => commits.push(args) });
  return { gesture, selected, previews, commits, moveViewport: (rect: CanvasRect | null) => { releaseRect = rect; }, resolve: () => resolve({ x: 100, y: 200, width: 200, height: 100 }), fail: () => resolve(null), context: () => context, change: (patch: Partial<typeof context>) => { context = { ...context, ...patch }; } };
}

test('early release awaits measurement and commits the original release once', async () => {
  const f = fixture(); f.gesture.begin(start); f.gesture.move(end);
  const released = f.gesture.release(end);
  const duplicate = f.gesture.release({ x: 270, y: 245 });
  f.gesture.move({ x: 270, y: 245 });
  assert.deepEqual(f.commits, []);
  f.resolve(); await Promise.all([released, duplicate]);
  assert.deepEqual(f.selected, [1]);
  assert.deepEqual(f.commits, [[1, 1, 1]]);
  assert.equal(f.previews.at(-1), null);
});

test('tap or subthreshold movement selects without recording history', async () => {
  for (const end of [start, { x: start.x + 2, y: start.y + 1 }]) {
    const f = fixture(); f.gesture.begin(start); f.resolve(); await f.gesture.release(end);
    assert.deepEqual(f.selected, [1]); assert.deepEqual(f.commits, []);
  }
});

test('cancel, resize, document replacement, disable, multitouch and measurement failure prevent pending commits', async () => {
  for (const interrupt of [
    (f: ReturnType<typeof fixture>) => f.gesture.cancel(),
    (f: ReturnType<typeof fixture>) => { f.change({ selectedId: 2 }); f.gesture.selectionChanged(2); },
    (f: ReturnType<typeof fixture>) => f.change({ selectedId: 2 }),
    (f: ReturnType<typeof fixture>) => f.change({ width: 100 }),
    (f: ReturnType<typeof fixture>) => f.change({ document: { ...f.context().document } }),
    (f: ReturnType<typeof fixture>) => f.change({ disabled: true }),
    (f: ReturnType<typeof fixture>) => f.gesture.move(end, 2),
  ]) {
    const f = fixture(); f.gesture.begin(start); f.gesture.move(end); interrupt(f);
    const release = f.gesture.release(end); f.resolve(); await release;
    assert.deepEqual(f.commits, []); assert.deepEqual(f.selected, []);
  }
  const f = fixture(); f.gesture.begin(start); f.fail(); await f.gesture.release(end);
  assert.deepEqual(f.commits, []);
});

test('selection change after measurement cancels and repeated gestures remain independent', async () => {
  const f = fixture(); f.gesture.begin(start); f.resolve();
  // Drain measurement and its chained selection callback.
  await new Promise(resolve => setTimeout(resolve, 0));
  f.gesture.move(end); assert.ok(f.previews.some(value => value?.dx === 1));
  f.gesture.selectionChanged(2); await f.gesture.release(end); assert.deepEqual(f.commits, []);
  f.gesture.begin(start); await f.gesture.release(end); assert.deepEqual(f.commits, [[1, 1, 1]]);
});

test('background taps clear selection and raster hits never transform raster geometry', async () => {
  for (const layers of [[], [{ id: 2, visible: true, opacity: 1, content: { type: 'raster', pixels_b64: Buffer.alloc(64, 255).toString('base64') } }]]) {
    const f = fixture(); f.change({ document: { width: 4, height: 4, layers } });
    f.gesture.begin(start); f.resolve(); await f.gesture.release(end);
    assert.deepEqual(f.selected, [layers[0]?.id ?? null]); assert.deepEqual(f.commits, []);
  }
});

test('release remeasurement rejects move-only relayout and native ancestor scrolling', async () => {
  for (const rect of [null, { x: 120, y: 200, width: 200, height: 100 }, { x: 100, y: 180, width: 200, height: 100 }]) {
    const f = fixture(); f.gesture.begin(start); f.resolve();
    f.moveViewport(rect); await f.gesture.release(end);
    assert.deepEqual(f.commits, []);
    assert.equal(f.previews.at(-1), null);
  }
});
