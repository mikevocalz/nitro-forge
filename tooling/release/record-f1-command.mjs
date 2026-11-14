/** Record original command output, source identity and actual exit status; never turn a test failure into success. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function outcome(code, mode) {
  if (code === 0) return 'success';
  if (mode === 'freshness' && code === 1) return 'review-required';
  return 'failed';
}
export async function record({ name, mode, command, cwd = process.cwd(), output = 'reports/f1' }) {
  if (!/^[a-z0-9-]+$/.test(name) || !['required', 'freshness'].includes(mode) || !command.length) throw new Error('Invalid recorder arguments');
  mkdirSync(output, { recursive: true });
  const start = new Date().toISOString();
  const stream = createWriteStream(resolve(output, name + '.log'));
  const child = spawn(command[0], command.slice(1), { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { stream.write(data); process.stdout.write(data); });
  const code = await new Promise(resolveResult => {
    child.once('error', error => { stream.write(error.message + '\n'); resolveResult(null); });
    child.once('close', resolveResult);
  });
  await new Promise(resolveResult => stream.end(resolveResult));
  const result = { name, command, cwd, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(), startedAtUTC: start, finishedAtUTC: new Date().toISOString(), exitCode: code, outcome: outcome(code, mode), note: mode === 'freshness' ? 'Exit1 is retained as review-required, not passed: inspect full output for outdated items versus command errors. No dependency admission or gate signature.' : 'Required command failures remain failures.' };
  writeFileSync(resolve(output, name + '.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, mode, separator, ...command] = process.argv.slice(2);
  if (separator !== '--') throw new Error('Usage: record-f1-command.mjs name required|freshness -- command [args]');
  const result = await record({ name, mode, command });
  if (result.outcome === 'failed') process.exitCode = 1;
}
