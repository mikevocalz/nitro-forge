import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { workspaceThemes, workspaceScale } from '../../../packages/studio-workspace/src/theme.ts';
const repo = new URL('../../../', import.meta.url);
const sheet = new URL('packages/studio-workspace/src/theme.native.css', repo);

test('native and web themes regenerate deterministically from one semantic source', () => {
  const before = readFileSync(sheet, 'utf8');
  execFileSync(process.execPath, ['packages/studio-workspace/build-theme.mjs'], { cwd: repo });
  assert.equal(readFileSync(sheet, 'utf8'), before);
  for (const [name, values] of Object.entries(workspaceThemes)) {
    const block = before.match(new RegExp(`@variant ${name} \\{([^}]+)\\}`))[1];
    for (const color of Object.values(values)) assert.ok(block.includes(color));
  }
  assert.ok(before.includes(`--radius-sm: ${workspaceScale.radius.control}px`));
  assert.equal(before.includes('[data-theme='), false);
  // Every variable NYC-Tron's recipes read is set in both variants (THEME_TOKENS.md).
  for (const name of ['light', 'dark']) {
    const block = before.match(new RegExp(`@variant ${name} \\{([^}]+)\\}`))[1];
    for (const token of ['primary', 'on-primary', 'surface-raised', 'surface-sunken', 'border', 'text', 'text-muted', 'danger', 'on-danger', 'accent', 'info', 'success', 'focus']) {
      assert.match(block, new RegExp(`--color-${token}: #`), `${name} lacks --color-${token}`);
    }
  }
  assert.ok(before.includes('--radius-card:'));
});
test('shared Expo stylesheet retains web platform sources and root imports it', () => {
  const css = readFileSync(new URL('apps/example/global.css', repo), 'utf8');
  assert.ok(css.includes("@import 'uniwind'"));
  assert.ok(css.includes('theme.native.css'));
  // NYC-Tron UI is themed from the same generated sheet, not an external kit.
  assert.ok(css.includes('@nyc-tron/ui/dist/components'));
  // Only Tailwind, Uniwind and Forge's generated sheet are imported.
  assert.deepEqual([...css.matchAll(/@import '([^']+)'/g)].map(m => m[1]), ['tailwindcss', 'uniwind', '../../packages/studio-workspace/src/theme.native.css']);
  assert.equal(/@source not[^;]*\.web/.test(css), false);
  assert.ok(readFileSync(new URL('apps/example/app/_layout.tsx', repo), 'utf8').includes('import "../global.css"'));
});
