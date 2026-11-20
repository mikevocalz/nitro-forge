#!/usr/bin/env node
// Enforce the docs contract. Exit 1 on any failure. No dependencies.
//  - every registry item has docs/components/<name>.md, and no orphan page exists
//  - front matter parses under the template's restricted YAML subset and matches the registry
//  - eight sections in order, install labels in order, Do/Don't bullets, example imports resolve
//  - tokens named exist in tokens.map.json, links resolve, every excluded engine has a page
//  - llms.txt lists every component page, SKILL.md and AGENTS.md stay within their rules
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { ROOT, config, readJson, scanImports } from '../registry/lib.mjs';

const cfg = config();
const registry = readJson(join(ROOT, 'registry.json'));
const excluded = readJson(join(ROOT, 'registry-excluded.json'));
const tokens = new Set(readJson(join(ROOT, 'docs/agent-native/tokens.map.json')).tokens.map((t) => t.name));
const problems = [];
const bad = (file, msg) => problems.push(`${file}: ${msg}`);

const SECTIONS = ['Purpose', 'Install', 'Props', 'Variants', 'States', 'A11y', 'Example', "Do/Don't"];
const KEYS = ['name', 'namespace', 'subpath', 'tier', 'docs', 'platforms', 'category', 'tokens', 'registryDependencies', 'a11yStatus'];
const CATEGORIES = ['primitive', 'input', 'display', 'feedback', 'navigation', 'overlay', 'layout', 'data', 'shell', 'forge'];
const PLATFORMS = ['ios', 'android', 'web', 'windows', 'macos', 'qnx'];
const A11Y = ['reviewed-pass', 'reviewed-fail', 'unverified'];
const INSTALL_LABELS = ['Package', 'Import', 'Peers', 'Requires', 'Command', 'Installs', 'Files'];

function parseFrontMatter(file, text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) { bad(file, 'no front matter'); return null; }
  const fm = {};
  const lines = m[1].split('\n');
  lines.forEach((line, i) => {
    const k = line.match(/^([A-Za-z0-9]+): (.+)$/);
    if (!k) return bad(file, `front matter line ${i + 1} does not match key: value`);
    if (k[1] !== KEYS[i]) bad(file, `front matter key ${i + 1} is ${k[1]}, expected ${KEYS[i]}`);
    try { fm[k[1]] = JSON.parse(k[2]); } catch { bad(file, `front matter ${k[1]} is not valid JSON-style value`); }
  });
  if (lines.length !== KEYS.length) bad(file, `front matter has ${lines.length} keys, expected ${KEYS.length}`);
  return { fm, rest: text.slice(m[0].length) };
}

