/** Inventory every tracked package manifest, including peers and isolated/native packages. No installs. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const groups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
export function overridesFromWorkspace(text) {
  const block = /^overrides:\s*\n([\s\S]*?)(?=^[^\s#]|$(?![\s\S]))/m.exec(text)?.[1];
  if (block === undefined) return {};
  const result = {};
  for (const line of block.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^  (\S[^:]*):\s+([^#]+?)\s*$/.exec(line);
    if (!match) throw new Error('Unsupported override syntax: ' + line);
    const unquote = value => value.replace(/^(['"])(.*)\1$/, '$2');
    result[unquote(match[1])] = unquote(match[2]);
  }
  return result;
}
export function collectUses(manifests, overrides, overridePath = 'pnpm-workspace.yaml') {
  const uses = [];
  for (const [path, pkg] of Object.entries(manifests)) {
    for (const group of groups) {
      for (const [name, spec] of Object.entries(pkg[group] ?? {})) uses.push({ path, group, name, spec });
    }
    for (const [name, spec] of Object.entries(pkg.pnpm?.overrides ?? {})) uses.push({ path, group: 'pnpm.overrides', name, spec });
    if (pkg.packageManager) {
      const match = /^([^@]+)@(.+)$/.exec(pkg.packageManager);
      if (!match) throw new Error('Unsupported packageManager: ' + pkg.packageManager);
      uses.push({ path, group: 'packageManager', name: match[1], spec: match[2] });
    }
  }
  for (const [name, spec] of Object.entries(overrides)) uses.push({ path: overridePath, group: 'overrides', name, spec });
  return uses;
}
export function disposition(use, latest, holds) {
  const { name, spec, group } = use;
  if (typeof spec !== 'string') return { action: 'review-required', reason: 'Non-string dependency declaration' };
  if (spec.startsWith('workspace:') || (name.startsWith('@nitro-forge/') && spec.startsWith('link:'))) return { action: 'internal-workspace', reason: 'Resolved from this source tree' };
  if (name.startsWith('@nyc-tron/') && spec.startsWith('https:')) return { action: 'source-pin', reason: 'F2 rc.2 archive pin; source/hash checks separate; stable repin still required' };
  if (spec.startsWith('file:') && name === 'react-native-video') return { action: 'hold', reason: holds[name] };
  if (/^(https?:|file:|link:|git|github:|npm:)/.test(spec)) return { action: 'review-required', reason: 'Custom source or alias requires individual provenance review' };
  if (holds[name]) return { action: 'hold', reason: holds[name] };
  if (latest === null) return { action: 'registry-unavailable', reason: 'No successful latest-tag response; this item is not disposed' };
  if (group === 'peerDependencies' || /[<>=*| ]/.test(spec)) return { action: 'compatibility-range', reason: 'Consumer compatibility declaration, not a latest-version pin; retain and validate admitted host graph' };
  const base = spec.replace(/^[~^]/, '');
  if (base === latest) return { action: 'current', reason: 'Declared floor/exact version matches dated latest tag' };
  return { action: 'review-required', reason: 'Version differs from dated latest; bump or explain an individual hold' };
}
export async function inventory({ registry = false } = {}) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const files = tracked.filter(path => path === 'package.json' || path.endsWith('/package.json'));
  const workspaceFiles = tracked.filter(path => path === 'pnpm-workspace.yaml' || path.endsWith('/pnpm-workspace.yaml'));
  const manifests = Object.fromEntries(files.map(path => [path, JSON.parse(readFileSync(resolve(root, path), 'utf8'))]));
  const uses = collectUses(manifests, {});
  for (const path of workspaceFiles) uses.push(...collectUses({}, overridesFromWorkspace(readFileSync(resolve(root, path), 'utf8')), path));
  for (const use of uses.filter(use => use.spec.startsWith('link:'))) {
    const target = JSON.parse(readFileSync(resolve(root, dirname(use.path), use.spec.slice(5), 'package.json'), 'utf8'));
    if (target.name !== use.name) throw new Error('Linked package name mismatch: ' + use.path);
  }
  const holds = JSON.parse(readFileSync(resolve(root, 'tooling/release/f1-holds-2026-11-13.json'), 'utf8')).holds;
  const names = [...new Set(uses.filter(use => !use.spec.startsWith('workspace:') && !/^(https?:|file:|link:|git|github:|npm:)/.test(use.spec)).map(use => use.name))].sort();
  const responses = {};
  if (registry) {
    let cursor = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < names.length) {
        const name = names[cursor++]; const url = 'https://registry.npmjs.org/' + encodeURIComponent(name) + '/latest';
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const pkg = await response.json();
          if (typeof pkg.version !== 'string') throw new Error('Missing version');
          responses[name] = { url, latest: pkg.version };
        } catch (error) { responses[name] = { url, latest: null, error: error.message }; }
      }
    }));
  }
  const inputPaths = [...files, ...workspaceFiles, 'pnpm-lock.yaml', 'examples/native-cadence/pnpm-lock.yaml', 'Cargo.lock', '.cargo/audit.toml', 'tooling/release/f1-holds-2026-11-13.json'];
  const inputSHA256 = Object.fromEntries(inputPaths.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]));
  const rows = uses.map(use => ({ ...use, latest: responses[use.name]?.latest ?? null, ...(registry ? disposition(use, responses[use.name]?.latest ?? null, holds) : { action: 'NOT RUN', reason: 'Offline inventory only' }) }));
  return { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), capturedAtUTC: new Date().toISOString(), inputSHA256, workingTreeStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), registry, manifestCount: files.length, files, workspaceFiles, responses, uses: rows, unresolved: rows.filter(row => ['review-required', 'registry-unavailable'].includes(row.action)), note: 'Declared constraints only; not a full locked/transitive audit. pnpm outdated and native compatibility proofs remain separate. No source/lock mutation or F1 gate pass.' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !['--offline', '--registry'].includes(args[0])) throw new Error('Usage: f1-freshness.mjs --offline|--registry output.json');
  const report = await inventory({ registry: args[0] === '--registry' });
  const output = resolve(args[1]); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.manifestCount} manifests, ${report.uses.length} declarations; ${report.unresolved.length} unresolved. Registry ${report.registry ? 'queried' : 'NOT RUN'}.`);
  if (report.unresolved.length) process.exitCode = 1;
}
