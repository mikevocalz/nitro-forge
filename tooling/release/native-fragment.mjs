import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { files, hash, json, requireDisk } from './archive-files.mjs';
import { lockChecksums, registrySourceRecords } from './license-materials.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: {
  platform: { type: 'string' }, output: { type: 'string' }, readobj: { type: 'string' },
} });
assert.ok(['apple', 'android'].includes(values.platform), '--platform apple|android required');
assert.ok(values.output, '--output required (new directory)');
const output = resolve(values.output);
assert.ok(!existsSync(output), `Refusing to overwrite ${output}`);
requireDisk(root);
const inventory = json(resolve(root, 'tooling/release/package-inventory.json'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const native = resolve(root, 'packages/ignition/native');
const toolchain = {
  rust: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(),
  cargo: execFileSync('cargo', ['--version'], { encoding: 'utf8' }).trim(),
  cargoLockSha256: hash(resolve(root, 'Cargo.lock')),
};
const folders = values.platform === 'apple' ? ['ForgeRust.xcframework'] : ['android'];
for (const folder of folders) files(resolve(native, folder)); // Reject producer symlinks before copy.
if (values.platform === 'apple') {
  toolchain.xcode = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim();
  toolchain.swift = execFileSync('swift', ['--version'], { encoding: 'utf8' }).trim();
  const framework = resolve(native, folders[0]);
  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', resolve(framework, 'Info.plist')], { encoding: 'utf8' }));
  assert.equal(plist.AvailableLibraries.length, 2, 'Expected device and universal simulator slices');
  for (const [variant, archs] of [['device', ['arm64']], ['simulator', ['arm64', 'x86_64']]]) {
    const slice = plist.AvailableLibraries.find(s => s.SupportedPlatform === 'ios' && (s.SupportedPlatformVariant ?? 'device') === variant);
    assert.ok(slice, `Missing iOS ${variant}`);
    assert.deepEqual([...slice.SupportedArchitectures].sort(), [...archs].sort());
    // The current Apple lipo parser treats a second verify_arch argument as
    // another input file. Verify each required architecture independently.
    for (const arch of archs) execFileSync('lipo', [resolve(framework, slice.LibraryIdentifier, slice.LibraryPath), '-verify_arch', arch]);
    assert.equal(hash(resolve(framework, slice.LibraryIdentifier, slice.HeadersPath, 'nf_v1.h')), hash(resolve(root, 'rust/nf-sys/include/nf_v1.h')));
  }
} else {
  assert.ok(values.readobj, '--readobj must name the producing NDK llvm-readobj');
  toolchain.readobj = execFileSync(values.readobj, ['--version'], { encoding: 'utf8' }).trim();
  const expected = { 'armeabi-v7a': 'EM_ARM', 'arm64-v8a': 'EM_AARCH64', x86: 'EM_386', x86_64: 'EM_X86_64' };
  for (const abi of inventory.androidAbis) {
    const lib = resolve(native, 'android', abi, 'libnf_sys.a');
    assert.equal(readFileSync(lib).subarray(0, 8).toString(), '!<arch>\n');
    const headers = execFileSync(values.readobj, ['--file-headers', lib], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const machines = [...headers.matchAll(/Machine:\s+(EM_\w+)/g)].map(m => m[1]);
    assert.ok(machines.length > 0 && machines.every(m => m === expected[abi]), `Unexpected object architecture in ${abi}`);
  }
}
mkdirSync(output, { recursive: true });
for (const folder of folders) cpSync(resolve(native, folder), resolve(output, folder), { recursive: true });
const payload = files(output).map(path => ({ path, sha256: hash(resolve(output, path)) }));
// Bind post-build source bytes on this actual producing runner, not a later
// assembly runner's independent Cargo extraction. No source mutation follows.
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const registrySources = registrySourceRecords(metadata, lockChecksums(readFileSync(resolve(root, 'Cargo.lock'), 'utf8')));
writeFileSync(resolve(output, `${values.platform}.json`), JSON.stringify({
  schemaVersion: 1, platform: values.platform, sourceCommit,
  nitroVersion: inventory.runtime['react-native-nitro-modules'], toolchain, files: payload, registrySources,
}, null, 2) + '\n');
console.log(JSON.stringify({ stage: 'native-fragment', platform: values.platform, sourceCommit, files: payload.length }));
