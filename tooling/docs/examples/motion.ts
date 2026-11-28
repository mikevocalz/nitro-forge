import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { MotionDocument } from '@nitro-forge/motion';

export const ops = ['new', 'addShapeLayer', 'describe'];

export async function example(host: EngineHost) {
  const doc = await MotionDocument.open(host, { width: 64, height: 36, duration_s: 2 });
  await doc.addShapeLayer({ kind: 'rect', x: 0, y: 0, w: 8, h: 8, fill: [255, 0, 0, 255] }, 'Box');

  const bytes = await doc.save();
  await doc.close();

  const reopened = await MotionDocument.openSnapshot(host, bytes);
  const layerNames = async () => (await reopened.describe()).data.layers.map((l) => l.name);
  assert.deepEqual(await layerNames(), ['Box']);
  await reopened.addShapeLayer({ kind: 'rect', x: 8, y: 0, w: 8, h: 8, fill: [0, 0, 255, 255] }, 'Second box');
  assert.deepEqual(await layerNames(), ['Box', 'Second box']);
  assert.equal(await reopened.undo(), true);
  assert.deepEqual(await layerNames(), ['Box']);
  assert.equal(await reopened.redo(), true);
  assert.deepEqual(await layerNames(), ['Box', 'Second box']);
  await reopened.close();
}
