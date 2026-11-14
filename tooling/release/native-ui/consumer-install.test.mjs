import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consumerInstallArgs } from '../consumer-install.mjs';
import { requireDisk } from '../archive-files.mjs';

test('actual PNPM manager-only lock requires first resolution; completed graph reuse stays frozen', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-pnpm-lock-mode-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  requireDisk(root, 64 * 1024 * 1024);
  const source = resolve(root, 'source'), app = resolve(root, 'app');
  mkdirSync(resolve(source, 'package'), { recursive: true }); mkdirSync(app);
  // Tiny package-manager fixture only: no engine, native API or product UI.
  writeFileSync(resolve(source, 'package/package.json'), JSON.stringify({ name: 'forge-package-manager-fixture', version: '0.0.1', main: 'index.js' }));
  writeFileSync(resolve(source, 'package/index.js'), 'module.exports = {};\n');
  execFileSync('tar', ['-czf', resolve(app, 'fixture.tgz'), '-C', source, 'package']);
  const manifest = { name: 'forge-pnpm-lock-mode-test', private: true, version: '0.0.0', packageManager: 'pnpm@12.18.0', dependencies: { 'forge-package-manager-fixture': 'file:./fixture.tgz' } };
  writeFileSync(resolve(app, 'package.json'), JSON.stringify(manifest));
  writeFileSync(resolve(app, 'pnpm-workspace.yaml'), 'packages:\n  - "."\nminimumReleaseAge: 0\nnodeLinker: isolated\nenableGlobalVirtualStore: false\n');
  const options = { cwd: app, encoding: 'utf8', env: { ...process.env, CI: '1' } };
  execFileSync('corepack', ['pnpm', '--version'], options);
  const fixture = fileURLToPath(new URL('../test-fixtures/pnpm12-manager-only.yaml', import.meta.url));
  cpSync(fixture, resolve(app, 'pnpm-lock.yaml'));
  const original = readFileSync(resolve(app, 'pnpm-lock.yaml'), 'utf8');
  assert.ok(original.includes('packageManagerDependencies:'));
  assert.ok(!original.includes('forge-package-manager-fixture'));
  const invoke = args => execFileSync('corepack', args, options);
  assert.throws(() => invoke(consumerInstallArgs({ frozen: true, stages: ['prepare'] })), error => /ERR_PNPM_(?:NO_LOCKFILE|OUTDATED_LOCKFILE)/.test(String(error.stderr) + String(error.stdout)));
  invoke(consumerInstallArgs({ stages: ['prepare'] }));
  assert.ok(readFileSync(resolve(app, 'pnpm-lock.yaml'), 'utf8').includes('forge-package-manager-fixture'));
  invoke(consumerInstallArgs({ frozen: true, stages: ['prepare'] }));
  for (const stages of [['prepare', 'install'], ['prepare', 'install:ios'], ['prepare', 'install:android']]) {
    assert.ok(consumerInstallArgs({ frozen: false, stages }).includes('--frozen-lockfile'));
  }
  manifest.dependencies['forge-package-manager-fixture'] = '9.9.9';
  writeFileSync(resolve(app, 'package.json'), JSON.stringify(manifest));
  assert.throws(() => invoke(consumerInstallArgs({ stages: ['prepare', 'install'] })), error => /ERR_PNPM_(?:NO_LOCKFILE|OUTDATED_LOCKFILE)/.test(String(error.stderr) + String(error.stdout)));
});
