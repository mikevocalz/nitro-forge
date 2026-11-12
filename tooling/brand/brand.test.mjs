// Brand manifests and icon sets: node --test tooling/brand/brand.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FAMILY, FAMILY_IDS, appIcon, adaptiveForeground } from './icon-family.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const brandLib = createRequire(import.meta.url)('./brand.cjs');
const STUDIOS = ['prism', 'quill', 'tally', 'pitch', 'folio', 'splice', 'cadence'];
const files = [
  ...readdirSync(join(root, 'apps/example/brands')).filter(f => f.endsWith('.json')).map(f => join(root, 'apps/example/brands', f)),
  join(root, 'apps/forge-audio-lab/brand.json'),
  join(root, 'apps/forge-media-lab/brand.json'),
  join(root, 'examples/native-cadence/brand.json'),
];
const brands = files.map(f => brandLib.load(f));
const pngSize = file => { const b = readFileSync(file); assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is not a PNG`); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('the suite and all seven studios have a manifest, one per installable app', () => {
  const engines = brands.filter(b => b.engine).map(b => b.engine).sort();
  assert.deepEqual(engines, [...STUDIOS].sort());
  assert.ok(brands.some(b => b.id === 'suite' && !b.engine));
});

test('names and identifiers are unique across every Forge app', () => {
  for (const key of ['id', 'productName', 'shortName', 'slug', 'scheme']) {
    const values = brands.map(b => b[key]);
    assert.equal(new Set(values).size, values.length, `duplicate ${key}: ${values}`);
  }
  for (const pick of [b => b.ios.bundleIdentifier, b => b.android.package]) {
    const values = brands.map(pick);
    assert.equal(new Set(values).size, values.length, `duplicate identifier: ${values}`);
  }
});

test('no display name is a slug', () => {
  for (const b of brands) {
    assert.doesNotMatch(b.productName, /^[a-z0-9-]+$/, `${b.file}: productName "${b.productName}" reads as a slug`);
    assert.doesNotMatch(b.shortName, /^[a-z0-9-]+$/, `${b.file}: shortName "${b.shortName}" reads as a slug`);
  }
});

test('every icon file exists at the size Expo expects', () => {
  for (const b of brands) {
    assert.ok(FAMILY[b.icons.family], `${b.file}: unknown icon family "${b.icons.family}"`);
    for (const key of ['app', 'adaptiveForeground', 'adaptiveBackground', 'adaptiveMonochrome']) assert.deepEqual(pngSize(b.iconFiles[key]), [1024, 1024], `${b.file} ${key}`);
    assert.deepEqual(pngSize(b.iconFiles.favicon), [256, 256], `${b.file} favicon`);
  }
});

test('the test renders exist at 16, 32, 60 and 1024 px for every family member', () => {
  for (const id of FAMILY_IDS) for (const size of [16, 32, 60, 1024]) {
    assert.deepEqual(pngSize(join(root, 'design/icons/renders', id, `${id}-${size}.png`)), [size, size]);
  }
});

test('family colours are distinct and the square icon has no transparency', () => {
  const studioColours = ['suite', ...STUDIOS].map(id => FAMILY[id].colour);
  assert.equal(new Set(studioColours).size, studioColours.length);
  for (const id of FAMILY_IDS) {
    assert.match(appIcon(id), /<rect width="1024" height="1024" rx="0" fill="url\(#g\)"\/>/, `${id}: full-bleed ground`);
    assert.doesNotMatch(adaptiveForeground(id), /url\(#g\)/, `${id}: foreground carries no ground`);
  }
});

test('glyph coordinates stay inside the 304 px keyline circle', () => {
  for (const id of FAMILY_IDS) {
    const fg = adaptiveForeground(id);
    const points = [];
    for (const m of fg.matchAll(/points="([^"]+)"/g)) for (const p of m[1].split(' ')) points.push(p.split(',').map(Number));
    for (const m of fg.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"(?![^>]*transform)/g)) {
      const [x, y, w, h] = m.slice(1).map(Number);
      points.push([x, y], [x + w, y], [x, y + h], [x + w, y + h]);
    }
    for (const m of fg.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)) { const [cx, cy, r] = m.slice(1).map(Number); points.push([cx - r, cy], [cx + r, cy], [cx, cy - r], [cx, cy + r]); }
    assert.ok(points.length > 0, id);
    for (const [x, y] of points) assert.ok(Math.hypot(x - 512, y - 512) <= 304 + 8, `${id}: (${x}, ${y}) is outside the keyline`);
  }
});

test('rebrand replaces every spelling in name fields and leaves engine and icons alone', () => {
  const raw = JSON.parse(readFileSync(join(root, 'apps/example/brands/prism.json'), 'utf8'));
  const next = brandLib.rebrand(raw, 'Prism', 'Lumen');
  assert.equal(next.productName, 'Nitro Forge Lumen');
  assert.equal(next.shortName, 'Lumen');
  assert.equal(next.ios.bundleIdentifier, 'ai.nitroforge.lumen');
  assert.equal(next.slug, 'nitro-forge-lumen');
  assert.equal(next.engine, 'prism');
  assert.deepEqual(next.icons, raw.icons);
  const suite = brandLib.rebrand(JSON.parse(readFileSync(join(root, 'apps/example/brands/suite.json'), 'utf8')), 'Nitro Forge', 'Acme Works');
  assert.equal(suite.productName, 'Acme Works');
  assert.equal(suite.slug, 'acme-works');
  assert.equal(suite.ios.bundleIdentifier, 'ai.acmeworks.suite');
});

test('findName catches every spelling, case-insensitively', () => {
  assert.equal(brandLib.findName('ai.nitroforge.x', 'Nitro Forge').length, 1);
  assert.equal(brandLib.findName('slug nitro-forge', 'Nitro Forge').length, 1);
  assert.equal(brandLib.findName('PRISM', 'Prism').length, 1);
  assert.equal(brandLib.findName('Lumen', 'Prism').length, 0);
});

test('validate rejects slug-like and malformed identifiers', () => {
  const good = JSON.parse(readFileSync(join(root, 'apps/example/brands/prism.json'), 'utf8'));
  assert.throws(() => brandLib.validate({ ...good, android: { package: 'ai.nitro-forge.prism' } }), /Java package/);
  assert.throws(() => brandLib.validate({ ...good, ios: { bundleIdentifier: 'prism' } }), /reverse-DNS/);
  assert.throws(() => brandLib.validate({ ...good, shortName: '' }), /shortName/);
});
