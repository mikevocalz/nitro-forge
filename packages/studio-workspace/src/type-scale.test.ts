import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACE_DENSITIES, resolveWorkspaceScale, workspaceScale } from './theme.ts';
import { forgeType } from '../../editor-controls/src/type-scale.ts';

const MIN_WORDS = 11;

test('the editor controls mirror the workspace type ramp exactly', () => {
  assert.deepEqual(forgeType, workspaceScale.type);
});

test('caption is the smallest size for words and density never shrinks it', () => {
  assert.ok(workspaceScale.type.caption >= MIN_WORDS);
  for (const density of WORKSPACE_DENSITIES) assert.equal(resolveWorkspaceScale(density).type.caption, workspaceScale.type.caption);
});

/** Every .ts/.tsx source under a directory, tests and fixtures excluded. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test('no workspace or editor-control source sets a single-digit font size', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [here, join(here, '../../editor-controls/src')];
  const offenders = roots.flatMap(sources).flatMap(file =>
    readFileSync(file, 'utf8').split('\n').flatMap((line, index) => /fontSize:\s*[0-9](?![0-9.])/.test(line) ? [`${file}:${index + 1}`] : []));
  assert.deepEqual(offenders, []);
});
