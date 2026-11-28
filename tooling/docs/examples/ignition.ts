import assert from 'node:assert/strict';
import { DocumentHandle, EngineError, type EngineHost } from '@nitro-forge/ignition';

export const engine = 'tally';
export const ops = ['new', 'setCell', 'getCell', '__batch'];

export async function example(host: EngineHost) {
  const doc = await DocumentHandle.openInitialized(host, 'tally', (d) => d.apply('new', {}));
  await doc.apply('setCell', { addr: 'A1', value: '2' });
  await doc.applyBatch([
    { op: 'setCell', payload: { addr: 'A2', value: '3' } },
    { op: 'setCell', payload: { addr: 'A3', value: '=A1*A2' } },
  ]);
  const cell = async (addr: string) => (await doc.apply<{ computed: unknown }>('getCell', { addr })).data.computed;
  assert.equal(await cell('A3'), 6);

  await assert.rejects(doc.apply('setCell', { addr: '!!', value: 'x' }), EngineError);
  assert.equal(await cell('A3'), 6);

  const bytes = await doc.snapshot();
  await doc.close();

  const reopened = await DocumentHandle.openSnapshot(host, 'tally', bytes);
  const value = async (addr: string) => (await reopened.apply<{ computed: unknown }>('getCell', { addr })).data.computed;
  assert.equal(await value('A3'), 6);
  await reopened.apply('setCell', { addr: 'A1', value: '5' });
  assert.equal(await value('A3'), 15);
  assert.equal(await reopened.undo(), true);
  assert.equal(await value('A3'), 6);
  assert.equal(await reopened.redo(), true);
  assert.equal(await value('A3'), 15);
  await reopened.close();
}
