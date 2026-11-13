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

test('findDisplayName catches a hardcoded name in JSX and strings, not in imports, comments or identifiers', () => {
  const src = [
    'import { Lab } from "@nitro-forge/audio-lab";',
    '// Audio Lab header below',
    'const AudioLabScreen = () => <Text>Nitro Forge · Native Audio Lab</Text>;',
    "const id = 'forge-audio-lab';",
  ].join('\n');
  const hits = brandLib.findDisplayName(src, 'Audio Lab');
  assert.equal(hits.length, 1);
  assert.match(hits[0], /Native Audio Lab/);
  assert.equal(brandLib.findDisplayName('const x = "http://a.b/Audio Lab";', 'Audio Lab').length, 1, 'a URL inside a string is not a comment');
  assert.equal(brandLib.findDisplayName('<ForgeIcon /> {surfaces.title}', 'Forge').length, 0);
});

// Every installable app has a surfaces module the rebrand test can read, and
// the screens it lists show no hardcoded name.
const APPS = [
  ['apps/example', 'apps/example/brands/suite.json'],
  ['apps/example', 'apps/example/brands/prism.json'],
  ['apps/forge-audio-lab', 'apps/forge-audio-lab/brand.json'],
  ['apps/forge-media-lab', 'apps/forge-media-lab/brand.json'],
  ['examples/native-cadence', 'examples/native-cadence/brand.json'],
];
for (const [app, manifest] of APPS) {
  test(`${manifest}: title strings come from ${app}/src/brand/surfaces.ts`, async () => {
    const mod = await import(join(root, app, 'src/brand/surfaces.ts'));
    const b = brandLib.load(join(root, manifest));
    const shown = mod.shownStrings({ id: b.id, productName: b.productName, shortName: b.shortName, ...(b.engine ? { engine: b.engine } : {}), bundleIdentifier: b.ios.bundleIdentifier, androidPackage: b.android.package }, '0.0.0');
    assert.ok(shown.includes(b.productName) || shown.includes(b.shortName), `${app} shows neither "${b.productName}" nor "${b.shortName}": ${shown}`);
    assert.ok(Array.isArray(mod.renderedIn) && mod.renderedIn.length > 0, `${app}: renderedIn is empty`);
    for (const file of mod.renderedIn) {
      const src = readFileSync(join(root, app, file), 'utf8');
      for (const name of [b.productName, b.shortName]) assert.deepEqual(brandLib.findDisplayName(src, name), [], `${app}/${file} hardcodes "${name}"`);
    }
  });
}

test('visibleSource keeps a "//" that sits inside a word, so a name after it is still found', () => {
  assert.equal(brandLib.findDisplayName('<Text>Bench//Audio Lab</Text>', 'Audio Lab').length, 1);
  assert.equal(brandLib.findDisplayName('x(); // Audio Lab', 'Audio Lab').length, 0);
});
