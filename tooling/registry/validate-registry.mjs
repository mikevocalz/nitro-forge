#!/usr/bin/env node
// Structural validation of registry.json, r/*.json and the brand theme contract. No network, no dependencies.
// `shadcn build` (zod) validates the item schema itself; this script checks what the schema cannot:
// the index matches r/, dependencies resolve, targets do not collide, meta values are in range,
// the icon wording matches the source, and brand.theme.example.json follows brand.theme.schema.json.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, readJson } from './lib.mjs';

const cfg = config();
const problems = [];
const bad = (m) => problems.push(m);

const registry = readJson(join(ROOT, 'registry.json'));
const built = new Map();
for (const f of readdirSync(join(ROOT, 'r'))) {
  if (f.endsWith('.json') && f !== 'registry.json') built.set(f.slice(0, -5), readJson(join(ROOT, 'r', f)));
}
const index = readJson(join(ROOT, 'r', 'registry.json'));

const names = registry.items.map((i) => i.name);
if (new Set(names).size !== names.length) bad('registry.json has duplicate item names');
for (const n of names) if (!built.has(n)) bad(`r/${n}.json is missing`);
for (const n of built.keys()) if (!names.includes(n)) bad(`r/${n}.json has no entry in registry.json`);
if ((index.items ?? []).length !== names.length) bad(`r/registry.json lists ${(index.items ?? []).length} items, registry.json lists ${names.length}`);

const TYPES = new Set(['registry:ui', 'registry:lib', 'registry:file']);
const A11Y = new Set(['reviewed-pass', 'reviewed-fail', 'unverified', 'verified']);
const PLATFORMS = ['ios', 'android', 'web', 'windows', 'macos', 'qnx'];
const targets = new Map();
let nycDeps = new Set();
for (const [name, item] of built) {
  if (!item.title || !item.description) bad(`${name}: title or description missing`);
  if (!TYPES.has(item.type)) bad(`${name}: unexpected type ${item.type}`);
  if (/—/.test(`${item.title}${item.description}${item.docs ?? ''}`)) bad(`${name}: em dash in copy`);
  const m = item.meta ?? {};
  if (m.tier !== 1) bad(`${name}: meta.tier must be 1`);
  if (!['handwritten', 'generated'].includes(m.docs)) bad(`${name}: meta.docs invalid`);
  if (!A11Y.has(m.a11yStatus)) bad(`${name}: meta.a11yStatus ${m.a11yStatus} is not one of ${[...A11Y].join(', ')}`);
  if (m.a11yStatus === 'verified') bad(`${name}: nothing was rendered, so verified is reserved (decision 34)`);
  if (m.platforms) {
    const sorted = PLATFORMS.filter((p) => m.platforms.includes(p));
    if (JSON.stringify(sorted) !== JSON.stringify(m.platforms)) bad(`${name}: platforms not a sorted subset of ${PLATFORMS.join(',')}`);
  }
  for (const dep of item.registryDependencies ?? []) {
    if (dep.startsWith('@nitro-forge/')) {
      if (!built.has(dep.slice('@nitro-forge/'.length))) bad(`${name}: registryDependency ${dep} does not exist`);
    } else if (dep.startsWith('@nyc-tron/')) nycDeps.add(dep);
    else bad(`${name}: registryDependency ${dep} is in no known namespace`);
    if (dep === `@nitro-forge/${name}`) bad(`${name}: depends on itself`);
  }
  for (const file of item.files ?? []) {
    if (!file.content || file.content.length === 0) bad(`${name}: ${file.path} has no content`);
    if (!file.target) bad(`${name}: ${file.path} has no target`);
    const owner = targets.get(file.target);
    if (owner && owner !== name) bad(`${file.target} is installed by ${owner} and ${name}`);
    targets.set(file.target, name);
    if (!file.target.startsWith(`${cfg.installDir}/`)) bad(`${name}: ${file.target} is outside ${cfg.installDir}`);
  }
  if (name !== 'forge-icon-button' && (item.files ?? []).length === 0) bad(`${name}: no files`);
}
for (const item of registry.items) if (item.registryDependencies?.some((d) => d.startsWith('@nitro-forge/') && !names.includes(d.slice(13)))) bad(`registry.json ${item.name}: dangling dependency`);

// Icon wording, decision 35: 47 drawn, 42 catalog ids resolve, 6 drawn glyphs are not catalog slugs.
{
  const glyphs = await import(join(ROOT, 'packages/icons/src/glyphs.js'));
  const catalog = await import(join(ROOT, 'packages/icons/src/catalog.js'));
  const drawn = new Set(Object.keys(glyphs.glyphs));
  const resolving = catalog.iconIds.filter((id) => drawn.has(id.split('/')[1])).length;
  const slugs = new Set(catalog.iconIds.map((id) => id.split('/')[1]));
  const orphans = [...drawn].filter((g) => !slugs.has(g)).length;
  const text = built.get('forge-icon')?.description ?? '';
  const want = `${drawn.size} glyphs drawn; ${resolving} of ${catalog.iconIds.length.toLocaleString('en-US')} catalog ids resolve to one; ${orphans} drawn glyphs are not catalog ids`;
  if (!text.includes(want)) bad(`forge-icon description does not match the source counts. Source says: ${want}`);
}

// brand.theme.example.json against brand.theme.schema.json (the subset the schema uses).
{
  const dir = join(ROOT, 'tooling/registry/theme');
  const schema = readJson(join(dir, 'brand.theme.schema.json'));
  const example = readJson(join(dir, 'brand.theme.example.json'));
  const hex = new RegExp(schema.$defs.hex.pattern);
  const check = (value, def, where) => {
    if (def.$ref) return check(value, schema.$defs[def.$ref.split('/').pop()], where);
    if (def.enum) { if (!def.enum.includes(value)) bad(`${where}: ${value} not in ${def.enum.join(',')}`); return; }
    if (def.type === 'string') { if (typeof value !== 'string' || (def.pattern && !new RegExp(def.pattern).test(value))) bad(`${where}: invalid string ${value}`); return; }
    if (def.type === 'object') {
      for (const k of def.required ?? []) if (!(k in value)) bad(`${where}: missing ${k}`);
      for (const [k, v] of Object.entries(value)) {
        if (!def.properties[k]) { if (def.additionalProperties === false) bad(`${where}: ${k} is not allowed`); continue; }
        check(v, def.properties[k], `${where}.${k}`);
      }
    }
  };
  void hex;
  check(example, schema, 'brand.theme.example.json');
  const negative = { dark: { accent: '#66B9FF', ink: '#081D2F', soft: '#173C59', base: '#000000' }, light: example.light };
  const before = problems.length;
  check(negative, schema, 'negative');
  if (problems.length === before) bad('schema accepted a brand file that overrides a locked key (base)');
  else problems.length = before;
}

if (problems.length) {
  console.error(`validate-registry: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`validate-registry: ${names.length} items, ${targets.size} installed files, ${nycDeps.size} distinct @nyc-tron dependencies. OK`);
console.log(`validate-registry: @nyc-tron names to confirm against NYC-Tron's built registry: ${[...nycDeps].sort().join(', ')}`);
