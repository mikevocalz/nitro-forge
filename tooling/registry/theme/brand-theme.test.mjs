// node --test tooling/registry/theme/brand-theme.test.mjs
// brand-theme.ts imports './theme', which is studio-theme once installed. Stage both side by side so the
// real source files run under node's type stripping, with no copy of the logic in the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'brand-theme-'));
copyFileSync(join(here, '../../../packages/studio-workspace/src/theme.ts'), join(dir, 'theme.ts'));
writeFileSync(join(dir, 'brand-theme.ts'), readFileSync(join(here, 'brand-theme.ts'), 'utf8').replace("from './theme'", "from './theme.ts'"));
const brand = await import(pathToFileURL(join(dir, 'brand-theme.ts')).href);
const { brandThemeProblems, checkBrandTheme, brandCssVariables, brandThemeOverrides } = brand;

const prism = { dark: { accent: '#66B9FF', ink: '#081D2F', soft: '#173C59' }, light: { accent: '#086CB8', ink: '#FFFFFF', soft: '#D6EAFB' }, defaultDensity: 'standard' };
const suite = { dark: { accent: '#B7A5FF', ink: '#211A3D', soft: '#38304F' }, light: { accent: '#6950D1', ink: '#FFFFFF', soft: '#EEE9FF' } };
const green = { dark: { accent: '#5BD68A', ink: '#06210F', soft: '#17402A' }, light: { accent: '#1E7A43', ink: '#FFFFFF', soft: '#DDF3E5' }, defaultDensity: 'compact' };

for (const [name, theme] of [['prism preset', prism], ['suite values without density', suite], ['green, compact', green]]) {
  test(`good input: ${name}`, () => {
    assert.deepEqual(brandThemeProblems(theme), []);
    const checks = checkBrandTheme(theme);
    assert.equal(checks.length, 6);
    assert.ok(checks.every((c) => c.pass && typeof c.ratio === 'number' && c.problem === undefined), JSON.stringify(checks));
    assert.deepEqual(Object.keys(brandCssVariables(theme, 'dark')).sort(), ['--color-accent', '--color-focus', '--color-on-primary', '--color-primary', '--color-primary-tint']);
    assert.deepEqual(brandThemeOverrides(theme, 'light'), theme.light);
  });
}

test('bad input: incomplete palette returns failing entries and does not throw', () => {
  const incomplete = { dark: { accent: '#66B9FF', ink: '#081D2F' }, light: { accent: '#086CB8', ink: '#FFFFFF', soft: '#D6EAFB' } };
  assert.ok(brandThemeProblems(incomplete).some((p) => p.includes('dark.soft')));
  let checks;
  assert.doesNotThrow(() => { checks = checkBrandTheme(incomplete); });
  assert.equal(checks.length, 6);
  const soft = checks.find((c) => c.scheme === 'dark' && c.rule === 'text on soft');
  assert.equal(soft.pass, false);
  assert.equal(soft.ratio, null);
  assert.match(soft.problem, /dark\.soft/);
  assert.ok(checks.filter((c) => c.scheme === 'light').every((c) => c.pass));
});

test('bad input: not an object, a missing scheme and a three-digit hex all fail without throwing', () => {
  for (const value of [null, 'brand', 42, {}, { dark: null, light: 'x' }]) {
    let checks;
    assert.doesNotThrow(() => { checks = checkBrandTheme(value); }, JSON.stringify(value));
    assert.equal(checks.length, 6);
    assert.ok(checks.every((c) => !c.pass && c.ratio === null && c.problem));
    assert.ok(brandThemeProblems(value).length > 0);
  }
  const short = { dark: { accent: '#6BF', ink: '#081D2F', soft: '#173C59' }, light: prism.light };
  assert.ok(brandThemeProblems(short).some((p) => p.includes('dark.accent')));
  const checks = checkBrandTheme(short);
  assert.ok(checks.filter((c) => c.scheme === 'dark' && c.rule !== 'text on soft').every((c) => !c.pass && c.ratio === null));
  assert.ok(checks.every((c) => c.ratio === null || Number.isFinite(c.ratio)), 'no NaN ratio');
});

test('bad input: defaultDensity outside compact, standard, comfortable is rejected', () => {
  for (const defaultDensity of ['huge', '', 3, null]) {
    const problems = brandThemeProblems({ ...prism, defaultDensity });
    assert.ok(problems.some((p) => p.startsWith('defaultDensity')), `${JSON.stringify(defaultDensity)}: ${problems}`);
  }
  for (const defaultDensity of ['compact', 'standard', 'comfortable']) assert.deepEqual(brandThemeProblems({ ...prism, defaultDensity }), []);
});

test('bad input: locked keys and low contrast are reported', () => {
  assert.ok(brandThemeProblems({ ...prism, dark: { ...prism.dark, base: '#000000' } }).includes('dark.base is locked'));
  assert.ok(brandThemeProblems({ ...prism, radius: 8 }).includes('"radius" is not overridable'));
  const pale = { dark: prism.dark, light: { accent: '#F2F2F2', ink: '#FFFFFF', soft: '#D6EAFB' } };
  assert.deepEqual(brandThemeProblems(pale), []);
  const failing = checkBrandTheme(pale).filter((c) => !c.pass);
  assert.deepEqual(failing.map((c) => c.rule).sort(), ['accent as focus on raised', 'ink on accent']);
});
