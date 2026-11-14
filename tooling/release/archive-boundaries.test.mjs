import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { candidate } from './candidate-manifest.mjs';
import { checkExports, checkSourceClosure, files, hash, inside } from './archive-files.mjs';
import { unpackArchive } from './unpack-archive.mjs';
import { fileURLToPath } from 'node:url';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-archive-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function manifest(root) {
  const names = ['ignition', 'prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'];
  const value = { schemaVersion: 1, sourceCommit: 'a'.repeat(40), version: '1.0.0-test.1', deferred: ['photo', 'motion', 'design', 'draft', 'scene'], archives: names.map(n => {
    const archive = `nitro-forge-${n}-1.0.0-test.1.tgz`;
    writeFileSync(resolve(root, archive), 'test fixture, not a native package');
    return { name: `@nitro-forge/${n}`, version: '1.0.0-test.1', archive, sha256: hash(resolve(root, archive)), contents: [{ path: 'package.json', sha256: 'b'.repeat(64) }] };
  }) };
  return value;
}
function writeManifest(root, value) {
  const file = resolve(root, 'candidate.json');
  writeFileSync(file, JSON.stringify(value));
  return file;
}
test('candidate refuses stale native/source identity before consumption', t => {
  const root = fixture(t), value = manifest(root);
  assert.throws(() => candidate(writeManifest(root, value), 'c'.repeat(40)), /source differs/);
});
test('candidate refuses tampered archive bytes', t => {
  const root = fixture(t), value = manifest(root);
  writeFileSync(resolve(root, value.archives[0].archive), 'changed');
  assert.throws(() => candidate(writeManifest(root, value), value.sourceCommit), /checksum mismatch/);
});
test('candidate refuses expanded or incomplete public inventory', t => {
  const root = fixture(t), value = manifest(root);
  value.archives.pop();
  assert.throws(() => candidate(writeManifest(root, value), value.sourceCommit), /exactly eight/);
});
test('candidate rejects escape and duplicate content paths', t => {
  const root = fixture(t), value = manifest(root);
  value.archives[0].contents[0].path = '../source';
  assert.throws(() => candidate(writeManifest(root, value), value.sourceCommit), /Escaping path/);
  value.archives[0].contents = [{ path: 'src/index.ts', sha256: 'b'.repeat(64) }, { path: 'src/index.ts', sha256: 'c'.repeat(64) }];
  assert.throws(() => candidate(writeManifest(root, value), value.sourceCommit), /Duplicate archive content/);
});
test('source staging and extraction reject symlink fallback', t => {
  const root = fixture(t), source = resolve(root, 'source');
  mkdirSync(source); mkdirSync(resolve(source, 'package'));
  symlinkSync('/tmp', resolve(source, 'package/escape'));
  assert.throws(() => files(source), /Symlink/);
  const archive = resolve(root, 'linked.tgz');
  execFileSync('tar', ['-czf', archive, '-C', source, 'package']);
  assert.throws(() => unpackArchive(archive, resolve(root, 'output')), /links\/devices/);
});
test('extraction validates package-only names before writing', t => {
  const root = fixture(t), source = resolve(root, 'source'); mkdirSync(source);
  writeFileSync(resolve(source, 'outside'), 'not a package');
  const archive = resolve(root, 'outside.tgz'); execFileSync('tar', ['-czf', archive, '-C', source, 'outside']);
  assert.throws(() => unpackArchive(archive, resolve(root, 'output')), /Unsafe archive/);
});
test('headless package cannot leave a workspace dependency or missing export', t => {
  const root = fixture(t); writeFileSync(resolve(root, 'index.ts'), 'export {};');
  assert.throws(() => checkExports(root, { name: 'test', main: './index.ts', dependencies: { ignition: 'workspace:*' } }), /Unresolved local dependency/);
  assert.throws(() => checkExports(root, { name: 'test', exports: { '.': './missing.ts' } }), /ENOENT/);
});
test('rooted package paths reject absolute paths and traversal', () => {
  for (const path of ['/tmp/file', '../file', 'a/../../file', 'a\\file', '']) assert.throws(() => inside('/package', path));
});
test('per-package source closure cannot borrow an undeclared sibling from the all-studio app', t => {
  const root = fixture(t); mkdirSync(resolve(root, 'src'));
  writeFileSync(resolve(root, 'src/index.ts'), "import { other } from '@nitro-forge/other';\n");
  assert.throws(() => checkSourceClosure(root, { name: '@nitro-forge/prism' }), /Undeclared module/);
  writeFileSync(resolve(root, 'src/index.ts'), "export { other } from './missing';\n");
  assert.throws(() => checkSourceClosure(root, { name: '@nitro-forge/prism' }), /Missing relative module/);
});
test('incomplete producer output cannot be consumed even if candidate.json exists', t => {
  const root = fixture(t), value = manifest(root);
  writeFileSync(resolve(root, 'INCOMPLETE.txt'), 'failed final stage');
  assert.throws(() => candidate(writeManifest(root, value), value.sourceCommit), /did not complete/);
});
test('bundle check requires actual archive/runtime instances and rejects duplicates', t => {
  const root = fixture(t), platform = 'ios', dir = resolve(root, '_expo/static/js', platform);
  mkdirSync(dir, { recursive: true });
  const names = ['react', 'react-native', 'react-native-nitro-modules', 'nitro-core', 'zustand', '@nyc-tron/ui',
    ...['ignition', 'prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'].map(n => `@nitro-forge/${n}`)];
  const sources = names.map(name => {
    const instance = name.startsWith('@nitro-forge/') ? `${name.replace('/', '+')}@file+candidate.tgz` :
      name.startsWith('@nyc-tron/') ? '@nyc-tron+ui@https+github.com+NYC-Tron-UI+releases+download+v1.tgz' : `${name}@1`;
    return `node_modules/.pnpm/${instance}/node_modules/${name}/index.js`;
  });
  const map = resolve(dir, 'bundle.map');
  const script = fileURLToPath(new URL('./check-consumer-bundle.mjs', import.meta.url));
  writeFileSync(map, JSON.stringify({ sources }));
  execFileSync(process.execPath, [script, root, platform]);
  sources.push('node_modules/.pnpm/react@2/node_modules/react/index.js');
  writeFileSync(map, JSON.stringify({ sources }));
  assert.throws(() => execFileSync(process.execPath, [script, root, platform], { stdio: 'pipe' }), /Command failed/);
  sources.pop(); sources.pop();
  writeFileSync(map, JSON.stringify({ sources }));
  assert.throws(() => execFileSync(process.execPath, [script, root, platform], { stdio: 'pipe' }), /Command failed/);
});
