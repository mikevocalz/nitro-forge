import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { SceneDocument } from '@nitro-forge/scene';

export const ops = ['new', 'addMaterial', 'addMeshPrimitive', 'addNode', 'setTransform', 'bounds'];

export async function example(host: EngineHost) {
  const doc = await SceneDocument.open(host, 'Demo');
  const material = (await doc.addMaterial({ name: 'Paint', color: '#FF0000' })).data.material_id;
  const mesh = (await doc.addMeshPrimitive({ kind: 'box', size: [2, 2, 2], material })).data.mesh_id;
  const box = (await doc.addNode({ kind: 'mesh', name: 'Box', mesh })).data.node_id;

  const bytes = await doc.save();
  await doc.close();

  const reopened = await SceneDocument.openSnapshot(host, bytes);
  const minX = async () => (await reopened.bounds()).data.bounds?.min[0];
  assert.equal(await minX(), -1);
  await reopened.setTransform(box, { translation: [10, 0, 0] });
  assert.equal(await minX(), 9);
  assert.equal(await reopened.undo(), true);
  assert.equal(await minX(), -1);
  assert.equal(await reopened.redo(), true);
  assert.equal(await minX(), 9);
  await reopened.close();
}
