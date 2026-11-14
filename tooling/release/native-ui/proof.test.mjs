import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { checkIosBootStatus, exactFlowScreenshot, iosRuntimeIdentity, iosSimulatorTemplate, newIosSimulatorId, pickerGeometry, savedDocuments, STUDIOS } from './proof.mjs';

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
  const application = { attributes: { accessibilityText: 'Forge Consumer Smoke', bounds: '[0,0][402,874]' }, children: STUDIOS.map(studio => option(studio, '[10,100][200,140]')) };
  const tree = { attributes: { bounds: '[0,0][0,0]' }, children: [application] };
  assert.equal(pickerGeometry(tree, png).viewportWidth, 402);
  application.children[0].attributes.bounds = '[10,850][200,900]';
  assert.throws(() => pickerGeometry(tree, png), /prism/);
});

test('actual Duo AX binds only the named app and rejects wrong-display pixel geometry', t => {
  const root = fixture(t);
  // Structural PNG header only, not visual evidence. Dimensions came from the
  // hash-verified actual executed Duo picker PNG; AX is its captured OS tree.
  const tree = JSON.parse(readFileSync(new URL('../test-fixtures/ios-duo-picker-hierarchy.json', import.meta.url), 'utf8'));
  const evidence = pickerGeometry(tree, image(root, 1398, 2034));
  assert.equal(evidence.viewportWidth, 466);
  assert.equal(evidence.viewportHeight, 678);
  assert.deepEqual(evidence.options.map(option => option.studio), STUDIOS);
  assert.throws(() => pickerGeometry(tree, image(root, 2007, 2853)), /viewport disagree/);
  tree.children.push(tree.children[0]);
  assert.throws(() => pickerGeometry(tree, image(root, 1398, 2034)), /Unambiguous named/);
  tree.children = tree.children.filter(node => node.attributes.accessibilityText !== 'Forge Consumer Smoke');
  assert.throws(() => pickerGeometry(tree, image(root, 1398, 2034)), /Unambiguous named/);
});
test('picker capture requires one exact executed PNG and a valid original hash', () => {
  const file = { path: 'picker/artifacts/run/name/takeScreenshot/picker-picker.png', sha256: 'a'.repeat(64) };
  assert.equal(exactFlowScreenshot({ screenshots: [file] }, 'picker-picker.png'), file);
  assert.throws(() => exactFlowScreenshot({ screenshots: [] }, 'picker-picker.png'));
  assert.throws(() => exactFlowScreenshot({ screenshots: [file, file] }, 'picker-picker.png'));
  assert.throws(() => exactFlowScreenshot({ screenshots: [{ ...file, path: 'picker/debug/picker-picker.png' }] }, 'picker-picker.png'));
  assert.throws(() => exactFlowScreenshot({ screenshots: [{ ...file, sha256: 'invalid' }] }, 'picker-picker.png'));
});

test('chosen iOS runtime is bound to the actual available-device inventory without a second global query', () => {
  const inventory = JSON.parse(readFileSync(new URL('../test-fixtures/ios-simulator-inventory.json', import.meta.url), 'utf8'));
  const udid = 'C898E3E4-5033-4085-B886-963EE2D0C478';
  const actual = iosRuntimeIdentity(inventory, udid);
  assert.equal(actual.runtimeIdentifier, 'com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4');
  assert.equal(actual.deviceTypeIdentifier, 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo');
  assert.throws(() => iosRuntimeIdentity(inventory, 'missing'), /one exact runtime/);
  const device = inventory.devices[actual.runtimeIdentifier][0];
  device.isAvailable = false;
  assert.throws(() => iosRuntimeIdentity(inventory, udid), /must be available/);
  device.isAvailable = true;
  inventory.devices[actual.runtimeIdentifier].push({ ...device });
  assert.throws(() => iosRuntimeIdentity(inventory, udid), /one exact runtime/);
});

test('fresh iOS profile uses an already-available ordinary phone and generic runtime', () => {
  const inventory = JSON.parse(readFileSync(new URL('../test-fixtures/ios-simulator-inventory.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(inventory);
  const template = iosSimulatorTemplate(inventory);
  assert.equal(template.runtimeIdentifier, 'com.apple.CoreSimulator.SimRuntime.iOS-27-2');
  assert.equal(template.deviceTypeIdentifier, 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro');
  assert.equal(template.name, 'iPhone 18 Pro');
  assert.equal(JSON.stringify(inventory), before, 'Selection must not modify existing devices');
  for (const devices of Object.values(inventory.devices)) for (const device of devices) {
    if (device.deviceTypeIdentifier === template.deviceTypeIdentifier) device.isAvailable = false;
  }
  assert.throws(() => iosSimulatorTemplate(inventory), /already-available/);
});
test('created simulator ownership rejects existing or invalid identities', () => {
  const inventory = JSON.parse(readFileSync(new URL('../test-fixtures/ios-simulator-inventory.json', import.meta.url), 'utf8'));
  const template = iosSimulatorTemplate(inventory), before = JSON.stringify(inventory);
  assert.throws(() => newIosSimulatorId(inventory, template.udid), /must not be an existing/);
  assert.throws(() => newIosSimulatorId(inventory, 'not-an-os-uuid'));
  const fresh = '11111111-2222-3333-4444-555555555555';
  assert.equal(newIosSimulatorId(inventory, fresh), fresh);
  assert.equal(JSON.stringify(inventory), before);
});
test('exit-zero bootstatus with actual failed migration text is rejected before install', () => {
  const failed = readFileSync(new URL('../test-fixtures/ios-duo-failed-bootstatus.log', import.meta.url), 'utf8');
  assert.match(failed, /isTerminal=YES/);
  assert.match(failed, /Data Migration Failed/);
  assert.throws(() => checkIosBootStatus(failed), /failed boot\/migration/);
  // Observed successful CLI text; neither string is native workflow evidence.
  checkIosBootStatus('Monitoring boot status for iPhone.\nDevice already booted, nothing to do.\n');
  checkIosBootStatus('Status=4294967295, isTerminal=YES.\nFinished\n');
  assert.throws(() => checkIosBootStatus(''), /Actual bootstatus/);
});
