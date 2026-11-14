import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { candidate } from './candidate-manifest.mjs';
import { assertInstalledInside, checkExports, checkSourceClosure, files, hash, inside } from './archive-files.mjs';
import { unpackArchive, verifyRegistrySource } from './unpack-archive.mjs';
import { fileURLToPath } from 'node:url';
import { checkLicenseMembers, checkProducerSources, nativeClosure, RUST_ROOT_NOTICES, rustCompilerSource, rustNoticeUrl } from './license-materials.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-archive-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function syntheticToolchain(materials) {
  // Structural test data only, never compiled/native license evidence.
  const commitHash = 'd'.repeat(40), identity = { commitHash, release: '1.100.0' };
  return { sourceCommit: commitHash, verbose: `rustc 1.100.0\ncommit-hash: ${commitHash}\nrelease: 1.100.0`,
    producerCompilerSources: { apple: identity, android: identity },
    materials: materials.map(material => {
      const name = material.path.slice('rust-toolchain/'.length);
      return RUST_ROOT_NOTICES.includes(name) ? { ...material, origin: { kind: 'upstream-compiler-source', compilerCommitHash: commitHash, url: rustNoticeUrl(commitHash, name) } } : material;
    }),
  };
}
test('Rust notice sources require exact producing compiler commits and admitted root files', () => {
  const commitHash = '0ef1bc386059596dada8fb65b50425aab2ea637a';
  assert.deepEqual(rustCompilerSource(`rustc 1.100.0\ncommit-hash: ${commitHash}\nrelease: 1.100.0\nhost: x86_64-unknown-linux-gnu`), { commitHash, release: '1.100.0' });
  assert.throws(() => rustCompilerSource('commit-hash: unknown\nrelease: 1.100.0'), /Exact stable/);
  assert.throws(() => rustNoticeUrl('stable', 'LICENSE-MIT'));
  assert.throws(() => rustNoticeUrl(commitHash, '../LICENSE-MIT'), /admitted/);
  assert.equal(rustNoticeUrl(commitHash, 'LICENSE-MIT'), `https://raw.githubusercontent.com/rust-lang/rust/${commitHash}/LICENSE-MIT`);
});
test('packed native materials bind notices, Cargo.lock and both producing source inventories', t => {
  // Synthetic structural packet only; no native license or compatibility proof.
  const root = fixture(t), packetRoot = resolve(root, 'native/licenses');
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  mkdirSync(resolve(root, 'licenses'), { recursive: true });
  cpSync(resolve(repository, 'LICENSE'), resolve(root, 'LICENSE'));
  cpSync(resolve(repository, 'packages/ignition/licenses/Nitro-MIT.txt'), resolve(root, 'licenses/Nitro-MIT.txt'));
  writeFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'Synthetic packet test only');
  const material = (path, bytes) => {
    mkdirSync(resolve(packetRoot, path, '..'), { recursive: true });
    writeFileSync(resolve(packetRoot, path), bytes);
    return { path, sha256: hash(resolve(packetRoot, path)) };
  };
  const nf = material('components/nf/Cargo.toml', 'synthetic original manifest');
  const crate = material('sources/tiny-1.0.0.crate', 'synthetic source bytes; not a real native source archive');
  const notice = material('components/tiny/LICENSE', 'synthetic upstream notice');
  const source = 'registry+https://github.com/rust-lang/crates.io-index';
  const lock = material('Cargo.lock', `version = 4\n\n[[package]]\nname = "tiny"\nversion = "1.0.0"\nsource = "${source}"\nchecksum = "${crate.sha256}"\n`);
  const hashes = { archiveSha256: crate.sha256, files: { LICENSE: notice.sha256 } };
  const inventory = material('components/tiny/source-checksums.json', JSON.stringify(hashes));
  const toolchain = ['LICENSE-MIT', 'LICENSE-APACHE', 'COPYRIGHT', 'COPYRIGHT-library.html'].map(name => material(`rust-toolchain/${name}`, 'synthetic toolchain notice'));
  const producer = { id: 'tiny', checksum: crate.sha256, files: hashes.files };
  const packet = { schemaVersion: 1, sourceCommit: 'a'.repeat(40), originalLicenseSha256: hash(resolve(root, 'LICENSE')), cargoLockSha256: lock.sha256,
    files: [nf, crate, notice, lock, inventory, ...toolchain], toolchain: syntheticToolchain(toolchain),
    producerRegistrySources: { apple: [structuredClone(producer)], android: [structuredClone(producer)] },
    resolvedGraph: { packages: [{ id: 'nf', name: 'nf-sys', source: null, license: 'MIT' }, { id: 'tiny', name: 'tiny', version: '1.0.0', source, license: 'MIT OR Apache-2.0' }], resolve: { nodes: [{ id: 'nf', deps: [{ pkg: 'tiny', dep_kinds: [{ kind: null }] }] }, { id: 'tiny', deps: [] }] } },
    components: [{ id: 'nf', licenseExpression: 'MIT', materials: [nf] }, { id: 'tiny', checksum: crate.sha256, licenseExpression: 'MIT OR Apache-2.0', notices: [notice], materials: [crate, notice, inventory] }],
  };
  const check = () => { writeFileSync(resolve(packetRoot, 'provenance.json'), JSON.stringify(packet)); checkLicenseMembers(root, { name: '@nitro-forge/ignition', license: 'MIT' }, packet.originalLicenseSha256, packet.sourceCommit); };
  check();
  packet.toolchain.producerCompilerSources.android = { commitHash: 'e'.repeat(40), release: '1.100.0' };
  assert.throws(check, /producing Rust source differs/);
  packet.toolchain.producerCompilerSources.android = { commitHash: packet.toolchain.sourceCommit, release: '1.100.0' };
  packet.toolchain.materials[0].origin.url = 'https://raw.githubusercontent.com/rust-lang/rust/stable/LICENSE-MIT';
  assert.throws(check);
  packet.toolchain.materials[0].origin.url = rustNoticeUrl(packet.toolchain.sourceCommit, 'LICENSE-MIT');
  packet.producerRegistrySources.android[0].files.LICENSE = 'b'.repeat(64);
  assert.throws(check, /android compiled source differs/);
  packet.producerRegistrySources.android[0] = structuredClone(producer);
  packet.components[1].checksum = 'c'.repeat(64);
  assert.throws(check, /differs from Cargo.lock/);
  packet.components[1].checksum = crate.sha256;
  packet.components[1].notices = [];
  assert.throws(check, /Missing actual registry notice/);
});
test('both actual producer source inventories must match verified crate bytes and closure', () => {
  const verified = { archiveSha256: 'a'.repeat(64), files: { 'src/lib.rs': 'b'.repeat(64), LICENSE: 'c'.repeat(64) } };
  const record = { id: 'registry-tiny', checksum: verified.archiveSha256, files: { ...verified.files } };
  const producers = { apple: [structuredClone(record)], android: [structuredClone(record)] };
  checkProducerSources(producers, [record.id], record.id, verified);
  assert.throws(() => checkProducerSources({ apple: [] }, [record.id], record.id, verified), /closure differs/);
  producers.android[0].files['src/lib.rs'] = 'd'.repeat(64);
  assert.throws(() => checkProducerSources(producers, [record.id], record.id, verified), /android compiled source differs/);
  producers.android = [structuredClone(record)];
  producers.apple[0].checksum = 'e'.repeat(64);
  assert.throws(() => checkProducerSources(producers, [record.id], record.id, verified), /apple producer locked archive differs/);
});
test('locked crates with SemVer build metadata bind cache bytes with present or absent Cargo bookkeeping', t => {
  const root = fixture(t), source = resolve(root, 'source'), cache = resolve(root, 'cache');
  mkdirSync(resolve(source, 'wasip2-1.0.4+wasi-0.2.12'), { recursive: true });
  writeFileSync(resolve(source, 'wasip2-1.0.4+wasi-0.2.12/LICENSE'), 'Synthetic test notice');
  writeFileSync(resolve(source, 'wasip2-1.0.4+wasi-0.2.12/Cargo.toml'), '[package]\nname="tiny"\n');
  cpSync(resolve(source, 'wasip2-1.0.4+wasi-0.2.12'), cache, { recursive: true });
  const archive = resolve(root, 'tiny.crate');
  execFileSync('tar', ['-czf', archive, '-C', source, 'wasip2-1.0.4+wasi-0.2.12']);
  const identity = { prefix: 'wasip2-1.0.4+wasi-0.2.12', sha256: hash(archive) };
  verifyRegistrySource(archive, resolve(root, 'absent'), cache, identity);
  writeFileSync(resolve(cache, '.cargo-ok'), 'generated');
  writeFileSync(resolve(cache, '.cargo-checksum.json'), '{}');
  verifyRegistrySource(archive, resolve(root, 'present'), cache, identity);
  assert.throws(() => verifyRegistrySource(archive, resolve(root, 'wrong-hash'), cache, { ...identity, sha256: '0'.repeat(64) }), /checksum/);
  assert.throws(() => verifyRegistrySource(resolve(root, 'missing.crate'), resolve(root, 'missing'), cache, identity), /ENOENT/);
  assert.throws(() => verifyRegistrySource(archive, resolve(root, 'wrong-root'), cache, { ...identity, prefix: 'other-1.0.0' }), /prefix/);
  writeFileSync(resolve(cache, 'LICENSE'), 'tampered');
  assert.throws(() => verifyRegistrySource(archive, resolve(root, 'tampered'), cache, identity), /bytes differ/);
  writeFileSync(resolve(cache, 'extra.rs'), 'unproven source');
  assert.throws(() => verifyRegistrySource(archive, resolve(root, 'extra'), cache, identity), /inventory differs/);
  writeFileSync(archive, 'tampered archive');
  assert.throws(() => verifyRegistrySource(archive, resolve(root, 'changed-archive'), cache, identity), /checksum/);
});
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
test('installed runtime resolution cannot escape into a global or checkout dependency', t => {
  const root = fixture(t), app = resolve(root, 'app');
  mkdirSync(resolve(app, 'node_modules'), { recursive: true });
  writeFileSync(resolve(root, 'outside.js'), 'external runtime fixture');
  symlinkSync(resolve(root, 'outside.js'), resolve(app, 'node_modules/runtime.js'));
  assert.throws(() => assertInstalledInside(app, resolve(app, 'node_modules/runtime.js')), /escapes clean consumer/);
  writeFileSync(resolve(app, 'node_modules/local.js'), 'local runtime fixture');
  assert.doesNotThrow(() => assertInstalledInside(app, resolve(app, 'node_modules/local.js')));
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
        cargoLockSha256: lock.sha256, files: [manifest, lock, ...toolchain], toolchain: syntheticToolchain(toolchain),
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
