import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { QuillDocument } from '@nitro-forge/quill';

export const ops = ['new', 'insertText', 'text'];

export async function example(host: EngineHost) {
  const doc = await QuillDocument.open(host);
  await doc.insertText({ block: 0, offset: 0 }, 'Hello');

  const bytes = await doc.save();
  await doc.close();

  const reopened = await QuillDocument.openSnapshot(host, bytes);
  const text = async () => (await reopened.text()).data.text;
  assert.equal(await text(), 'Hello');
  await reopened.insertText({ block: 0, offset: 5 }, ' world');
  assert.equal(await text(), 'Hello world');
  assert.equal(await reopened.undo(), true);
  assert.equal(await text(), 'Hello');
  assert.equal(await reopened.redo(), true);
  assert.equal(await text(), 'Hello world');
  await reopened.close();
}
