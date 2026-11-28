import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { FolioDocument } from '@nitro-forge/folio';

export const ops = ['new', 'pageCount', 'addAnnotation', 'listAnnotations'];

export async function example(host: EngineHost) {
  const doc = await FolioDocument.create(host, 2);
  assert.equal((await doc.pageCount()).data.pages, 2);
  await doc.addAnnotation(0, [100, 700, 200, 20], 'Check this total');

  const bytes = await doc.save();
  await doc.close();

  const reopened = await FolioDocument.openSnapshot(host, bytes);
  const notes = async () => (await reopened.listAnnotations(0)).data.annots.map((a) => a.contents);
  assert.deepEqual(await notes(), ['Check this total']);
  await reopened.addAnnotation(0, [100, 600, 200, 20], 'Second note');
  assert.equal((await notes()).length, 2);
  assert.equal(await reopened.undo(), true);
  assert.deepEqual(await notes(), ['Check this total']);
  assert.equal(await reopened.redo(), true);
  assert.equal((await notes()).length, 2);
  await reopened.close();
}