function checkPage(file, text, expectedName) {
  const parsed = parseFrontMatter(file, text);
  if (!parsed) return null;
  const { fm, rest } = parsed;
  if (!/^[A-Z][A-Za-z0-9]*$/.test(fm.name ?? '')) bad(file, `name ${fm.name} is not PascalCase`);
  if (fm.namespace !== cfg.namespace) bad(file, `namespace ${fm.namespace}, expected ${cfg.namespace}`);
  if (![1, 2].includes(fm.tier)) bad(file, 'tier must be 1 or 2');
  if (!['handwritten', 'generated'].includes(fm.docs)) bad(file, 'docs invalid');
  if ((fm.tier === 1) !== (fm.docs === 'handwritten')) bad(file, 'tier 1 must be handwritten and tier 2 generated');
  if (!CATEGORIES.includes(fm.category)) bad(file, `category ${fm.category} not in enum`);
  if (!Array.isArray(fm.platforms) || JSON.stringify(PLATFORMS.filter((p) => fm.platforms.includes(p))) !== JSON.stringify(fm.platforms)) bad(file, 'platforms not a sorted subset of the enum');
  if (!A11Y.includes(fm.a11yStatus)) bad(file, `a11yStatus ${fm.a11yStatus} not in ${A11Y.join(', ')}`);
  for (const t of fm.tokens ?? []) if (!tokens.has(t)) bad(file, `token ${t} is not in tokens.map.json`);
  if (JSON.stringify(fm.tokens) !== JSON.stringify([...(fm.tokens ?? [])].sort())) bad(file, 'tokens not sorted');
  const h1 = rest.match(/^# (.+)$/m)?.[1];
  if (h1 !== fm.name) bad(file, `h1 "${h1}" differs from name "${fm.name}"`);
  const h2 = [...rest.matchAll(/^## (.+)$/gm)].map((x) => x[1]);
  if (JSON.stringify(h2) !== JSON.stringify(SECTIONS)) bad(file, `sections are ${h2.join(' | ')}`);
  const marks = /<!-- generated:(begin|end)/.test(rest);
  if (fm.docs === 'handwritten' && marks) bad(file, 'handwritten page has generated markers');
  if (fm.docs === 'generated') {
    const begins = (rest.match(/<!-- generated:begin/g) ?? []).length;
    const ends = (rest.match(/<!-- generated:end/g) ?? []).length;
    if (begins !== 8 || ends !== 8) bad(file, `generated page has ${begins} begin and ${ends} end markers, expected 8`);
  }
  if (fm.tier === 1 && rest.includes('_Not documented._')) bad(file, 'tier 1 page uses the placeholder');
  if (expectedName && fm.name !== expectedName) bad(file, `name ${fm.name}, expected ${expectedName}`);

  // Install labels, in order.
  const install = rest.split(/^## Install$/m)[1]?.split(/^## /m)[0] ?? '';
  const labels = [...install.matchAll(/^- ([A-Za-z]+):/gm)].map((x) => x[1]);
  if (JSON.stringify(labels) !== JSON.stringify(INSTALL_LABELS)) bad(file, `Install labels are ${labels.join(', ')}`);

  // Do/Don't bullets.
  const dd = rest.split(/^## Do\/Don't$/m)[1] ?? '';
  const doPart = dd.split(/^### Don't$/m)[0].split(/^### Do$/m)[1] ?? '';
  const dontPart = (dd.split(/^### Don't$/m)[1] ?? '').split(/^### Notes$/m)[0];
  const bullets = (s) => (s.match(/^- /gm) ?? []).length;
  if (bullets(doPart) < 2 || bullets(dontPart) < 2) bad(file, `Do/Don't need two bullets each (have ${bullets(doPart)} and ${bullets(dontPart)})`);

  // Example block and its imports.
  if (fm.tier === 1) {
    const ex = rest.match(/```tsx example=([a-z-]+)\n([\s\S]*?)```/);
    if (!ex) bad(file, 'no ```tsx example=<name> block');
    else {
      for (const spec of scanImports(ex[2])) {
        if (spec.startsWith('@/components/forge/')) {
          const stem = spec.slice('@/components/forge/'.length);
          const exists = registry.items.some((it) => (it.files ?? []).some((f) => f.target.replace(`${cfg.installDir}/`, '').replace(/\.(tsx?|jsx?)$/, '') === stem));
          const builtExists = existsSync(join(ROOT, 'r')) && readdirSync(join(ROOT, 'r')).some((n) => n.endsWith('.json') && n !== 'registry.json' && (readJson(join(ROOT, 'r', n)).files ?? []).some((f) => f.target.replace(`${cfg.installDir}/`, '').replace(/\.(tsx?|jsx?)$/, '') === stem));
          if (!exists && !builtExists) bad(file, `example imports ${spec}, which no item installs`);
        } else if (!['react', 'react-native', 'uniwind'].includes(spec) && !spec.startsWith('@/components/nyc-tron/ui/') && !spec.startsWith('@nyc-tron/')) bad(file, `example imports ${spec}, which is not an installed path`);
      }
    }
  }

  // Links.
  for (const m of rest.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    if (!existsSync(resolve(dirname(join(ROOT, file)), target.split('#')[0]))) bad(file, `link ${target} does not resolve`);
  }
  return fm;
}

// Components.
const compDir = join(ROOT, 'docs/components');
const compFiles = existsSync(compDir) ? readdirSync(compDir).filter((f) => f.endsWith('.md')) : [];
const names = registry.items.map((i) => i.name);
for (const n of names) if (!compFiles.includes(`${n}.md`)) bad(`docs/components/${n}.md`, 'registry item has no page');
for (const f of compFiles) if (!names.includes(f.slice(0, -3))) bad(`docs/components/${f}`, 'orphan page: no registry item');
for (const item of registry.items) {
  const file = `docs/components/${item.name}.md`;
  if (!existsSync(join(ROOT, file))) continue;
  const fm = checkPage(file, readFileSync(join(ROOT, file), 'utf8'));
  if (!fm) continue;
  const built = readJson(join(ROOT, 'r', `${item.name}.json`));
  if (JSON.stringify(fm.registryDependencies) !== JSON.stringify([...(built.registryDependencies ?? [])].sort())) bad(file, 'registryDependencies differ from r/');
  if (fm.a11yStatus !== built.meta.a11yStatus) bad(file, 'a11yStatus differs from r/');
  if (JSON.stringify(fm.platforms) !== JSON.stringify(built.meta.platforms ?? [])) bad(file, 'platforms differ from r/');
  if (built.meta.docsPath !== file) bad(file, `meta.docsPath is ${built.meta.docsPath}`);
  const text = readFileSync(join(ROOT, file), 'utf8');
  if (!/^\*\*Prerequisite\.\*\*/m.test(text.split('## Purpose')[1] ?? '') && item.name !== 'brand-theme') bad(file, 'Purpose does not open with the prerequisite');
  for (const dep of fm.registryDependencies) if (dep.startsWith('@nitro-forge/') && !names.includes(dep.slice(13))) bad(file, `registryDependency ${dep} has no page`);
}
if (existsSync(join(compDir, 'forge-icon.md')) && !readFileSync(join(compDir, 'forge-icon.md'), 'utf8').includes('42 of the 1,463 catalog ids resolve to one')) bad('docs/components/forge-icon.md', 'icon wording does not follow decision 35');

// Engines and foundations.
const engDir = join(ROOT, 'docs/engines');
const engFiles = existsSync(engDir) ? readdirSync(engDir).filter((f) => f.endsWith('.md')) : [];
const engNames = [...excluded.engines, ...excluded.foundations].map((e) => e.name);
for (const n of engNames) if (!engFiles.includes(`${n}.md`)) bad(`docs/engines/${n}.md`, 'excluded package has no page');
for (const f of engFiles) if (!engNames.includes(f.slice(0, -3))) bad(`docs/engines/${f}`, 'orphan page: not in registry-excluded.json');
for (const f of engFiles) checkPage(`docs/engines/${f}`, readFileSync(join(engDir, f), 'utf8'));
for (const n of names) if (engNames.includes(n)) bad(n, 'is both a registry item and excluded');

// llms.txt.
if (!existsSync(join(ROOT, 'llms.txt'))) bad('llms.txt', 'missing');
else {
  const llms = readFileSync(join(ROOT, 'llms.txt'), 'utf8');
  if (!llms.startsWith('# ')) bad('llms.txt', 'must start with an H1');
  if (!/^> /m.test(llms)) bad('llms.txt', 'needs a blockquote summary');
  for (const n of names) if (!llms.includes(`docs/components/${n}.md`)) bad('llms.txt', `does not list ${n}`);
  for (const n of engNames) if (!llms.includes(`docs/engines/${n}.md`)) bad('llms.txt', `does not list engine page ${n}`);
  if (llms.length > 12000) bad('llms.txt', `${llms.length} bytes is larger than the 12,000 byte budget`);
  for (const m of llms.matchAll(/\]\((https:\/\/raw\.githubusercontent\.com\/[^/]+\/nitro-forge\/[^/]+\/([^)]+))\)/g)) if (!existsSync(join(ROOT, m[2]))) bad('llms.txt', `link target ${m[2]} does not exist in the repo`);
  if (/—/.test(llms)) bad('llms.txt', 'em dash');
}
// SKILL.md.
if (!existsSync(join(ROOT, 'SKILL.md'))) bad('SKILL.md', 'missing');
else {
  const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
  const lines = skill.split('\n').length;
  if (lines >= 500) bad('SKILL.md', `${lines} lines; the limit is under 500`);
  const fm = skill.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
  if (!fm) bad('SKILL.md', 'front matter must be name and description');
  else if (fm[2].length > 1024) bad('SKILL.md', 'description over 1024 characters');
  const firstSection = skill.match(/^## (.+)$/m)?.[1] ?? '';
  if (!/provider/i.test(firstSection)) bad('SKILL.md', `first section is "${firstSection}", must be the provider prerequisite`);
  {
    const listed = skill.match(/Items that do not: ([^\n]+)\./)?.[1]?.match(/`([a-z-]+)`/g)?.map((x) => x.replaceAll('`', '')).sort() ?? [];
    const computed = registry.items.map((i) => i.name).filter((n) => n !== cfg.provider && readJson(join(ROOT, 'r', `${n}.json`)).meta.needsProvider === false).sort();
    if (JSON.stringify(listed) !== JSON.stringify(computed)) bad('SKILL.md', `provider-free list is ${listed.join(',')}, r/ says ${computed.join(',')}`);
    const counts = { 'reviewed-pass': 0, 'reviewed-fail': 0, unverified: 0 };
    const admitted = registry.items.filter((i) => i.name !== 'brand-theme');
    for (const i of admitted) counts[readJson(join(ROOT, 'r', `${i.name}.json`)).meta.a11yStatus] += 1;
    const want = `${admitted.length} admitted items, ${counts['reviewed-pass']} are reviewed-pass, ${counts['reviewed-fail']} are reviewed-fail and ${counts.unverified} (`;
    if (!skill.includes(want.replace('Of the ', '')) && !skill.includes(`Of the ${want}`)) bad('SKILL.md', `a11y counts do not match r/: ${want}`);
  }
  for (const m of skill.matchAll(/@nitro-forge\/([a-z-]+)/g)) {
    if (!names.includes(m[1]) && !engNames.includes(m[1]) && !['studio-workspace', 'icons'].includes(m[1])) bad('SKILL.md', `mentions @nitro-forge/${m[1]}, which is neither an item nor a known package`);
  }
}
// AGENTS.md.
{
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  if (!/^## Agent-native$/m.test(agents)) bad('AGENTS.md', 'no "Agent-native" section');
  if (/seven document engines/i.test(agents)) bad('AGENTS.md', 'still says seven engines');
}

if (problems.length) {
  console.error(`check-docs: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-docs: ${compFiles.length} component pages, ${engFiles.length} engine pages, llms.txt, SKILL.md, AGENTS.md. OK`);
