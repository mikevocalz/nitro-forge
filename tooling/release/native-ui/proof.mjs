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
  let viewportWidth = width, viewportHeight = height;
  if (!requiredWidth) {
    // Pinned Maestro's iOS hierarchy has a wrapper and one application child.
    // Use its observed point bounds, not the larger Retina PNG pixel count.
    assert.equal(tree.children.length, 1, 'Unambiguous iOS application viewport required');
    const bounds = /^\[0,0\]\[(\d+),(\d+)\]$/.exec(tree.children[0].attributes.bounds ?? '');
    assert.ok(bounds, 'Actual iOS application bounds required');
    [viewportWidth, viewportHeight] = bounds.slice(1).map(Number);
    assert.ok(viewportWidth > 0 && viewportHeight > 0);
    assert.ok(Math.abs(width / viewportWidth - height / viewportHeight) < 0.01, 'Screenshot and iOS application viewport disagree');
  }
  const nodes = hierarchyNodes(tree);
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
