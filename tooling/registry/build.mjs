#!/usr/bin/env node
// Build the @nitro-forge shadcn registry.
//   node tooling/registry/build.mjs            stage files, write registry.json and components.json, run `shadcn build`
//   node tooling/registry/build.mjs --no-shadcn  stage and write registry.json only
// Re-runnable: every output is derived from packages/, items.json, copy.json and a11y-status.json.
// Import rewriting (decision 39) happens only in tooling/registry/stage/ and therefore only in r/*.json.
// SHADCN_BIN may point at a local shadcn 4.23.0 binary; otherwise `npx shadcn@<version>` runs.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, posix } from 'node:path';
import { ROOT, REG_DIR, config, itemsFile, readJson, scanImports, isRelative, packageOf, NODE_BUILTIN } from './lib.mjs';

const cfg = config();
const { items: itemDefs } = itemsFile();
const copy = Object.fromEntries(readJson(join(ROOT, 'docs/agent-native/copy.json')).map((c) => [c.id, c]));
const overrides = readJson(join(REG_DIR, 'copy-overrides.json'));
const a11y = readJson(join(ROOT, 'docs/agent-native/a11y-status.json'));
const STAGE = join(REG_DIR, 'stage');
const flags = new Set(process.argv.slice(2));
// SOURCE_REF=<git ref> reads item sources from that ref instead of the working tree, so a build made while
// another change is in flight still matches a clean checkout of the ref.
const readSource = (path) => {
  const ref = process.env.SOURCE_REF;
  if (!ref || !path.startsWith('packages/')) return readFileSync(join(ROOT, path), 'utf8');
  const run = spawnSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) fail(`git show ${ref}:${path} failed: ${run.stderr.trim()}`);
  return run.stdout;
};

const fail = (message) => {
  console.error(`build: ${message}`);
  process.exit(1);
};

const urlFor = (namespace) => {
  const reg = cfg.registries[namespace];
  return cfg.urlTemplate.replace('{owner}', cfg.owner).replace('{repo}', reg.repo).replace('{tag}', cfg.tag);
};

/** Installed target of one file, relative to the install directory. */
const targetOf = (file) => file.target ?? basename(file.from);
const installedPath = (item, file) => `${cfg.installDir}/${targetOf(file)}`;

// Owner of every installed file, keyed by its target relative to the install directory.
const ownerByTarget = new Map();
for (const item of itemDefs) {
  for (const file of item.files) {
    const key = targetOf(file);
    if (ownerByTarget.has(key)) fail(`${key} is installed by both ${ownerByTarget.get(key)} and ${item.name}`);
    ownerByTarget.set(key, item.name);
  }
}

/** Resolve a relative specifier to the item that installs the file it means. */
function ownerOfRelative(fromTarget, spec) {
  const base = posix.normalize(posix.join(posix.dirname(fromTarget), spec.replace(/\.(tsx?)$/, '')));
  const exts = ['', '.ts', '.tsx', '.js', '.native.ts', '.native.tsx', '.d.ts', '.json', '/index.js', '/index.ts', '/index.tsx'];
  for (const e of exts) {
    const hit = ownerByTarget.get(base + e);
    if (hit) return hit;
  }
  return undefined;
}

/** Map one specifier from repo source to installed form. Returns the same string when nothing changes. */
function rewriteSpecifier(spec, fromTarget) {
  if (isRelative(spec)) return spec.replace(/\.(tsx?)$/, '');
  const iconTarget = (name) => {
    const rel = posix.relative(posix.dirname(fromTarget), `${cfg.iconsSubdir}/${name}`);
    return rel.startsWith('.') ? rel : `./${rel}`;
  };
  if (spec === '@nitro-forge/icons/native' || spec === '@nitro-forge/icons/web') return iconTarget('ForgeIcon');
  if (spec === '@nitro-forge/icons') return iconTarget('index');
  if (spec.startsWith(cfg.nycTron.specifierPrefix)) return cfg.nycTron.importPrefix + spec.slice(cfg.nycTron.specifierPrefix.length);
  return spec;
}

