import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { files, hash, inside, json, requireDisk } from './archive-files.mjs';
import { lockChecksums, nativeClosure, NITRO_LICENSE_SHA256 } from './license-materials.mjs';
import { verifyRegistrySource } from './unpack-archive.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { native: { type: 'string' } } });
assert.ok(values.native, '--native merged platform artifact directory required');
const native = resolve(values.native), output = resolve(native, 'licenses');
assert.ok(!existsSync(output), 'License packet already exists; do not mutate candidate inputs');
requireDisk(root);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const inventory = json(resolve(root, 'tooling/release/package-inventory.json'));
const rust = execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim();
const lockSha = hash(resolve(root, 'Cargo.lock'));
for (const platform of ['apple', 'android']) {
  const fragment = json(resolve(native, `${platform}.json`));
  assert.equal(fragment.sourceCommit, sourceCommit);
  assert.equal(fragment.toolchain.rust, rust, 'Collect notices from the actual producing Rust toolchain');
  assert.equal(fragment.toolchain.cargoLockSha256, lockSha);
}
assert.ok(existsSync(resolve(root, 'LICENSE')), 'Authoritative original Forge license text is required');
assert.equal(hash(resolve(root, 'packages/ignition/licenses/Nitro-MIT.txt')), NITRO_LICENSE_SHA256);
// Metadata may fetch exact locked registry source archives on this CI runner.
// No native build, npm install, dependency update or license election occurs.
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const selected = nativeClosure(metadata);
const checksums = lockChecksums(readFileSync(resolve(root, 'Cargo.lock'), 'utf8'));
mkdirSync(output, { recursive: true });
const components = [];
function copy(source, destination) {
  const target = inside(output, destination);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  return { path: destination, sha256: hash(target) };
}
copy(resolve(root, 'LICENSE'), 'Forge-LICENSE');
copy(resolve(root, 'Cargo.lock'), 'Cargo.lock');
copy(resolve(root, 'packages/ignition/licenses/Nitro-MIT.txt'), 'Nitro-MIT.txt');
for (const pkg of selected) {
  const directory = dirname(pkg.manifest_path), key = `${pkg.name}-${pkg.version}`;
  const materials = [];
  if (!pkg.source) {
    const path = relative(root, directory);
    assert.ok(path && path !== '..' && !path.startsWith(`..${sep}`), `Unadmitted local dependency: ${pkg.id}`);
    assert.ok(inventory.nativeFirstPartyPaths.includes(path.split(sep).join('/')), `Local dependency needs file-level source admission; do not assume original ownership: ${pkg.id}`);
    assert.equal(pkg.license, 'MIT', `Original-code grant does not replace separate terms for ${pkg.id}`);
    for (const dir of [directory, dirname(directory)]) {
      const notice = resolve(dir, 'THIRD_PARTY_NOTICES.md');
      if (existsSync(notice)) materials.push(copy(notice, `components/${key}/${relative(root, dir).split(sep).join('_')}-NOTICES.md`));
    }
    materials.push(copy(pkg.manifest_path, `components/${key}/Cargo.toml`));
    components.push({ id: pkg.id, name: pkg.name, version: pkg.version, source: { repository: 'https://github.com/mikevocalz/nitro-forge', commit: sourceCommit, path }, licenseExpression: pkg.license, originalLicense: 'Forge-LICENSE', materials });
    continue;
  }
  assert.ok(pkg.source.startsWith('registry+'), `Non-registry source needs explicit source-admission materials: ${pkg.id}`);
  const checksum = checksums.get(`${pkg.name}@${pkg.version}|${pkg.source}`);
  assert.match(checksum ?? '', /^[0-9a-f]{64}$/, `Missing locked source checksum: ${pkg.id}`);
  // Cargo's verified, unmodified .crate is shipped too: this preserves actual
  // file-level headers/embedded notices, not just manifest license identifiers.
  const archive = resolve(directory, '..', '..', '..', 'cache', dirname(directory).split(sep).at(-1), `${key}.crate`);
  assert.equal(hash(archive), checksum, `Missing/changed locked source archive: ${pkg.id}`);
  materials.push(copy(archive, `sources/${key}.crate`));
  // Cargo cache layouts vary. Read materials only from the locked archive,
  // never from an assumed cache checksum file or a mutable extraction tree.
  const scratch = mkdtempSync(resolve(tmpdir(), 'forge-locked-crate-'));
  try {
    const source = verifyRegistrySource(archive, resolve(scratch, 'unpacked'), directory, { prefix: key, sha256: checksum });
    const sourceFiles = files(source);
    const licenses = sourceFiles.filter(path => /(?:^|\/)(?:licen[cs]e|copying|copyright|notice|authors)(?:[.\/_-]|$)/i.test(path) || /(?:^|\/)LICENSES\//i.test(path));
    if (pkg.license_file) licenses.push(relative(directory, resolve(directory, pkg.license_file)).split(sep).join('/'));
    assert.ok(licenses.length > 0, `No actual license/notice text for ${pkg.id}; requires source review`);
    for (const path of new Set(licenses)) materials.push(copy(inside(source, path), `components/${key}/${path}`));
    materials.push(copy(resolve(source, 'Cargo.toml'), `components/${key}/Cargo.toml`));
    const hashes = resolve(scratch, 'source-checksums.json');
    writeFileSync(hashes, JSON.stringify({ archiveSha256: checksum, files: Object.fromEntries(sourceFiles.map(path => [path, hash(inside(source, path))])) }, null, 2) + '\n');
    materials.push(copy(hashes, `components/${key}/source-checksums.json`));
    components.push({ id: pkg.id, name: pkg.name, version: pkg.version, source: pkg.source, repository: pkg.repository, checksum, licenseExpression: pkg.license, materials });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
const sysroot = execFileSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' }).trim();
const toolchain = [];
const noticeRoots = [sysroot, resolve(sysroot, 'share/doc/rust'), resolve(sysroot, 'share/doc/rustc')];
for (const name of ['LICENSE-MIT', 'LICENSE-APACHE', 'COPYRIGHT', 'COPYRIGHT-library.html']) {
  const file = noticeRoots.map(dir => resolve(dir, name)).find(existsSync);
  assert.ok(file, `Missing actual producing Rust toolchain ${name}; resolve notices before packing`);
  toolchain.push(copy(file, `rust-toolchain/${name}`));
}
for (const name of ['license-metadata.json', 'REUSE.toml', 'COPYRIGHT.html']) {
  const file = noticeRoots.map(dir => resolve(dir, name)).find(existsSync);
  if (file) toolchain.push(copy(file, `rust-toolchain/${name}`));
}
for (const directory of noticeRoots.map(dir => resolve(dir, 'licenses')).filter(existsSync)) {
  for (const path of files(directory)) toolchain.push(copy(inside(directory, path), `rust-toolchain/licenses/${path}`));
}
writeFileSync(resolve(output, 'provenance.json'), JSON.stringify({
  schemaVersion: 1, sourceCommit, cargoLockSha256: lockSha, originalLicenseSha256: hash(resolve(root, 'LICENSE')),
  closure: 'resolved nf-sys all-target normal/build superset; no dev-only or unrelated workspace roots',
  resolvedGraph: {
    packages: selected.map(({ id, name, version, source, license }) => ({ id, name, version, source, license })),
    resolve: { nodes: metadata.resolve.nodes.filter(n => selected.some(p => p.id === n.id)).map(n => ({ id: n.id, deps: n.deps.filter(d => d.dep_kinds.some(k => k.kind === null || k.kind === 'build')) })) },
  },
  components, toolchain: { rust, verbose: execFileSync('rustc', ['--version', '--verbose'], { encoding: 'utf8' }).trim(), materials: toolchain },
  licenseClassification: 'Not performed; declarations and complete source archives preserved verbatim. No new permissive classification or alternative-license election.',
  releaseLegalAcceptance: 'PENDING',
  files: files(output).map(path => ({ path, sha256: hash(resolve(output, path)) })),
}, null, 2) + '\n');
console.log(JSON.stringify({ stage: 'native-license-materials', sourceCommit, components: components.length }));
