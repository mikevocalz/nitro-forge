import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { files } from './archive-files.mjs';

/** Reject links and traversal before allowing tar to touch the filesystem. */
export function unpackArchive(archive, output) {
  assert.ok(!existsSync(output), 'Extraction output must be fresh');
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd().split('\n');
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.match(name, /^package(?:\/[A-Za-z0-9_@+., -]+)*\/?$/, `Unsafe archive name: ${name}`);
    assert.ok(!name.split('/').includes('..') && !name.split('/').includes('.'), 'Archive traversal');
  }
  const detail = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  for (const line of detail.trimEnd().split('\n')) assert.ok(/^[-d]/.test(line), 'Archive links/devices are forbidden');
  mkdirSync(output, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', output]);
  const root = resolve(output, 'package');
  files(root);
  return root;
}
