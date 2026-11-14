import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUses, overridesFromWorkspace, disposition } from './f1-freshness.mjs';
import { outcome } from './record-f1-command.mjs';
test('inventory covers isolated/native peers, root package manager, optional and override declarations', () => {
 const rows = collectUses({ 'native/pkg/package.json': { peerDependencies: { host: '>=1' }, optionalDependencies: { decoder: '1.0.0' } }, 'package.json': { packageManager: 'pnpm@12.18.0', pnpm: { overrides: { nested: '2.0.0' } } } }, { metro: '0.87.2' });
 assert.deepEqual(rows.map(row => [row.name, row.group]), [['host', 'peerDependencies'], ['decoder', 'optionalDependencies'], ['nested', 'pnpm.overrides'], ['pnpm', 'packageManager'], ['metro', 'overrides']]);
});
test('workspace override parser stops at other sections and rejects nested syntax', () => {
 assert.deepEqual(overridesFromWorkspace('overrides:\n  metro: 0.87.2\n  "@scope/pkg": 1.0.0\npatchedDependencies:\n  other: patch\n'), { metro: '0.87.2', '@scope/pkg': '1.0.0' });
 assert.throws(() => overridesFromWorkspace('overrides:\n  package:\n    nested: 1\n'), /Unsupported/);
});
test('freshness does not downgrade v1 to npm stable or pass unavailable/unreviewed versions', () => {
 assert.equal(disposition({ name: 'nitrogen', spec: '1.0.0-alpha.nightly.136', group: 'devDependencies' }, '0.37.1', { nitrogen: 'Accepted exact v1 trio' }).action, 'hold');
 assert.equal(disposition({ name: 'expo', spec: '58.0.24', group: 'dependencies' }, '58.0.25', {}).action, 'review-required');
 assert.equal(disposition({ name: 'missing', spec: '1.0.0', group: 'dependencies' }, null, {}).action, 'registry-unavailable');
 assert.equal(disposition({ name: '@nitro-forge/persona-native', spec: 'link:../../native/persona/nitro', group: 'dependencies' }, null, {}).action, 'internal-workspace');
});
test('required failures and process launch failures fail; nonzero freshness remains review-required', () => {
 assert.equal(outcome(1, 'required'), 'failed'); assert.equal(outcome(null, 'freshness'), 'failed');
 assert.equal(outcome(1, 'freshness'), 'review-required'); assert.equal(outcome(2, 'freshness'), 'failed');
});
test('recorder retains actual nonzero exit and both output streams without reporting pass', async () => {
 const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
 const { join } = await import('node:path');
 const { record } = await import('./record-f1-command.mjs');
 const dir = mkdtempSync(join(process.cwd(), '.f1-recorder-test-'));
 try {
  const result = await record({ name: 'nonzero', mode: 'freshness', output: dir, command: [process.execPath, '-e', 'process.stdout.write("actual stdout\\n"); process.stderr.write("actual stderr\\n"); process.exitCode=1'] });
  assert.equal(result.exitCode, 1); assert.equal(result.outcome, 'review-required');
  const log = readFileSync(join(dir, 'nonzero.log'), 'utf8'); assert.match(log, /actual stdout/); assert.match(log, /actual stderr/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'nonzero.json'), 'utf8')).exitCode, 1);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
