import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'rust-archive': { type: 'string' }, cmake: { type: 'string', default: 'cmake' },
  output: { type: 'string' },
} });
if (!values['rust-archive'] || !path.isAbsolute(values['rust-archive'])) {
  throw new Error('Supply --rust-archive with an absolute nf-sys static archive built from this revision.');
}
const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, '../../..');
const work = values.output ? path.resolve(values.output) : mkdtempSync(path.join(tmpdir(), 'ignition-consumer-'));
mkdirSync(work, { recursive: true });
const run = (command, args, cwd = work) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work],
  path.join(root, 'packages/ignition')))[0];
const installed = path.join(work, 'node_modules/@nitro-forge/ignition');
mkdirSync(installed, { recursive: true });
run('tar', ['-xzf', path.join(work, packed.filename), '--strip-components=1', '-C', installed]);
writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'installed-ignition-consumer', private: true }));
const require = createRequire(path.join(work, 'package.json'));
assert.equal(require.resolve('@nitro-forge/ignition/native'), path.join(installed, 'CMakeLists.txt'));
assert.equal(require.resolve('@nitro-forge/ignition/package.json'), path.join(installed, 'package.json'));
for (const name of ['ForgeFactory', 'ForgeDocument', 'ForgeMediaCache', 'ForgeTask']) {
  assert.equal(readFileSync(path.join(installed, `nitrogen/generated/apple/c++/Hybrid${name}SpecClass.cpp`), 'utf8'),
    readFileSync(path.join(installed, `nitrogen/generated/android/c++/Hybrid${name}SpecClass.cpp`), 'utf8'),
    `${name} needs a portable generation strategy if its platform class bindings diverge`);
}
console.log(run(values.cmake, ['-S', fixture, '-B', path.join(work, 'build'),
  `-DIGNITION_PACKAGE_ROOT=${installed}`, `-DNITRO_FORGE_RUST_ARCHIVE=${values['rust-archive']}`,
  '-DCMAKE_BUILD_TYPE=Release']));
console.log(run(values.cmake, ['--build', path.join(work, 'build'), '--parallel', '2']));
const executable = path.join(work, 'build', process.platform === 'win32' ? 'ignition_consumer.exe' : 'ignition_consumer');
const runtimeOutput = run(executable, []);
assert.match(runtimeOutput, /INSTALLED_IGNITION_OK engines=11 reopen=11/);
const receipt = { package: packed.name, version: packed.version, integrity: packed.integrity,
  packedFile: path.join(work, packed.filename), installed, rustArchive: values['rust-archive'],
  host: process.platform, architecture: process.arch, runtimeOutput: runtimeOutput.trim(),
  evidenceScope: 'Packed native C++ consumer; not a Qt, QNX, Marathon, or JavaScript runtime receipt.' };
writeFileSync(path.join(work, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
