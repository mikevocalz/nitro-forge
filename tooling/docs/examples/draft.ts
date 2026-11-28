import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { DraftDocument } from '@nitro-forge/draft';

export const ops = ['new', 'addPoint', 'addSegment', 'updatePoint', 'describe'];

export async function example(host: EngineHost) {
  const doc = await DraftDocument.open(host, 'mm');
  const a = (await doc.addPoint(0, 0)).data.point_id;
  const b = (await doc.addPoint(30, 0)).data.point_id;
  await doc.addSegment(a, b, { name: 'Wall' });

  const bytes = await doc.save();
  await doc.close();

  const reopened = await DraftDocument.openSnapshot(host, bytes);
  const endX = async () => (await reopened.describe()).data.points[String(b)]?.x;
  assert.equal(await endX(), 30);
  await reopened.updatePoint(b, { x: 45 });
  assert.equal(await endX(), 45);
  assert.equal(await reopened.undo(), true);
  assert.equal(await endX(), 30);
  assert.equal(await reopened.redo(), true);
  assert.equal(await endX(), 45);
  await reopened.close();
}
