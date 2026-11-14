import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkExports, checkSourceClosure, files, hash, inside, json, requireDisk } from './archive-files.mjs';
import { unpackArchive } from './unpack-archive.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { native: { type: 'string' }, output: { type: 'string' }, version: { type: 'string' } } });
assert.match(values.version ?? '', /^\d+\.\d+\.\d+-[a-zA-Z0-9.-]+$/, 'Explicit prerelease candidate --version required; no stable/publication operation');
assert.ok(values.native && values.output, '--native and --output required');
const native = resolve(values.native), output = resolve(values.output);
assert.ok(!existsSync(output), 'Candidate output already exists; never replace immutable bytes');
const inventory = json(resolve(root, 'tooling/release/package-inventory.json'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const payload = [];
for (const platform of ['apple', 'android']) {
  const fragment = json(resolve(native, `${platform}.json`));
  assert.equal(fragment.schemaVersion, 1);
  assert.equal(fragment.platform, platform);
  assert.equal(fragment.sourceCommit, sourceCommit, 'Native fragment/source identity mismatch');
  assert.equal(fragment.nitroVersion, inventory.runtime['react-native-nitro-modules']);
  assert.ok(fragment.files.length > 0);
  for (const entry of fragment.files) {
    const file = inside(native, entry.path);
    assert.equal(hash(file), entry.sha256, `Native fragment hash mismatch: ${entry.path}`);
    payload.push({ path: `native/${entry.path}`, sha256: entry.sha256 });
  }
}
assert.equal(hash(resolve(root, 'packages/ignition/cpp/nf_v1.h')), hash(resolve(root, 'rust/nf-sys/include/nf_v1.h')), 'Stale copied C ABI header');
const required = [
  'native/ForgeRust.xcframework/Info.plist',
  ...['ios-arm64', 'ios-arm64_x86_64-simulator'].flatMap(slice => [
    `native/ForgeRust.xcframework/${slice}/libnf_sys.a`, `native/ForgeRust.xcframework/${slice}/Headers/nf_v1.h`,
  ]),
  ...inventory.androidAbis.map(abi => `native/android/${abi}/libnf_sys.a`),
];
assert.equal(new Set(payload.map(p => p.path)).size, payload.length, 'Duplicate native fragment file');
for (const path of required) assert.ok(payload.some(p => p.path === path), `Incomplete native payload: ${path}`);
const reserve = payload.reduce((size, p) => size + statSync(inside(native, p.path.slice(7))).size, 0) * 4;
requireDisk(root, reserve);
const stage = mkdtempSync(resolve(tmpdir(), 'forge-candidate-'));
mkdirSync(output, { recursive: true });
const archives = [];
try {
  for (const name of inventory.packages) {
    const source = resolve(root, 'packages', name), target = resolve(stage, name, 'package');
    mkdirSync(target, { recursive: true });
    const pkg = json(resolve(source, 'package.json'));
    assert.equal(pkg.name, `@nitro-forge/${name}`);
    assert.ok(!pkg.private, `Private package cannot enter producer inventory: ${name}`);
    for (const item of pkg.files) {
      // Native payload is supplied only by identity-checked platform producers.
      if (item === 'native') continue;
      assert.ok(existsSync(inside(source, item)), `Allowlisted path missing: ${name}/${item}`);
      cpSync(inside(source, item), inside(target, item), { recursive: true });
    }
    if (name === 'ignition') {
      for (const entry of payload) {
        const dest = inside(target, entry.path);
        mkdirSync(resolve(dest, '..'), { recursive: true });
        cpSync(inside(native, entry.path.slice(7)), dest);
      }
      writeFileSync(resolve(target, 'native/assets.json'), JSON.stringify({
        schemaVersion: 1, sourceCommit, nitroVersion: inventory.runtime['react-native-nitro-modules'], files: payload,
        architectures: { ios: inventory.iosArchitectures, android: inventory.androidAbis },
      }, null, 2) + '\n');
    }
    pkg.version = values.version;
    pkg.packageManager = 'pnpm@12.18.0';
    delete pkg.devDependencies;
    delete pkg.scripts;
    for (const [dep, version] of Object.entries(pkg.dependencies ?? {})) {
      if (version.startsWith('workspace:')) {
        assert.ok(inventory.packages.some(n => dep === `@nitro-forge/${n}`));
        pkg.dependencies[dep] = values.version;
      }
    }
    writeFileSync(resolve(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    checkExports(target, pkg);
    assert.ok(files(target).length);
    const archive = `nitro-forge-${name}-${values.version}.tgz`;
    // Scripts were removed above: pack performs no product lifecycle build.
    // --out names the candidate; this never invokes publish/tag/release APIs.
    execFileSync('corepack', ['pnpm', 'pack', '--out', resolve(output, archive)], { cwd: target, stdio: 'inherit' });
    const packed = unpackArchive(resolve(output, archive), resolve(stage, `${name}-inspect`));
    const packedPkg = json(resolve(packed, 'package.json'));
    assert.equal(packedPkg.name, pkg.name);
    assert.equal(packedPkg.version, values.version);
    checkExports(packed, packedPkg);
    checkSourceClosure(packed, packedPkg);
    const stagedFiles = files(packed);
    archives.push({ name: pkg.name, version: pkg.version, archive, sha256: hash(resolve(output, archive)),
      contents: stagedFiles.map(path => ({ path, sha256: hash(resolve(packed, path)) })) });
  }
  writeFileSync(resolve(output, 'candidate.json'), JSON.stringify({
    schemaVersion: 1, sourceCommit, version: values.version, runtime: inventory.runtime,
    archives, deferred: inventory.deferred, deferralReason: inventory.deferralReason,
    nativeFragments: ['apple', 'android'].map(p => ({ platform: p, manifestSha256: hash(resolve(native, `${p}.json`)) })),
    publicationAuthorized: false, nativeRuntimeAcceptance: 'NOT RUN',
  }, null, 2) + '\n');
  writeFileSync(resolve(output, 'SHA256SUMS'), archives.map(a => `${a.sha256}  ${a.archive}`).join('\n') + '\n');
  console.log(JSON.stringify({ stage: 'candidate-archives', sourceCommit, archives: archives.length, output }));
} catch (error) {
  // Partial candidates cannot be mistaken for complete immutable output.
  writeFileSync(resolve(output, 'INCOMPLETE.txt'), String(error) + '\n');
  throw error;
} finally { rmSync(stage, { recursive: true, force: true }); }