function rewriteSource(text, fromTarget) {
  let out = text;
  for (const spec of scanImports(text)) {
    const next = rewriteSpecifier(spec, fromTarget);
    if (next === spec) continue;
    const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(String.raw`((?:from|import|require)\s*\(?\s*)(['"])` + esc + String.raw`\2`, 'g');
    out = out.replace(re, (_m, lead, q) => `${lead}${q}${next}${q}`);
  }
  return out;
}

// Stage rewritten files and collect every dependency edge.
rmSync(STAGE, { recursive: true, force: true });
const built = [];
const handoffDiff = {};
for (const def of itemDefs) {
  const npm = new Set();
  const internal = new Set(def.dependsOn ?? []);
  const nyc = new Set();
  const prereq = new Set();
  const files = [];
  const sources = [];
  for (const file of def.files) {
    const text = readSource(file.from);
    const target = targetOf(file);
    const code = /\.(tsx?|jsx?)$/.test(file.from) && !file.from.endsWith('.d.ts');
    const staged = code ? rewriteSource(text, target) : text;
    const stagedPath = join(STAGE, def.name, target);
    mkdirSync(dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, staged);
    const type = file.type ?? (/\.(css|json)$/.test(file.from) ? 'registry:file' : /\.(tsx|jsx)$/.test(file.from) ? 'registry:ui' : 'registry:lib');
    files.push({ path: posix.join('tooling/registry/stage', def.name, target), type, target: installedPath(def, file) });
    sources.push(file.from);
    if (!code) continue;
    for (const spec of scanImports(text)) {
      if (isRelative(spec)) {
        const owner = ownerOfRelative(target, spec);
        if (!owner) fail(`${file.from} imports ${spec}, which no item installs`);
        if (owner !== def.name) internal.add(owner);
      } else if (spec.startsWith('@nitro-forge/icons')) {
        if (def.name !== 'forge-icon') internal.add('forge-icon');
      } else if (spec.startsWith(cfg.nycTron.specifierPrefix)) {
        const key = spec.slice(cfg.nycTron.specifierPrefix.length);
        if (cfg.nycTron.providedBy[key]) continue; // reached through the item that wraps it
        nyc.add(key);
      } else if (cfg.prerequisites[packageOf(spec)]) {
        prereq.add(packageOf(spec));
      } else if (NODE_BUILTIN.test(spec) || cfg.builtinPackages.includes(packageOf(spec))) {
        // react and react-native come from the host app
      } else {
        const pkg = packageOf(spec);
        const version = cfg.npmVersions[pkg];
        if (!version) fail(`${file.from} imports ${spec}; add ${pkg} to npmVersions in config.json`);
        npm.add(`${pkg}@${version}`);
      }
    }
  }
  built.push({ def, files, sources, npm: [...npm].sort(), internal: [...internal], nyc: [...nyc], prereq: [...prereq].sort() });
}

const byName = new Map(built.map((b) => [b.def.name, b]));
for (const b of built) for (const dep of b.internal) if (!byName.has(dep)) fail(`${b.def.name} depends on unknown item ${dep}`);

// Cycle check over internal edges.
{
  const state = new Map();
  const visit = (name, trail) => {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) fail(`registryDependencies cycle: ${[...trail, name].join(' -> ')}`);
    state.set(name, 1);
    for (const dep of byName.get(name).internal) visit(dep, [...trail, name]);
    state.set(name, 2);
  };
  for (const name of byName.keys()) visit(name, []);
}

const closure = (name, seen = new Set()) => {
  for (const dep of byName.get(name).internal) if (!seen.has(dep)) { seen.add(dep); closure(dep, seen); }
  return seen;
};

const rank = (name) => (name === cfg.provider ? 0 : name === 'studio-theme' ? 1 : 2);
const sortInternal = (a, b) => rank(a) - rank(b) || a.localeCompare(b);

