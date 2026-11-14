import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { candidate } from './candidate-manifest.mjs';
import { checkExports, checkSourceClosure, files, hash, inside } from './archive-files.mjs';
import { unpackArchive } from './unpack-archive.mjs';
import { fileURLToPath } from 'node:url';
import { checkLicenseMembers, nativeClosure } from './license-materials.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-archive-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function manifest(root) {
  const names = ['ignition', 'prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'];
  const value = { schemaVersion: 1, sourceCommit: 'a'.repeat(40), version: '1.0.0-test.1', originalLicenseSha256: 'c'.repeat(64), deferred: ['photo', 'motion', 'design', 'draft', 'scene'], archives: names.map(n => {
    const archive = `nitro-forge-${n}-1.0.0-test.1.tgz`;
    writeFileSync(resolve(root, archive), 'test fixture, not a native package');
    return { name: `@nitro-forge/${n}`, version: '1.0.0-test.1', archive, sha256: hash(resolve(root, archive)), contents: [{ path: 'package.json', sha256: 'b'.repeat(64) }, { path: 'LICENSE', sha256: 'c'.repeat(64) }] };
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
  value.archives[0].contents = [{ path: 'LICENSE', sha256: 'c'.repeat(64) }, { path: 'src/index.ts', sha256: 'b'.repeat(64) }, { path: 'src/index.ts', sha256: 'c'.repeat(64) }];
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

test('prepare keeps archive specifiers and hashes portable across distinct consumer and candidate roots', t => {
  // Tiny synthetic packages exercise real prepare/extract/copy boundaries only.
  // They contain no native payload and are not native compatibility evidence.
  const root = fixture(t);
  const firstCandidate = resolve(root, 'linux-candidate');
  const secondCandidate = resolve(root, 'macos-candidate');
  mkdirSync(firstCandidate);
  const value = manifest(firstCandidate);
  value.runtime = { expo: '58.0.24', react: '19.3.1', 'react-native': '0.88.1',
    'react-native-nitro-modules': '1.0.0-alpha.nightly.136.gdb81de61bd32',
    'nitro-core': '1.0.0-alpha.nightly.136.gdb81de61bd32' };
  const source = resolve(root, 'synthetic');
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  value.originalLicenseSha256 = hash(resolve(repository, 'LICENSE'));
  for (const archive of value.archives) {
    rmSync(resolve(source, 'package'), { recursive: true, force: true });
    mkdirSync(resolve(source, 'package/src'), { recursive: true });
    const metadata = resolve(source, 'package/package.json');
    const module = resolve(source, 'package/src/index.ts');
    writeFileSync(metadata, JSON.stringify({ name: archive.name, version: value.version,
      license: 'MIT', type: 'module', main: './src/index.ts', types: './src/index.ts', exports: { '.': './src/index.ts' } }));
    writeFileSync(module, 'export {};\n');
    cpSync(resolve(repository, 'LICENSE'), resolve(source, 'package/LICENSE'));
    if (archive.name === '@nitro-forge/ignition') {
      mkdirSync(resolve(source, 'package/licenses'));
      mkdirSync(resolve(source, 'package/native/licenses'), { recursive: true });
      cpSync(resolve(repository, 'packages/ignition/licenses/Nitro-MIT.txt'), resolve(source, 'package/licenses/Nitro-MIT.txt'));
      writeFileSync(resolve(source, 'package/THIRD_PARTY_NOTICES.md'), 'Synthetic packaging test only; not a native license packet.\n');
      // Structural test data only. No native binary/license approval is claimed.
      const packet = resolve(source, 'package/native/licenses');
      const material = path => {
        mkdirSync(resolve(packet, path, '..'), { recursive: true });
        writeFileSync(resolve(packet, path), 'Synthetic test data only; not distributed as native materials.\n');
        return { path, sha256: hash(resolve(packet, path)) };
      };
      const manifest = material('components/nf-sys/Cargo.toml');
      const lock = material('Cargo.lock');
      const toolchain = ['LICENSE-MIT', 'LICENSE-APACHE', 'COPYRIGHT', 'COPYRIGHT-library.html'].map(name => material(`rust-toolchain/${name}`));
      writeFileSync(resolve(packet, 'provenance.json'), JSON.stringify({
        fixtureOnly: true, schemaVersion: 1, sourceCommit: value.sourceCommit, originalLicenseSha256: value.originalLicenseSha256,
        cargoLockSha256: lock.sha256, files: [manifest, lock, ...toolchain], toolchain: { materials: toolchain },
        resolvedGraph: { packages: [{ id: 'nf', name: 'nf-sys', source: null, license: 'MIT' }], resolve: { nodes: [{ id: 'nf', deps: [] }] } },
        components: [{ id: 'nf', name: 'nf-sys', licenseExpression: 'MIT', materials: [manifest] }],
      }));
    }
    execFileSync('tar', ['-czf', resolve(firstCandidate, archive.archive), '-C', source, 'package']);
    archive.sha256 = hash(resolve(firstCandidate, archive.archive));
    archive.contents = files(resolve(source, 'package')).map(path => ({ path, sha256: hash(resolve(source, 'package', path)) }));
  }
  writeManifest(firstCandidate, value);
  cpSync(firstCandidate, secondCandidate, { recursive: true });
  const script = fileURLToPath(new URL('./consumer-smoke.mjs', import.meta.url));
  const consumers = [resolve(root, 'linux-app'), resolve(root, 'macos-app')];
  for (const [index, candidateRoot] of [firstCandidate, secondCandidate].entries()) {
    execFileSync(process.execPath, [script, '--manifest', resolve(candidateRoot, 'candidate.json'),
      '--output', consumers[index], '--expected-source', value.sourceCommit, '--stage', 'prepare'], { stdio: 'pipe' });
  }
  const packages = consumers.map(app => JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8')));
  assert.deepEqual(packages[0].dependencies, packages[1].dependencies);
  assert.deepEqual(packages[0].pnpm.overrides, packages[1].pnpm.overrides);
  for (const archive of value.archives) {
    assert.equal(packages[0].dependencies[archive.name], `file:./artifacts/${archive.archive}`);
    for (const app of consumers) assert.equal(hash(resolve(app, 'artifacts', archive.archive)), archive.sha256);
  }
  const receipts = consumers.map(app => JSON.parse(readFileSync(resolve(app, 'forge-consumer-receipt.json'), 'utf8')));
  assert.equal(receipts[0].manifestSha256, receipts[1].manifestSha256);
});
test('required original and native license materials fail closed before packing/consumption', t => {
  const root = fixture(t);
  assert.throws(() => checkLicenseMembers(root, { name: '@nitro-forge/prism', license: 'MIT' }, 'c'.repeat(64)), /ENOENT/);
  writeFileSync(resolve(root, 'LICENSE'), 'fixture only');
  const original = hash(resolve(root, 'LICENSE'));
  assert.throws(() => checkLicenseMembers(root, { name: '@nitro-forge/prism' }, original), /license metadata/);
  assert.throws(() => checkLicenseMembers(root, { name: '@nitro-forge/ignition', license: 'MIT' }, original), /generated\/native notices/);
});
test('resolved native closure excludes dev-only/unrelated roots and refuses unknown license declarations', () => {
  const metadata = {
    packages: [{ id: 'nf', name: 'nf-sys', source: null, license: 'MIT' }, { id: 'runtime', name: 'runtime', source: 'registry+x', license: 'MIT OR Apache-2.0' }, { id: 'dev', name: 'dev', source: null, license: 'AGPL-3.0' }],
    resolve: { nodes: [{ id: 'nf', deps: [{ pkg: 'runtime', dep_kinds: [{ kind: null }] }, { pkg: 'dev', dep_kinds: [{ kind: 'dev' }] }] }, { id: 'runtime', deps: [] }, { id: 'dev', deps: [] }] },
  };
  assert.deepEqual(nativeClosure(metadata).map(p => p.name).sort(), ['nf-sys', 'runtime']);
  assert.equal(nativeClosure(metadata).find(p => p.name === 'runtime').license, 'MIT OR Apache-2.0');
  metadata.packages[1].license = null;
  assert.throws(() => nativeClosure(metadata), /Unresolved license declaration/);
  assert.throws(() => nativeClosure({ packages: metadata.packages }), /Full resolved/);
});
