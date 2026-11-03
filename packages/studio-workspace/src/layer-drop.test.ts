import assert from 'node:assert/strict';
import test from 'node:test';
import { layerDropIndex, awaitLayerDrop, type LayerMeasurements } from './layer-drop.ts';
const rows = [3, 2, 1].map((id, index) => ({ id, x: 20, y: 100 + index * 52, width: 264, height: 52 }));
const viewport = { x: 20, y: 100, width: 264, height: 156 };
test('reverse visual ordering maps top and bottom drops to engine indices', () => {
  assert.equal(layerDropIndex(rows, 1, { x: 40, y: 101 }, viewport), 2);
  assert.equal(layerDropIndex(rows, 3, { x: 40, y: 255 }, viewport), 0);
  assert.equal(layerDropIndex(rows, 2, { x: 40, y: 177 }, viewport), 1);
});
test('midpoints exclude the source row and out-of-viewport drops cancel', () => {
  assert.equal(layerDropIndex(rows, 3, { x: 40, y: 178 }, viewport), 1);
  assert.equal(layerDropIndex(rows, 3, { x: 40, y: 177 }, viewport), 2);
  assert.equal(layerDropIndex(rows, 3, { x: 40, y: 99 }, viewport), null);
  assert.equal(layerDropIndex(rows, 3, { x: 300, y: 180 }, viewport), null);
  assert.equal(layerDropIndex(rows, 9, { x: 40, y: 180 }, viewport), null);
});


test('a release before native measurement waits for geometry; cancellation during that wait wins', async () => {
  let finish!: (value: LayerMeasurements) => void;
  const ready = new Promise<LayerMeasurements>(resolve => { finish = resolve; });
  let current = true;
  const completed = awaitLayerDrop(ready, 3, { x: 40, y: 255 }, () => current);
  finish({ rows, viewport });
  assert.equal(await completed, 0);
  let finishCancelled!: (value: LayerMeasurements) => void;
  const waiting = new Promise<LayerMeasurements>(resolve => { finishCancelled = resolve; });
  const cancelled = awaitLayerDrop(waiting, 3, { x: 40, y: 255 }, () => current);
  current = false;
  finishCancelled({ rows, viewport });
  assert.equal(await cancelled, null);
});
