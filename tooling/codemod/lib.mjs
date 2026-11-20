// Shared by tokenize.mjs, prove-equivalence.mjs and check-no-hardcoded.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * ts-morph is a root devDependency. On a machine without the full install
 * (CI installs it), point CODEMOD_TOOLS_DIR at a folder that has it.
 */
export function loadTsMorph() {
  const bases = [pathToFileURL(join(repoRoot, 'package.json')).href];
  if (process.env.CODEMOD_TOOLS_DIR) bases.push(pathToFileURL(join(process.env.CODEMOD_TOOLS_DIR, 'package.json')).href);
  for (const base of bases) {
    try { return createRequire(base)('ts-morph'); } catch { /* try the next location */ }
  }
  throw new Error('ts-morph not found. Run the repo install, or set CODEMOD_TOOLS_DIR to a folder that has ts-morph installed.');
}

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const loadMap = () => readJson(join(repoRoot, 'docs/agent-native/tokens.map.json'));

/** Packages whose sources this codemod may rewrite. Each uses its own token module. */
export const PACKAGES = {
  'packages/studio-workspace/src': { module: './tokens', root: 'tokens', style: 'ts' },
  'packages/icons/src': { module: './tokens.js', root: null, style: 'js' },
};

export const packageOf = file => Object.keys(PACKAGES).find(prefix => file.startsWith(`${prefix}/`));

export const TOKEN_FILES = new Set([
  'packages/studio-workspace/src/theme.ts',
  'packages/studio-workspace/src/tokens.ts',
  'packages/studio-workspace/src/forge-directions.ts',
  'packages/studio-workspace/src/theme.css',
  'packages/studio-workspace/src/theme.native.css',
  'packages/icons/src/tokens.js',
]);

export const isTestFile = file => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

export function listSources(prefixes = Object.keys(PACKAGES), extensions = /\.(tsx?|jsx?|mjs|cjs)$/) {
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(join(repoRoot, dir)).sort()) {
      const rel = `${dir}/${name}`;
      const info = statSync(join(repoRoot, rel));
      if (info.isDirectory()) { if (name !== 'node_modules') walk(rel); }
      else if (extensions.test(name) && !name.endsWith('.d.ts')) out.push(rel);
    }
  };
  for (const prefix of prefixes) walk(prefix);
  return out;
}

export const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/** `--spacing-fixed-element` -> { path: ['spacing','fixedElement'], value } using the live tokens.ts. */
export async function loadTokenIndex() {
  const mod = await import(pathToFileURL(join(repoRoot, 'packages/studio-workspace/src/tokens.ts')).href);
  const index = new Map();
  for (const [group, entries] of Object.entries(mod.tokens)) {
    for (const [key, value] of Object.entries(entries)) index.set(mod.cssVarName(group, key), { path: [group, key], value });
  }
  return { index, tokens: mod.tokens };
}

/** Token modules by package: what a reference expression resolves to when read at run time. */
export async function loadTokenModules() {
  const ws = await import(pathToFileURL(join(repoRoot, 'packages/studio-workspace/src/tokens.ts')).href);
  const icons = await import(pathToFileURL(join(repoRoot, 'packages/icons/src/tokens.js')).href);
  return { 'packages/studio-workspace/src': { tokens: ws.tokens }, 'packages/icons/src': icons };
}

export const canonNumber = text => String(Number(text));
