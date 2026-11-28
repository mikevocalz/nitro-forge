import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { TallyDocument } from '@nitro-forge/tally';

export const ops = ['new', 'setCell', 'getCell'];

export async function example(host: EngineHost) {
  const doc = await TallyDocument.open(host);
  await doc.setCell('A1', '10');
  await doc.setCell('A2', '20');
  const sum = await doc.setCell('A3', '=A1+A2');
  assert.equal(sum.data.computed, 30);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await TallyDocument.openSnapshot(host, bytes);
  assert.equal((await reopened.getCell('A3')).data.computed, 30);
  await reopened.setCell('A1', '15');
  assert.equal((await reopened.getCell('A3')).data.computed, 35);
  assert.equal(await reopened.undo(), true);
  assert.equal((await reopened.getCell('A3')).data.computed, 30);
  assert.equal(await reopened.redo(), true);
  assert.equal((await reopened.getCell('A3')).data.computed, 35);
  await reopened.close();
}
