import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statfsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export const json = file => JSON.parse(readFileSync(file, 'utf8'));

/** No symlink or traversal may make a staged package depend on its producer. */
export function inside(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\'))
    throw new Error(`Invalid package-relative path: ${path}`);
  const full = resolve(root, path);
  const rel = relative(resolve(root), full);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..') throw new Error(`Escaping path: ${path}`);
  return full;
}

export function files(root) {
  const result = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const path = resolve(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Symlink in archive input: ${path}`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) result.push(relative(root, path).split(sep).join('/'));
      else throw new Error(`Unsupported archive input: ${path}`);
    }
  }
  walk(root);
  return result;
}

export function requireDisk(path, reserveBytes = 0) {
  const stat = statfsSync(path);
  const available = Number(stat.bavail) * Number(stat.bsize);
  if (available - reserveBytes < 10_000_000_000)
    throw new Error(`Disk guard: ${available} bytes available; reserve ${reserveBytes} would cross owner 10 GB floor`);
  return available;
}

export function assertInstalledInside(app, file) {
  const rel = relative(realpathSync(app), realpathSync(file));
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Installed dependency escapes clean consumer: ${file}`);
}

/** Check every concrete exported file, including Node's private generated imports. */
export function checkExports(root, pkg) {
  const targets = [pkg.main, pkg.types];
  function collect(value) {
    if (typeof value === 'string') targets.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  collect(pkg.exports);
  for (const target of targets.filter(Boolean)) {
    if (!lstatSync(inside(root, target)).isFile()) throw new Error(`Missing export ${pkg.name}: ${target}`);
  }
  for (const values of [pkg.dependencies, pkg.optionalDependencies, pkg.peerDependencies]) {
    for (const [name, version] of Object.entries(values ?? {})) {
      if (/^(workspace:|link:|file:)/.test(version)) throw new Error(`Unresolved local dependency: ${name}@${version}`);
    }
  }
  for (const target of Object.values(pkg.imports ?? {})) {
    if (typeof target !== 'string' || !target.includes('*')) throw new Error(`Unsupported private import mapping: ${target}`);
    const [prefix, suffix] = target.split('*');
    if (!files(root).some(p => (`./${p}`).startsWith(prefix) && p.endsWith(suffix)))
      throw new Error(`Missing generated private import: ${target}`);
  }
}

/** Check literal source imports independently of the all-studio fixture graph.
 * Metro/typecheck still own actual module interpretation and platform branches.
 */
export function checkSourceClosure(root, pkg) {
  const available = new Set(files(root));
  const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }));
  for (const file of available) {
    if (!file.startsWith('src/') || !/\.[cm]?[jt]sx?$/.test(file)) continue;
    const text = readFileSync(resolve(root, file), 'utf8');
    const imports = [...text.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]*(?:\n[^;'"\n]*)*?\sfrom\s*)?['"]([^'"]+)['"]/g)].map(m => m[1]);
    for (const name of imports) {
      if (name.startsWith('node:') || name.startsWith('#')) continue;
      if (name.startsWith('.')) {
        const target = relative(root, resolve(dirname(resolve(root, file)), name)).split(sep).join('/');
        if (![target, ...['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map(ext => target + ext)].some(p => available.has(p)))
          throw new Error(`Missing relative module ${pkg.name}: ${file} -> ${name}`);
      } else {
        const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
        if (packageName !== pkg.name && !declared.has(packageName)) throw new Error(`Undeclared module ${pkg.name}: ${file} -> ${name}`);
      }
    }
  }
}
