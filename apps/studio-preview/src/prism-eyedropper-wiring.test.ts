import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prismSampledColorWrite, samplePrismColor, PRISM_SAMPLE_PROFILE } from './prism-eyedropper-wiring.ts';

const request = { documentId: '4', revision: '12', sourceId: 'composite', x: 10, y: 20, radius: 2 };

test('C-11 a sample is one samplePixels read and Apply writes the same channels to the active slot', async () => {
  const calls: unknown[][] = [];
  const doc = {
    samplePixels: async (...args: unknown[]) => { calls.push(['samplePixels', ...args]); return { data: { r: 200, g: 100, b: 0, a: 51 }, events: [] }; },
    setColors: async (...args: unknown[]) => { calls.push(['setColors', ...args]); return { data: {}, events: [] }; },
  } as never;
  const identity = () => ({ documentId: '4', revision: '12' });
  const sample = await samplePrismColor(doc, request, identity);
  assert.deepEqual(sample, { profileId: PRISM_SAMPLE_PROFILE, channels: [200, 100, 0], alpha: 0.2, preview: { r: 200, g: 100, b: 0, alpha: 0.2 } });
  const write = prismSampledColorWrite(doc, sample, request, identity, 'background');
  assert.equal(calls.length, 1); // nothing is written until the surface runs the write
  await write();
  assert.deepEqual(calls, [['samplePixels', 10, 20, 2], ['setColors', { background: [200, 100, 0, 51] }]]);
});

test('C-11 a sample taken against an older revision is never offered or applied', async () => {
  let revision = '12', writes = 0;
  const doc = {
    samplePixels: async () => { revision = '13'; return { data: { r: 1, g: 2, b: 3, a: 255 }, events: [] }; },
    setColors: async () => { writes++; return { data: {}, events: [] }; },
  } as never;
  const identity = () => ({ documentId: '4', revision });
  await assert.rejects(samplePrismColor(doc, request, identity), /changed after this sample point/);
  const sample = { profileId: PRISM_SAMPLE_PROFILE, channels: [1, 2, 3], alpha: 1, preview: { r: 1, g: 2, b: 3, alpha: 1 } };
  assert.throws(() => prismSampledColorWrite(doc, sample, request, identity, 'foreground'), /changed after this sample point/);
  assert.equal(writes, 0);
});
