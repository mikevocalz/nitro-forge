import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brandSurfaces, readBrand, type ForgeBrand } from './surfaces.ts';

const suite: ForgeBrand = { id: 'suite', productName: 'Nitro Forge', shortName: 'Forge', bundleIdentifier: 'ai.nitroforge.suite', androidPackage: 'ai.nitroforge.suite' };
const prism: ForgeBrand = { id: 'prism', productName: 'Nitro Forge Prism', shortName: 'Prism', engine: 'prism', bundleIdentifier: 'ai.nitroforge.prism', androidPackage: 'ai.nitroforge.prism' };

test('readBrand fails loudly when the config plugin did not run', () => {
  assert.throws(() => readBrand({}), /forgeBrand is missing/);
  assert.equal(readBrand({ forgeBrand: prism }).shortName, 'Prism');
});

test('the suite keeps each studio title and leads back to All apps', () => {
  const s = brandSurfaces(suite, '0.1.0');
  assert.equal(s.homeTitle, 'Nitro Forge');
  assert.equal(s.workspaceTitle('Tally'), 'Tally');
  assert.equal(s.documentTitle('Tally'), 'Untitled Tally document');
  assert.deepEqual(s.leading, { label: 'All apps', href: '/' });
});

test('a single-studio build titles its workspace with its own short name and offers About', () => {
  const s = brandSurfaces(prism, '0.1.0');
  assert.equal(s.workspaceTitle('Prism'), 'Prism');
  assert.equal(s.documentTitle('Prism'), 'Untitled Prism document');
  assert.deepEqual(s.leading, { label: 'About', href: '/about' });
  assert.equal(s.about.heading, 'Nitro Forge Prism');
});

test('a renamed studio shows only the new name, whatever the studio title says', () => {
  const lumen = { ...prism, productName: 'Nitro Forge Lumen', shortName: 'Lumen', bundleIdentifier: 'ai.nitroforge.lumen', androidPackage: 'ai.nitroforge.lumen' };
  const s = brandSurfaces(lumen, '0.1.0');
  const shown = [s.homeTitle, s.workspaceTitle('Prism'), s.documentTitle('Prism'), s.about.title, s.about.heading, ...s.about.rows.map(r => r.value)].join(' ');
  assert.doesNotMatch(shown, /prism/i);
  assert.match(shown, /Lumen/);
});
