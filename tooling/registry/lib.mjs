// Shared helpers for the Nitro Forge registry tooling. No dependencies.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REG_DIR = join(ROOT, 'tooling', 'registry');
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const config = () => readJson(join(REG_DIR, 'config.json'));
export const itemsFile = () => readJson(join(REG_DIR, 'items.json'));

/**
 * Mask comments and string literals so import patterns only match real code.
 * Returns the masked source and the string literals it replaced (marker \u0001<n>\u0001).
 */
export function mask(text) {
  const strings = [];
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
    } else if (c === '/' && d === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? n : end;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      strings.push({ quote: c, value: text.slice(i + 1, j) });
      out += `\u0001${strings.length - 1}\u0001`;
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return { code: out, strings };
}

const SPEC = String.raw`\u0001(\d+)\u0001`;
const PATTERNS = [
  new RegExp(String.raw`\bimport\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\*\s+as\s+[\w$]+|\{[^}]*\})?\s*from\s*` + SPEC, 'g'),
  new RegExp(String.raw`\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*` + SPEC, 'g'),
  new RegExp(String.raw`\bimport\s*` + SPEC, 'g'),
  new RegExp(String.raw`\bimport\s*\(\s*` + SPEC + String.raw`\s*\)`, 'g'),
  new RegExp(String.raw`\brequire\s*\(\s*` + SPEC + String.raw`\s*\)`, 'g'),
];

/** Every module specifier a TS or JS file imports or re-exports. */
export function scanImports(text) {
  const { code, strings } = mask(text);
  const found = new Set();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (const m of code.matchAll(re)) {
      const lit = strings[Number(m[1])];
      if (lit.quote !== '`') found.add(lit.value);
    }
  }
  return [...found].sort();
}

/** True when every import of this specifier in the file is `import type`. */
export function isTypeOnly(text, spec) {
  const { code, strings } = mask(text);
  const idx = strings.findIndex((x) => x.value === spec);
  if (idx === -1) return false;
  const all = [...code.matchAll(new RegExp(String.raw`\b(?:import|export)\s+(type\s+)?[^;]*?from\s*\u0001` + idx + String.raw`\u0001`, 'g'))];
  return all.length > 0 && all.every((m) => Boolean(m[1]));
}

export const NODE_BUILTIN = /^node:/;

/** Package name of a bare specifier: "zustand/vanilla" -> "zustand", "@a/b/c" -> "@a/b". */
export function packageOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export const isRelative = (s) => s.startsWith('./') || s.startsWith('../');

/** Candidate file names a relative specifier can mean, given the importing file's target dir. */
export function relativeCandidates(fromTarget, spec) {
  const base = posix.normalize(posix.join(posix.dirname(fromTarget), spec));
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.native.ts', '.native.tsx', '.web.ts', '.web.tsx', '.d.ts', '.json', '.css', '/index.ts', '/index.tsx', '/index.js'];
  return exts.map((e) => base + e);
}

export function sha(text) {
  return text.length;
}
export { existsSync };
