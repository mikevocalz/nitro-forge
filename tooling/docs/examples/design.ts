import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { DesignDocument } from '@nitro-forge/design';

export const ops = ['new', 'addShape', 'updateNode', 'describe'];

export async function example(host: EngineHost) {
  const doc = await DesignDocument.open(host, { width: 320, height: 200 });
  const root = 1;
  const card = (await doc.addShape(root, 'rect', { name: 'Card', x: 16, y: 16, width: 120, height: 80 })).data.node_id;

  const bytes = await doc.save();
  await doc.close();

  const reopened = await DesignDocument.openSnapshot(host, bytes);
  const width = async () => (await reopened.describe()).data.nodes[String(card)]?.width;
  assert.equal(await width(), 120);
  await reopened.updateNode(card, { width: 200 });
  assert.equal(await width(), 200);
  assert.equal(await reopened.undo(), true);
  assert.equal(await width(), 120);
  assert.equal(await reopened.redo(), true);
  assert.equal(await width(), 200);
  await reopened.close();
}
