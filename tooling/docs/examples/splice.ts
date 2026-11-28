import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { SpliceDocument } from '@nitro-forge/splice';

export const ops = ['new', 'addSource', 'addTrack', 'addClip', 'duration'];

export async function example(host: EngineHost) {
  const doc = await SpliceDocument.open(host, 30);
  const source = (await doc.addSource(10, 'take1.mp4')).data.source_id;
  const track = (await doc.addTrack('video')).data.track_id;
  await doc.addClip({ track, source, in_s: 0, out_s: 4 });

  const bytes = await doc.save();
  await doc.close();

  const reopened = await SpliceDocument.openSnapshot(host, bytes);
  const seconds = async () => (await reopened.duration()).data.seconds;
  assert.equal(await seconds(), 4);
  await reopened.addClip({ track, source, in_s: 4, out_s: 10 });
  assert.equal(await seconds(), 10);
  assert.equal(await reopened.undo(), true);
  assert.equal(await seconds(), 4);
  assert.equal(await reopened.redo(), true);
  assert.equal(await seconds(), 10);
  await reopened.close();
}
