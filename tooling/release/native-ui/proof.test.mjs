import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pickerGeometry, savedDocuments, STUDIOS } from './proof.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-os-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function documents(root) {
  for (const studio of STUDIOS) {
    const bytes = 'NFD1synthetic structural test, not native evidence';
    writeFileSync(resolve(root, `forge-f6-${studio}.nfd`), bytes);
    writeFileSync(resolve(root, `forge-f6-${studio}.expected.json`), JSON.stringify({ version: 1, studio, byteLength: Buffer.byteLength(bytes), canonical: '{"testOnly":true}' }));
  }
}
function image(root, width, height) {
  // Header-shaped structural test data, never a screenshot/visual baseline.
  const bytes = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  const path = resolve(root, 'synthetic.png'); writeFileSync(path, bytes); return path;
}
const option = (studio, bounds) => ({ attributes: { text: studio, bounds }, children: [] });
test('OS-file receipt requires all seven envelopes and matching persisted expected records', t => {
  const root = fixture(t); documents(root);
  const records = savedDocuments(root);
  assert.deepEqual(records.map(record => record.studio), STUDIOS);
  assert.ok(records.every(record => /^[a-f0-9]{64}$/.test(record.sha256)));
  rmSync(resolve(root, 'forge-f6-quill.nfd'));
  assert.throws(() => savedDocuments(root), /ENOENT/);
});
test('OS-file receipt rejects corrupt bytes, wrong studio and mismatched persisted lengths', t => {
  const root = fixture(t); documents(root);
  writeFileSync(resolve(root, 'forge-f6-prism.nfd'), 'BAD1synthetic structural test, not native evidence');
  assert.throws(() => savedDocuments(root), /envelope/);
  documents(root);
  writeFileSync(resolve(root, 'forge-f6-prism.expected.json'), JSON.stringify({ version: 1, studio: 'quill', byteLength: 48, canonical: '{}' }));
  assert.throws(() => savedDocuments(root));
  writeFileSync(resolve(root, 'forge-f6-prism.expected.json'), JSON.stringify({ version: 1, studio: 'prism', byteLength: 47, canonical: '{}' }));
  assert.throws(() => savedDocuments(root), /byte count/);
});
test('320px picker proof requires all native option bounds inside the actual viewport', t => {
  const root = fixture(t), png = image(root, 320, 800);
  const tree = { attributes: {}, children: STUDIOS.map((studio, index) => option(studio, `[10,${100 + index * 50}][200,${140 + index * 50}]`)) };
  assert.equal(pickerGeometry(tree, png, 320).options.length, 7);
  tree.children[6].attributes.bounds = '[10,400][321,450]';
  assert.throws(() => pickerGeometry(tree, png, 320), /quill/);
  tree.children.pop();
  assert.throws(() => pickerGeometry(tree, png, 320), /quill/);
  assert.throws(() => pickerGeometry(tree, image(root, 640, 1600), 320), /320px/);
});
test('iOS Retina pixels cannot conceal an option outside actual application point bounds', t => {
  const root = fixture(t), png = image(root, 1206, 2622);
  const application = { attributes: { bounds: '[0,0][402,874]' }, children: STUDIOS.map(studio => option(studio, '[10,100][200,140]')) };
  const tree = { attributes: { bounds: '[0,0][0,0]' }, children: [application] };
  assert.equal(pickerGeometry(tree, png).viewportWidth, 402);
  application.children[0].attributes.bounds = '[10,850][200,900]';
  assert.throws(() => pickerGeometry(tree, png), /prism/);
});
