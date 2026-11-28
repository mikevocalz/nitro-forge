import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL_IDS, PANEL_NAMES, layoutErrorMessage } from './model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, path), 'utf8');
/** Source without comments, so notes for developers may name the engine. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('each panel goes by one name everywhere', () => {
  assert.deepEqual(PANEL_NAMES, { outline: 'Outline', properties: 'Inspector', actions: 'Actions', history: 'History' });
  assert.deepEqual(Object.keys(PANEL_NAMES), [...PANEL_IDS]);
  const index = read('./index.tsx');
  // The rail, the compact bar and the panel headings read PANEL_NAMES, not their own words.
  for (const stale of ["'Inspect'", "'Tools'", "'Commands'", "'Properties'", 'panelHeadings', "'Document structure'", "'Edit history'"])
    assert.equal(index.includes(stale), false, `index.tsx still carries ${stale}`);
});

test('layout error codes become sentences', () => {
  for (const reason of ['no-stage-space', 'invalid-geometry', 'unknown-panel', 'missing-panel', 'invalid-position', 'Invalid workspace preset']) {
    const message = layoutErrorMessage(reason);
    assert.notEqual(message, reason);
    assert.match(message, /^[A-Z].*\.$/, message);
  }
  assert.equal(layoutErrorMessage('Save a layout first'), 'Save a layout first');
});

test('no engine or developer wording reaches the chrome or the default stage', () => {
  const sources = {
    'index.tsx': code('./index.tsx'), 'stage.tsx': code('./stage.tsx'), 'model.ts': code('./model.ts'),
    'studio-preview main.tsx': code('../../../apps/studio-preview/src/main.tsx'),
  };
  const banned = [/snapshot generated/i, /bytes from the Rust engine/, /projection/i, /\bin Commands\b/, /using Commands/, /select Commands/,
    /evaluateLayout|renderFrame|RGBA path|host canvas adapter|host renderer|metadata/, /`(Layer|Track|Sheet) \$\{i\}/, / complete`/];
  for (const [name, source] of Object.entries(sources)) for (const pattern of banned)
    assert.doesNotMatch(source, pattern, `${name} matches ${pattern}`);
});
