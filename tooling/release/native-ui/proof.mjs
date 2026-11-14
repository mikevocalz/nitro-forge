import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, json } from '../archive-files.mjs';
import { hierarchyNodes } from './ui-evidence.mjs';

export const STUDIOS = ['prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'];

/** These files are copied from the installed app's actual OS sandbox. */
export function savedDocuments(directory) {
  return STUDIOS.map(studio => {
    const name = `forge-f6-${studio}`, file = resolve(directory, `${name}.nfd`), expected = resolve(directory, `${name}.expected.json`);
    const bytes = readFileSync(file), record = json(expected);
    assert.ok(bytes.length >= 4 && bytes.length <= 16 * 1024 * 1024);
    assert.equal(bytes.subarray(0, 4).toString(), 'NFD1', `OS sandbox document envelope: ${studio}`);
    assert.equal(record.version, 1);
    assert.equal(record.studio, studio);
    assert.equal(record.byteLength, bytes.length, `OS sandbox byte count: ${studio}`);
    assert.equal(typeof record.canonical, 'string');
    assert.ok(record.canonical.length > 0);
    JSON.parse(record.canonical);
    return { studio, file: `${name}.nfd`, bytes: bytes.length, sha256: hash(file), expected: `${name}.expected.json`, expectedSha256: hash(expected) };
  });
}

/** Native accessibility geometry; no JS layout/store measurements. */
export function pickerGeometry(tree, screenshot, requiredWidth) {
  const image = readFileSync(screenshot);
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  if (requiredWidth) assert.equal(width, requiredWidth, 'Actual OS screenshot must have the requested 320px viewport');
  let viewportWidth = width, viewportHeight = height, nodeRoot = tree;
  if (!requiredWidth) {
    // Duo has an additional system/status-bar tree for its two displays.
    // Bind to the uniquely named actual fixture application, never system nodes.
    const applications = tree.children.filter(node => node.attributes.accessibilityText === 'Forge Consumer Smoke');
    assert.equal(applications.length, 1, 'Unambiguous named iOS fixture application required');
    nodeRoot = applications[0];
    const bounds = /^\[0,0\]\[(\d+),(\d+)\]$/.exec(nodeRoot.attributes.bounds ?? '');
    assert.ok(bounds, 'Actual iOS application bounds required');
    [viewportWidth, viewportHeight] = bounds.slice(1).map(Number);
    assert.ok(viewportWidth > 0 && viewportHeight > 0);
    assert.ok(Math.abs(width / viewportWidth - height / viewportHeight) < 0.01, 'Screenshot and iOS application viewport disagree');
  }
  const nodes = hierarchyNodes(nodeRoot);
  const options = STUDIOS.map(studio => {
    const candidates = nodes.filter(node => Object.values(node.attributes).includes(studio));
    const bounds = candidates.map(node => /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(node.attributes.bounds ?? ''))
      .filter(Boolean).map(match => match.slice(1).map(Number));
    // iOS tree coordinates are points, while its PNG may be 2x/3x pixels;
    // Android's explicitly configured mdpi viewport has matching 320px units.
    const visible = bounds.find(([left, top, right, bottom]) => left >= 0 && top >= 0 && right > left && bottom > top && right <= viewportWidth && bottom <= viewportHeight);
    assert.ok(visible, `No native in-viewport option geometry: ${studio}`);
    return { studio, bounds: visible };
  });
  return { screenshotWidth: width, screenshotHeight: height, viewportWidth, viewportHeight, units: requiredWidth ? '320 physical pixels at mdpi; 320 logical dp' : 'OS accessibility points, with separately recorded screenshot pixels', options };
}

/** One planned PNG from the actual executed native driver, never a debug image. */
export function exactFlowScreenshot(stage, name) {
  assert.match(name, /^[a-z0-9-]+\.png$/);
  assert.ok(Array.isArray(stage.screenshots));
  const matches = stage.screenshots.filter(file => file.path.endsWith('/takeScreenshot/' + name));
  assert.equal(matches.length, 1, 'One exact executed native screenshot required: ' + name);
  assert.match(matches[0].sha256, /^[a-f0-9]{64}$/);
  return matches[0];
}

/** Bind the chosen device to the same fresh OS inventory used for selection. */
export function iosRuntimeIdentity(inventory, udid) {
  assert.ok(inventory && typeof inventory.devices === 'object');
  const matches = Object.entries(inventory.devices).flatMap(([runtimeIdentifier, devices]) =>
    devices.filter(device => device.udid === udid).map(device => ({ runtimeIdentifier, device })));
  assert.equal(matches.length, 1, 'Chosen iOS device must have one exact runtime identity');
  const { runtimeIdentifier, device } = matches[0];
  assert.match(runtimeIdentifier, /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-/);
  assert.equal(device.isAvailable, true, 'Chosen iOS runtime/device must be available');
  assert.match(device.deviceTypeIdentifier, /^com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-/);
  return { observedVia: 'xcrun simctl list devices --json', runtimeIdentifier,
    udid: device.udid, deviceTypeIdentifier: device.deviceTypeIdentifier, name: device.name, isAvailable: true };
}

/** Explicit ordinary-phone acceptance profile; runtimes must already exist. */
export const IOS_ACCEPTANCE_DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro';
export function iosSimulatorTemplate(inventory) {
  assert.ok(inventory && typeof inventory.devices === 'object');
  const candidates = Object.entries(inventory.devices)
    .filter(([runtime]) => /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-\d+-\d+(?:-\d+)?$/.test(runtime))
    .sort(([left], [right]) => right.localeCompare(left, undefined, { numeric: true }))
    .flatMap(([, devices]) => devices.filter(device => device.isAvailable && device.deviceTypeIdentifier === IOS_ACCEPTANCE_DEVICE_TYPE));
  assert.ok(candidates.length > 0, 'An already-available generic iOS runtime and iPhone 18 Pro type are required');
  return iosRuntimeIdentity(inventory, candidates[0].udid);
}

/** Never acquire/delete an existing simulator based on create output. */
export function newIosSimulatorId(inventory, udid) {
  assert.match(udid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const identity = udid.toLowerCase();
  assert.ok(!Object.values(inventory.devices).some(devices => devices.some(device => typeof device.udid === 'string' && device.udid.toLowerCase() === identity)), 'Created simulator must not be an existing device');
  return udid;
}

/** CoreSimulator can return exit 0 with failure on either stream. Read the
 * exact retained stdout+stderr record, not run()'s stdout-only return value. */
export function checkIosBootStatusFile(file) {
  const output = readFileSync(file, 'utf8');
  assert.ok(typeof output === 'string' && output.trim().length > 0, 'Actual bootstatus output required');
  assert.ok(!/\b(?:failed|failure|fatal)\b/i.test(output), 'CoreSimulator reported a failed boot/migration; installation must not proceed');
}
