import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { PhotoDocument } from '@nitro-forge/photo';

export const ops = ['new', 'addOriginal', 'setRating', 'readOriginal'];

export async function example(host: EngineHost) {
  const doc = await PhotoDocument.open(host);
  const { original_id } = (await doc.addOriginal({
    sha256: 'a'.repeat(64),
    asset_ref: 'library:IMG_0001.dng',
    byte_length: 1024,
    camera_make: 'Example',
    camera_model: 'One',
  })).data;
  await doc.setRating(original_id, 3);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await PhotoDocument.openSnapshot(host, bytes);
  const rating = async () => (await reopened.readOriginal(original_id)).data.original.rating;
  assert.equal(await rating(), 3);
  await reopened.setRating(original_id, 5);
  assert.equal(await rating(), 5);
  assert.equal(await reopened.undo(), true);
  assert.equal(await rating(), 3);
  assert.equal(await reopened.redo(), true);
  assert.equal(await rating(), 5);
  await reopened.close();
}
