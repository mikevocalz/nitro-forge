#!/usr/bin/env node
// Fail when any file in r/*.json imports something that is not installed, not declared, and not react or react-native.
// Reads only the generated output, which is what a consumer receives (decision 39).
// An import is resolved when it is one of:
//   relative            -> a file installed by the item or by a @nitro-forge item in its registryDependencies closure
//   @/components/ui/<k> -> a @nyc-tron/<k> registryDependency in that closure, or a file such an item provides (config nycTron.providedBy)
//   bare package        -> react, react-native, or an entry in `dependencies` of the item or its closure
//   @nitro-forge/<x>    -> listed in meta.prerequisites of the item or its closure (reported separately, not installable)
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { ROOT, config, scanImports, isRelative, packageOf, NODE_BUILTIN } from './lib.mjs';

const cfg = config();
const R = join(ROOT, 'r');
const items = new Map();
for (const f of readdirSync(R)) {
  if (!f.endsWith('.json') || f === 'registry.json') continue;
  const item = JSON.parse(readFileSync(join(R, f), 'utf8'));
  items.set(item.name, item);
}
if (items.size === 0) {
  console.error('check-imports: r/ holds no items. Run node tooling/registry/build.mjs first.');
  process.exit(1);
}

const prefixOfDir = `${cfg.installDir}/`;
const closureOf = (name) => {
  const seen = new Set([name]);
  const walk = (n) => {
    for (const dep of items.get(n)?.registryDependencies ?? []) {
      const m = dep.match(/^@nitro-forge\/(.+)$/);
      if (m && !seen.has(m[1])) {
        if (!items.has(m[1])) throw new Error(`${n} depends on @nitro-forge/${m[1]}, which is not in r/`);
        seen.add(m[1]);
        walk(m[1]);
      }
    }
  };
  walk(name);
  return seen;
};

const counts = { relative: 0, nycTron: 0, package: 0, host: 0, prerequisite: 0 };
const unresolved = [];
const prerequisites = new Map();

for (const item of items.values()) {
  const closure = [...closureOf(item.name)].map((n) => items.get(n));
  const installed = new Set();
  const npm = new Set();
  const nyc = new Set();
  const prereq = new Set();
  for (const c of closure) {
    for (const f of c.files ?? []) installed.add(f.target.startsWith(prefixOfDir) ? f.target.slice(prefixOfDir.length) : f.target);
    for (const d of c.dependencies ?? []) npm.add(d.replace(/@[^@/]*$/, ''));
    for (const d of c.registryDependencies ?? []) if (d.startsWith('@nyc-tron/')) nyc.add(d.slice('@nyc-tron/'.length));
    for (const p of c.meta?.prerequisites ?? []) prereq.add(p.id);
  }
  const provided = new Set(nyc);
  for (const [file, providers] of Object.entries(cfg.nycTron.providedBy)) if (providers.some((p) => nyc.has(p))) provided.add(file);

  for (const file of item.files ?? []) {
    if (!/\.(tsx?|jsx?)$/.test(file.target)) continue;
    const rel = file.target.startsWith(prefixOfDir) ? file.target.slice(prefixOfDir.length) : file.target;
    for (const spec of scanImports(file.content)) {
      const where = `${item.name}: ${rel} imports ${spec}`;
      if (isRelative(spec)) {
        const base = posix.normalize(posix.join(posix.dirname(rel), spec));
        const exts = ['', '.ts', '.tsx', '.js', '.native.ts', '.native.tsx', '.d.ts', '.json', '.css', '/index.js', '/index.ts', '/index.tsx'];
        if (exts.some((e) => installed.has(base + e))) counts.relative += 1;
        else unresolved.push(`${where} (no installed file ${base})`);
      } else if (spec.startsWith(cfg.nycTron.importPrefix)) {
        const key = spec.slice(cfg.nycTron.importPrefix.length);
        if (provided.has(key)) counts.nycTron += 1;
        else unresolved.push(`${where} (no @nyc-tron/${key} dependency)`);
      } else if (NODE_BUILTIN.test(spec) || cfg.builtinPackages.includes(packageOf(spec))) {
        counts.host += 1;
      } else if (npm.has(packageOf(spec))) {
        counts.package += 1;
      } else if (prereq.has(packageOf(spec))) {
        counts.prerequisite += 1;
        if (!prerequisites.has(item.name)) prerequisites.set(item.name, new Set());
        prerequisites.get(item.name).add(spec);
      } else {
        unresolved.push(`${where} (not installed, not in dependencies, not a prerequisite)`);
      }
    }
  }
}

console.log(`check-imports: ${items.size} items. resolved: ${counts.relative} relative, ${counts.nycTron} @nyc-tron, ${counts.package} npm, ${counts.host} react/react-native, ${counts.prerequisite} declared prerequisite.`);
for (const [name, specs] of prerequisites) console.log(`  prerequisite import (not installable by shadcn): ${name} -> ${[...specs].join(', ')}`);
if (unresolved.length) {
  console.error(`check-imports: ${unresolved.length} unresolved import(s):`);
  for (const u of unresolved) console.error(`  ${u}`);
  process.exit(1);
}
console.log('check-imports: 0 unresolved imports');