const registryItems = built.map((b) => {
  const { def } = b;
  const title = overrides[def.name]?.title ?? copy[def.name]?.title ?? def.title;
  const description = overrides[def.name]?.description ?? copy[def.name]?.description ?? def.description;
  if (!title || !description) fail(`${def.name} has no title or description in copy.json`);
  const deps = closure(def.name);
  const needsProvider = def.name === cfg.provider ? false : deps.has(cfg.provider);
  const status = a11y[def.name]?.status;
  const a11yStatus = status ? cfg.a11yMap[status] : def.a11yStatus ?? 'unverified';
  const registryDependencies = [
    ...b.internal.sort(sortInternal).map((n) => `${cfg.namespace}/${n}`),
    ...b.nyc.sort().map((k) => `@nyc-tron/${k}`),
  ];
  const handoff = def.handoffRegistryDependencies ?? [];
  const toSet = (list) => new Set(list.map((d) => d.replace(/^@nyc-tron\/(?:ui\/components\/)?/, '@nyc-tron/')));
  const computed = toSet(registryDependencies);
  const handoffSet = toSet(handoff);
  handoffDiff[def.name] = {
    addedByImports: [...computed].filter((d) => !handoffSet.has(d)).sort(),
    inHandoffOnly: [...handoffSet].filter((d) => !computed.has(d)).sort(),
  };
  const allPrereq = new Set(b.prereq);
  for (const dep of deps) for (const id of byName.get(dep).prereq) allPrereq.add(id);
  const prerequisites = [...allPrereq].sort().map((id) => ({
    id,
    step: cfg.prerequisites[id].step,
    installable: false,
    via: b.prereq.includes(id) ? 'direct import' : 'registryDependencies',
    reason: cfg.prerequisites[id].reason,
  }));
  const docLines = [];
  if (needsProvider) docLines.push(`Needs ${cfg.namespace}/${cfg.provider} (StudioUIProvider) and a host such as nyc-tron-host. Every studio component throws without it. See docs/agent-native/install-order.md step 7.`);
  for (const p of prerequisites) docLines.push(`Needs ${p.id} first (step ${p.step} of docs/agent-native/install-order.md). shadcn cannot install it.`);
  const meta = {
    tier: 1,
    docs: 'handwritten',
    docsPath: `docs/components/${def.name}.md`,
    category: def.category,
    a11yStatus,
    needsProvider,
    sourceFiles: b.sources,
  };
  if (def.platforms) meta.platforms = def.platforms;
  if (a11y[def.name]?.failures?.length) meta.a11yFailures = a11y[def.name].failures;
  if (prerequisites.length) meta.prerequisites = prerequisites;
  const item = { name: def.name, type: def.type, title, description };
  if (b.npm.length) item.dependencies = b.npm;
  if (registryDependencies.length) item.registryDependencies = registryDependencies;
  item.files = b.files;
  if (docLines.length) item.docs = docLines.join('\n');
  item.meta = meta;
  return item;
});

// Provider and tokens first, then the rest in dependency-friendly alphabetical order.
registryItems.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

const registry = {
  $schema: 'https://ui.shadcn.com/schema/registry.json',
  name: 'nitro-forge',
  homepage: cfg.homepage,
  items: registryItems,
};
const write = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
write(join(ROOT, 'registry.json'), registry);
write(join(REG_DIR, 'deps-diff.json'), { note: 'Computed registryDependencies versus the lists in docs/agent-native/03-design-handoff.md. Generated by build.mjs.', items: handoffDiff });

