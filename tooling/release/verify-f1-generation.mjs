/** Regenerate owned outputs and compare complete names+bytes, including files Git ignores. CI only. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const definitions = {
  ignition: { dir: 'packages/ignition/nitrogen/generated', file: 'packages/ignition/Package.swift', command: ['pnpm', '--filter', '@nitro-forge/ignition', 'codegen'] },
  persona: { dir: 'native/persona/nitro/nitrogen/generated', file: 'native/persona/nitro/Package.swift', command: ['pnpm', '--dir', 'native/persona/nitro', 'codegen'] },
};
export function walkFiles(base, output = {}) {
  if (!existsSync(base)) return output;
  if (lstatSync(base).isSymbolicLink()) throw new Error('Generated output cannot be a symlink: ' + base);
  if (lstatSync(base).isDirectory()) {
    for (const name of readdirSync(base).sort()) walkFiles(join(base, name), output);
  } else if (lstatSync(base).isFile()) output[base] = readFileSync(base);
  else throw new Error('Unexpected generated file kind: ' + base);
  return output;
}
export function differences(before, after) {
  return {
    added: Object.keys(after).filter(path => !(path in before)).sort(),
    deleted: Object.keys(before).filter(path => !(path in after)).sort(),
    changed: Object.keys(before).filter(path => path in after && !before[path].equals(after[path])).sort(),
  };
}
const unchanged = diff => Object.values(diff).every(paths => paths.length === 0);
export function verify(scope) {
  const spec = definitions[scope];
  if (!spec) throw new Error('Choose ignition or persona');
  const baseline = {};
  const tracked = execFileSync('git', ['ls-files', '-z', '--', spec.dir, spec.file], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  if (!tracked.some(path => path.startsWith(spec.dir + '/'))) throw new Error('No tracked canonical generated baseline');
  for (const path of tracked) baseline[path] = execFileSync('git', ['show', 'HEAD:' + path], { cwd: root });
  const actual = () => Object.fromEntries(Object.entries({ ...walkFiles(resolve(root, spec.dir)), ...walkFiles(resolve(root, spec.file)) }).map(([path, bytes]) => [relative(root, path), bytes]));
  const preDiff = differences(baseline, actual());
  if (!unchanged(preDiff)) throw new Error('Canonical generation inputs were already dirty: ' + JSON.stringify(preDiff));
  // Delete generated directories only. Preserve handwritten Package.swift content outside managed sections.
  rmSync(resolve(root, spec.dir), { recursive: true, force: true });
  const run = spawnSync(spec.command[0], spec.command.slice(1), { cwd: root, stdio: 'inherit', env: process.env });
  const generated = actual(); const diff = differences(baseline, generated);
  const manifest = tree => Object.fromEntries(Object.entries(tree).sort().map(([path, bytes]) => [path, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]));
  const result = { scope, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), command: spec.command, exitCode: run.status, error: run.error?.message ?? null, compared: [spec.dir, spec.file], baseline: manifest(baseline), actual: manifest(generated), differences: diff, passed: run.status === 0 && unchanged(diff), note: 'Complete filesystem inventory, including ignored/untracked additions. Generated directory removed before command. No native implementation/runtime proof.' };
  mkdirSync(resolve(root, 'reports/f1'), { recursive: true });
  writeFileSync(resolve(root, 'reports/f1/generation-' + scope + '.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ scope, exitCode: result.exitCode, differences: diff, passed: result.passed }));
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: verify-f1-generation.mjs ignition|persona');
  if (!verify(process.argv[2]).passed) process.exitCode = 1;
}
