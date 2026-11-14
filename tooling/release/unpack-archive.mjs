import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { files, hash } from './archive-files.mjs';

/** Reject links and traversal before allowing tar to touch the filesystem. */
export function unpackArchive(archive, output, source) {
  assert.ok(!existsSync(output), 'Extraction output must be fresh');
  const prefix = source?.prefix ?? 'package';
  assert.match(prefix, /^[A-Za-z0-9_-][A-Za-z0-9_.+-]*$/);
  if (source) assert.equal(hash(archive), source.sha256, 'Locked source archive checksum mismatch');
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd().split('\n');
  assert.ok(names.length > 0);
  for (const name of names) {
    if (!source) assert.match(name, /^package(?:\/[A-Za-z0-9_@+., -]+)*\/?$/, `Unsafe archive name: ${name}`);
    assert.ok(name === prefix || name.startsWith(`${prefix}/`), `Unsafe archive prefix: ${name}`);
    assert.ok(!/[\\\x00-\x1f\x7f]/.test(name), `Unsafe archive name: ${name}`);
    assert.ok(!name.split('/').includes('..') && !name.split('/').includes('.'), 'Archive traversal');
  }
  const detail = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  for (const line of detail.trimEnd().split('\n')) assert.ok(/^[-d]/.test(line), 'Archive links/devices are forbidden');
  mkdirSync(output, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', output]);
  const root = resolve(output, prefix);
  files(root);
  return root;
}

/** Bind compilation's registry tree to the locked, unmodified source archive. */
export function verifyRegistrySource(archive, output, directory, source) {
  const root = unpackArchive(archive, output, source);
  const expected = files(root).sort();
  // Cargo creates these two cache bookkeeping files; neither is source.
  const actual = files(directory).filter(path => !['.cargo-ok', '.cargo-checksum.json'].includes(path)).sort();
  assert.deepEqual(actual, expected, 'Registry cache source inventory differs from locked archive');
  for (const path of expected) assert.equal(hash(resolve(directory, path)), hash(resolve(root, path)), `Registry cache source bytes differ: ${path}`);
  return root;
}