write(join(ROOT, 'components.json'), {
  $schema: 'https://ui.shadcn.com/schema.json',
  style: 'new-york',
  rsc: false,
  tsx: true,
  tailwind: { baseColor: 'neutral', css: 'global.css' },
  aliases: { components: '@/components', ui: '@/components/ui', lib: '@/lib', utils: '@/lib/utils', hooks: '@/hooks' },
  registries: { '@nitro-forge': urlFor('@nitro-forge'), '@nyc-tron': urlFor('@nyc-tron') },
});
console.log(`build: staged ${registryItems.length} items, ${registryItems.reduce((n, i) => n + i.files.length, 0)} files, tag ${cfg.tag}`);

// registry-excluded.json: what is not in registry.json, with the reason and the condition for returning.
{
  const { readdirSync } = await import('node:fs');
  const kinds = readFileSync(join(ROOT, 'packages/ignition/src/types.ts'), 'utf8').match(/ENGINE_KINDS\s*=\s*\[([^\]]+)\]/)?.[1].match(/"([a-z]+)"/g)?.map((x) => x.replaceAll('"', ''));
  if (!kinds || kinds.length === 0) fail('could not read ENGINE_KINDS from packages/ignition/src/types.ts');
  const pkgDirs = readdirSync(join(ROOT, 'packages'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const known = new Set([...kinds, 'ignition', 'studio-layout', 'studio-workspace', 'icons']);
  const adapterReason = 'Decision 30. Each imports its engine facade, which a registry add cannot install, so admitting it would ship a file with an unresolved import.';
  const engineReason = 'Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.';
  const returns = 'Returns when the tarball versioning scheme is decided and the facade is installable (decision 3).';
  const out = {
    _note: 'Generated by tooling/registry/build.mjs. Not in registry.json. check-docs.mjs requires a docs page for each engine, ignition and studio-layout entry.',
    adapters: [
      { name: 'quill-office-binding', package: '@nitro-forge/quill', files: ['packages/quill/src/office-cluster.ts', 'packages/quill/src/list-markers.ts'], reason: adapterReason, returns },
      { name: 'tally-sheet-binding', package: '@nitro-forge/tally', files: ['packages/tally/src/grid-cluster.ts', 'packages/tally/src/grid-adapter.ts'], reason: adapterReason, returns },
      { name: 'splice-timeline-binding', package: '@nitro-forge/splice', files: ['packages/splice/src/timeline-cluster.ts'], reason: adapterReason, returns },
      { name: 'prism-canvas-binding', package: '@nitro-forge/prism', files: ['packages/prism/src/canvas-cluster.ts', 'packages/prism/src/canvas-types.ts', 'packages/prism/src/rgba.ts'], reason: `${adapterReason} It also imports base64ToBytes from @nitro-forge/ignition at runtime.`, returns },
    ],
    engines: kinds.map((k) => ({ name: k, package: `@nitro-forge/${k}`, form: 'github-release-tarball', reason: engineReason, returns })),
    foundations: [
      { name: 'ignition', package: '@nitro-forge/ignition', reason: 'Decision 4. shadcn copies files. It cannot run nitrogen, pod install or CMake. Documented as a prerequisite with the exact commands in docs/agent-native/install-order.md.', returns: 'Returns only if a build step outside shadcn can produce the native archives for a consumer.' },
      { name: 'studio-layout', package: '@nitro-forge/studio-layout', reason: 'Decision 3. Private workspace package with no tarball and no versioning scheme.', returns },
    ],
    notAssessed: pkgDirs.filter((d) => !known.has(d)).map((d) => ({ name: d, package: `@nitro-forge/${d}`, reason: 'Outside the admission pass. 03-design-handoff.md covers studio-workspace and icons only. Not assessed, not excluded on merit.' })),
  };
  write(join(ROOT, 'registry-excluded.json'), out);
}

if (flags.has('--no-shadcn')) process.exit(0);
const bin = process.env.SHADCN_BIN;
const args = ['build', 'registry.json', '-o', 'r'];
const run = bin
  ? spawnSync(bin, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })
  : spawnSync('npx', ['--yes', `shadcn@${cfg.shadcnVersion}`, ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
if (run.status !== 0) fail(`shadcn build exited ${run.status}`);
