import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { PitchDocument } from '@nitro-forge/pitch';

export const ops = ['new', 'addSlide', 'addText', 'deck'];

export async function example(host: EngineHost) {
  const doc = await PitchDocument.open(host, 'Q4 review');
  const slide = (await doc.addSlide('titleBody')).data.slide_id;
  await doc.addText(slide, 100, 60, 400, 60, 'Revenue', 44);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await PitchDocument.openSnapshot(host, bytes);
  const slides = async () => (await reopened.deck()).data.slide_count;
  assert.equal((await reopened.deck()).data.title, 'Q4 review');
  assert.equal(await slides(), 2);
  await reopened.addSlide('blank');
  assert.equal(await slides(), 3);
  assert.equal(await reopened.undo(), true);
  assert.equal(await slides(), 2);
  assert.equal(await reopened.redo(), true);
  assert.equal(await slides(), 3);
  await reopened.close();
}
