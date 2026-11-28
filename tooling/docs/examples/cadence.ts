import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { CadenceDocument } from '@nitro-forge/cadence';

export const ops = ['new', 'addTrack', 'addClip', 'addNote', 'project'];

export async function example(host: EngineHost) {
  const doc = await CadenceDocument.open(host, 120);
  const track = (await doc.addTrack('midi', 'Keys')).data.track_id;
  const clip = (await doc.addClip(track, 0, 960)).data.clip_id;
  await doc.addNote(clip, 69, 0, 960, 100);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await CadenceDocument.openSnapshot(host, bytes);
  const tracks = async () => (await reopened.project()).data.track_count;
  assert.equal((await reopened.project()).data.tempo_bpm, 120);
  assert.equal(await tracks(), 1);
  await reopened.addTrack('midi', 'Bass');
  assert.equal(await tracks(), 2);
  assert.equal(await reopened.undo(), true);
  assert.equal(await tracks(), 1);
  assert.equal(await reopened.redo(), true);
  assert.equal(await tracks(), 2);
  await reopened.close();
}
