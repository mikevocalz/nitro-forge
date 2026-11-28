import assert from 'node:assert/strict';
import { base64ToBytes, type EngineHost } from '@nitro-forge/ignition';
import { PrismDocument } from '@nitro-forge/prism';

export const ops = ['new', 'addRasterLayer', 'fillLayer', 'flatten'];

export async function example(host: EngineHost) {
  const doc = await PrismDocument.open(host, 2, 2);
  const layer = (await doc.addRasterLayer('Background')).data.layer_id;
  await doc.fillLayer(layer, [0, 0, 255, 255]);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await PrismDocument.openSnapshot(host, bytes);
  const firstPixel = async () => [...base64ToBytes((await reopened.flatten()).data.pixels_b64).subarray(0, 4)];
  assert.deepEqual(await firstPixel(), [0, 0, 255, 255]);
  await reopened.fillLayer(layer, [255, 0, 0, 255]);
  assert.deepEqual(await firstPixel(), [255, 0, 0, 255]);
  assert.equal(await reopened.undo(), true);
  assert.deepEqual(await firstPixel(), [0, 0, 255, 255]);
  assert.equal(await reopened.redo(), true);
  assert.deepEqual(await firstPixel(), [255, 0, 0, 255]);
  await reopened.close();
}
