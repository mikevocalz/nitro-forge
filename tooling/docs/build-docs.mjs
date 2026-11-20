#!/usr/bin/env node
// Generate docs/components/<item>.md, docs/engines/<pkg>.md, llms.txt and llms-full.txt.
//   node tooling/docs/build-docs.mjs
// Inputs: registry.json and r/ (item facts), docs/agent-native/03-design-handoff.md (handwritten sections),
// a11y-status.json, tokens.map.json, registry-excluded.json, packages/*/package.json.
// Output follows docs/agent-native/doc-template.md with the namespace set per library (decision 32)
// and the a11yStatus values of decision 34. No dependencies. Re-runnable.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, readJson } from '../registry/lib.mjs';

const cfg = config();
const registry = readJson(join(ROOT, 'registry.json'));
const excluded = readJson(join(ROOT, 'registry-excluded.json'));
const a11y = readJson(join(ROOT, 'docs/agent-native/a11y-status.json'));
const handoff = readFileSync(join(ROOT, 'docs/agent-native/03-design-handoff.md'), 'utf8');
const itemsFile = readJson(join(ROOT, 'tooling/registry/items.json'));
const rawBase = `https://raw.githubusercontent.com/${cfg.owner}/nitro-forge/${cfg.nitroForgeRef}`;

const fail = (m) => { console.error(`build-docs: ${m}`); process.exit(1); };
const SECTIONS = ['Purpose', 'Install', 'Props', 'Variants', 'States', 'A11y', 'Example', "Do/Don't"];

// ---- handoff parsing -------------------------------------------------------------------------------
const handoffItems = new Map();
{
  const parts = handoff.split(/\n### `@nitro-forge\/([a-z-]+)`/);
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1];
    const yaml = body.match(/```yaml\n---\n([\s\S]*?)\n---\n```/)?.[1] ?? '';
    const fm = {};
    for (const line of yaml.split('\n')) { const m = line.match(/^(\w+): (.*)$/); if (m) fm[m[1]] = m[2]; }
    const sections = {};
    const chunks = body.split(/\n#### /).slice(1);
    for (const chunk of chunks) {
      const nl = chunk.indexOf('\n');
      const title = chunk.slice(0, nl).trim();
      sections[title] = chunk.slice(nl + 1).replace(/\n##? [^#].*$/s, '').trim();
    }
    handoffItems.set(parts[i], { fm, sections });
  }
}

// ---- import specifier mapping (package form -> installed form) --------------------------------------
const exportsOf = (pkg) => readJson(join(ROOT, 'packages', pkg, 'package.json')).exports;
const stemOfFile = (rel) => rel.replace(/^\.\/src\//, '').replace(/\.(tsx?|jsx?)$/, '');
const installedImport = new Map();
function mapSpec(spec) {
  const dir = '@/components/forge/';
  if (spec.startsWith('./')) return dir + spec.slice(2).replace(/\.(tsx?)$/, '');
  if (installedImport.size === 0) {
    const sw = exportsOf('studio-workspace');
    for (const [key, file] of Object.entries(sw)) installedImport.set(key === '.' ? '@nitro-forge/studio-workspace' : `@nitro-forge/studio-workspace/${key.slice(2)}`, dir + stemOfFile(file));
    installedImport.set('@nitro-forge/icons', `${dir}icons/index`);
    installedImport.set('@nitro-forge/icons/native', `${dir}icons/ForgeIcon`);
    installedImport.set('@nitro-forge/icons/web', `${dir}icons/ForgeIcon`);
  }
  return installedImport.get(spec) ?? null;
}
const remapImports = (code) => code.replace(/(from\s+')([^']+)(')/g, (m, a, spec, c) => {
  const mapped = spec.startsWith('@nitro-forge/') || spec.startsWith('./') ? mapSpec(spec) : null;
  return mapped ? `${a}${mapped}${c}` : m;
});

// ---- helpers ---------------------------------------------------------------------------------------
const q = (s) => JSON.stringify(s);
const arr = (a) => `[${a.map(q).join(', ')}]`;
const rBuilt = (name) => readJson(join(ROOT, 'r', `${name}.json`));
const A11Y_WORDS = { 'reviewed-pass': 'reviewed, no failures found in the source read', 'reviewed-fail': 'reviewed, failures found in the source read', unverified: 'not reviewed or not reviewable from source' };

function requiresLine(item, original) {
  const deps = (item.registryDependencies ?? []).map((d) => `\`${d}\``);
  const pre = (item.meta.prerequisites ?? []).map((p) => `\`${p.id}\` (step ${p.step} of docs/agent-native/install-order.md; shadcn cannot install it)`);
  const notes = (original ?? '').split('; ').filter((seg) => seg && seg !== 'none' && !seg.startsWith('`@nitro-forge/') && !seg.startsWith('`@nyc-tron/'));
  const all = [...deps, ...pre, ...notes];
  return all.length ? all.join('; ') : 'none';
}

function componentPage(item) {
  const name = item.name;
  const def = itemsFile.items.find((i) => i.name === name);
  const h = handoffItems.get(name);
  let sections;
  let displayName;
  let tokens;
  if (name === 'brand-theme') {
    const text = readFileSync(join(ROOT, 'tooling/docs/pages/brand-theme.md'), 'utf8');
    sections = {};
    for (const chunk of text.split(/\n(?=## )/)) { const nl = chunk.indexOf('\n'); sections[chunk.slice(3, nl).trim()] = chunk.slice(nl + 1).trim(); }
    displayName = 'BrandTheme';
    tokens = def.tokens;
  } else {
    if (!h) fail(`${name} has no section in 03-design-handoff.md`);
    displayName = JSON.parse(h.fm.name);
    tokens = JSON.parse(h.fm.tokens);
    sections = { ...h.sections };
  }
  for (const s of SECTIONS) if (!sections[s]) fail(`${name}: section ${s} missing`);

  // Purpose: provider prerequisite first.
  let purpose = sections.Purpose;
  if (name === 'forge-icon') {
    const from = 'the catalog reserves 1,463 ids in 25 categories; 47 have drawn artwork (`glyphIds`).';
    if (!purpose.includes(from)) fail('forge-icon Purpose no longer contains the sentence decision 35 corrects; update the patch in build-docs.mjs');
    purpose = purpose.replace(from, 'the catalog reserves 1,463 ids in 25 categories. 47 glyphs are drawn; 42 of the 1,463 catalog ids resolve to one; 6 drawn glyphs are not catalog ids.');
  }
  if (name !== 'brand-theme') {
    const lines = [];
    if (name === cfg.provider) lines.push('**Prerequisite.** This item is the provider. Install it first, then a host such as `nyc-tron-host`.');
    else if (item.meta.needsProvider) lines.push('**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).');
    else lines.push('**Prerequisite.** No StudioUIProvider is needed.');
    for (const p of item.meta.prerequisites ?? []) lines.push(`Needs \`${p.id}\` first (step ${p.step}). ${p.reason}`);
    purpose = `${lines.join('\n\n')}\n\n${purpose}`;
  }

  // Install: installed import path, generated requires, files.
  let install = sections.Install;
  if (name !== 'brand-theme') {
    install = install.replace(/^- Import: `([^`]*)`(.*)$/m, (m, code, tail) => {
      const stripped = code.replace(/\s*\/\/.*$/, '');
      const moved = remapImports(stripped.replace(/from\s+'([^']+)'/, (mm, spec) => `from '${spec}'`));
      return `- Import: \`${moved}\`${tail ? '' : ''}${/\/\/.*$/.test(code) ? '  (the original line carried a note; see Notes)' : ''}`;
    });
    const orig = install.match(/^- Requires: (.*)$/m)?.[1];
    install = install.replace(/^- Requires: .*$/m, `- Requires: ${requiresLine(item, orig)}`);
  }
  const files = item.files.map((f) => `\`${f.target.replace('@components/', 'components/')}\``).join(', ') || 'none; the item only depends on forge-icon';
  const installs = (item.dependencies ?? []).map((d) => `\`${d}\``).join(', ') || 'none';
  install = install.replace('npx shadcn@latest add', `npx shadcn@${cfg.shadcnVersion} add`);
  install = install.replace(/(^- Command: .*$)/m, `$1\n- Installs: ${installs} (the CLI adds them when they are absent)\n- Files: ${files}`);

  // A11y: review status.
  let a11ySection = sections['A11y'];
  const review = [`- Review status: ${item.meta.a11yStatus}, ${A11Y_WORDS[item.meta.a11yStatus]}. Nothing was rendered, so no item is verified (decision 34).`];
  for (const f of a11y[name]?.failures ?? []) review.push(`- Failing: ${f}`);
  a11ySection = a11ySection.replace(/\n*- Platforms in source:[^\n]*/g, '').trimEnd();
  a11ySection += `\n${review.join('\n')}`;

  // Example and Do/Don't.
  let example = sections.Example;
  example = remapImports(example);
  const dont = sections["Do/Don't"].replace(/^(Do|Don't|Notes)$/gm, '### $1');

  const states = sections.States.replace(/^##### /gm, '### ');
  const variants = sections.Variants.replace(/^##### /gm, '### ');
  const bodies = { Purpose: purpose, Install: install, Props: sections.Props, Variants: variants, States: states, A11y: a11ySection, Example: example, "Do/Don't": dont };

  const main = item.files[0]?.target ?? def.files[0]?.target ?? '';
  const subpath = name === 'forge-icon-button' ? '@/components/forge/icons/ForgeIcon' : `@/components/forge/${main.replace('@components/forge/', '').replace(/\.(tsx?|jsx?)$/, '')}`;
  const regDeps = [...(item.registryDependencies ?? [])].sort();
  const fm = [
    '---',
    `name: ${q(displayName)}`,
    `namespace: ${q(cfg.namespace)}`,
    `subpath: ${q(subpath)}`,
    'tier: 1',
    `docs: ${q('handwritten')}`,
    `platforms: ${arr(item.meta.platforms ?? [])}`,
    `category: ${q(item.meta.category)}`,
    `tokens: ${arr([...tokens].sort())}`,
    `registryDependencies: ${arr(regDeps)}`,
    `a11yStatus: ${q(item.meta.a11yStatus)}`,
    '---',
  ].join('\n');
  const body = SECTIONS.map((s) => `## ${s}\n\n${bodies[s].trim()}\n`).join('\n');
  return { text: `${fm}\n\n# ${displayName}\n\n${body}`, displayName };
}

// ---- engine pages ----------------------------------------------------------------------------------
function engineSource(pkg) {
  const dir = join(ROOT, 'packages', pkg);
  if (!existsSync(join(dir, 'package.json'))) return null;
  const pj = readJson(join(dir, 'package.json'));
  const idx = join(dir, 'src', 'index.ts');
  const exportsList = existsSync(idx)
    ? [...readFileSync(idx, 'utf8').matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1])
    : [];
  return { pj, exportsList, readme: existsSync(join(dir, 'README.md')) };
}
const manifestTask = (() => {
  const text = readFileSync(join(ROOT, 'packages/studio-workspace/src/app-manifest.ts'), 'utf8');
  const out = {};
  for (const m of text.matchAll(/^\s{2}([a-z]+): \{ task: '([^']+)'/gm)) out[m[1]] = m[2];
  return out;
})();
const pascal = (s) => s.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const PLACEHOLDER = '_Not documented._';

function enginePage(entry, kind) {
  const src = engineSource(entry.name);
  if (!src) fail(`packages/${entry.name} not found for ${entry.name}`);
  const { pj, exportsList } = src;
  const description = (pj.description || '').trim() || 'The package has no description field.';
  const exportKeys = Object.keys(pj.exports ?? {}).map((k) => (k === '.' ? entry.package : `${entry.package}/${k.slice(2)}`));
  const task = manifestTask[entry.name];
  const mark = (section, files, body) => `<!-- generated:begin ${section} source=${files} -->\n${body}\n<!-- generated:end ${section} -->`;
  const pkgJson = `packages/${entry.name}/package.json`;
  const purpose = [
    `${description}`,
    kind === 'engine' ? (task ? `Studio task line (APP_MANIFESTS): "${task}".` : 'No studio manifest names this engine.') : '',
    `Not a registry item. ${entry.reason}`,
  ].filter(Boolean).join(' ');
  const installBody = [
    `- Package: \`${entry.package}\``,
    `- Import: \`import {} from '${entry.package}';\``,
    `- Peers: ${Object.keys(pj.peerDependencies ?? {}).map((p) => `\`${p}\``).join(', ') || 'none'}`,
    `- Requires: ${entry.name === 'ignition' ? 'Rust, Xcode or the Android NDK; see docs/agent-native/install-order.md steps 0 and 1' : '`@nitro-forge/ignition` (native host, install-order.md step 1)'}`,
    `- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is ${pj.version} inside a monorepo. Install by \`workspace:*\` inside this repo.`,
    '- Installs: none',
    `- Files: \`packages/${entry.name}\` in the repo; nothing is copied by shadcn`,
  ].join('\n');
  const propsBody = `Not a component, so there are no props. ${exportKeys.length} entry point${exportKeys.length === 1 ? '' : 's'}: ${exportKeys.map((k) => `\`${k}\``).join(', ')}. ${exportsList.length ? `Top-level exports of \`src/index.ts\` (${exportsList.length}): ${exportsList.slice(0, 40).map((e) => `\`${e}\``).join(', ')}${exportsList.length > 40 ? ', and more' : ''}.` : ''}`;
  const doBody = kind === 'engine'
    ? `### Do\n\n- Read \`docs/ENGINE_OPS.md\` for the op names and payloads of \`${entry.name}\` before calling \`apply\`.\n- Treat \`${entry.package}\` as a monorepo dependency until a tarball release exists.\n\n### Don't\n\n- Do not run \`shadcn add\` for this package; it has no registry item (${entry.package} needs the Rust binary).\n- Do not claim an npm install; \`compatibility.v1.json\` records npm as not used.`
    : `### Do\n\n- Follow the commands in docs/agent-native/install-order.md for \`${entry.package}\`.\n- Check \`registry-excluded.json\` for the reason and the condition for returning.\n\n### Don't\n\n- Do not run \`shadcn add\` for this package; ${entry.reason.split('.')[0]}.\n- Do not publish or invent a release URL for it.`;
  const sections = {
    Purpose: [purpose, `${pkgJson}${task ? ',packages/studio-workspace/src/app-manifest.ts' : ''}`],
    Install: [installBody, `${pkgJson},compatibility.v1.json`],
    Props: [propsBody, `${pkgJson},packages/${entry.name}/src/index.ts`],
    Variants: ['none', pkgJson],
    States: [PLACEHOLDER, pkgJson],
    A11y: [PLACEHOLDER, pkgJson],
    Example: [PLACEHOLDER, pkgJson],
    "Do/Don't": [doBody, 'registry-excluded.json'],
  };
  const fm = [
    '---',
    `name: ${q(pascal(entry.name))}`,
    `namespace: ${q(cfg.namespace)}`,
    `subpath: ${q(entry.package)}`,
    'tier: 2',
    `docs: ${q('generated')}`,
    'platforms: []',
    `category: ${q(kind === 'engine' ? 'forge' : 'primitive')}`,
    'tokens: []',
    'registryDependencies: []',
    `a11yStatus: ${q('unverified')}`,
    '---',
  ].join('\n');
  const key = (s) => (s === "Do/Don't" ? 'dont' : s.toLowerCase());
  const body = SECTIONS.map((s) => `## ${s}\n\n${mark(key(s), sections[s][1], sections[s][0])}\n`).join('\n');
  return `${fm}\n\n# ${pascal(entry.name)}\n\n${body}`;
}

// ---- write -----------------------------------------------------------------------------------------
const compDir = join(ROOT, 'docs/components');
const engDir = join(ROOT, 'docs/engines');
rmSync(compDir, { recursive: true, force: true });
rmSync(engDir, { recursive: true, force: true });
mkdirSync(compDir, { recursive: true });
mkdirSync(engDir, { recursive: true });

const pages = [];
for (const entry of registry.items) {
  const item = rBuilt(entry.name);
  const { text, displayName } = componentPage(item);
  writeFileSync(join(compDir, `${entry.name}.md`), text);
  pages.push({ kind: 'component', id: entry.name, displayName, item, text });
}
const enginePages = [];
for (const e of excluded.engines) enginePages.push({ entry: e, kind: 'engine' });
for (const e of excluded.foundations) enginePages.push({ entry: e, kind: 'foundation' });
for (const { entry, kind } of enginePages) {
  const text = enginePage(entry, kind);
  writeFileSync(join(engDir, `${entry.name}.md`), text);
  pages.push({ kind, id: entry.name, displayName: pascal(entry.name), entry, text });
}

// ---- llms.txt and llms-full.txt --------------------------------------------------------------------
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const providerGroup = registry.items.filter((i) => rBuilt(i.name).meta.needsProvider);
const noProvider = registry.items.filter((i) => !rBuilt(i.name).meta.needsProvider);
const link = (path, title, desc) => `- [${title}](${rawBase}/${path}): ${oneLine(desc)}`;
const llms = [
  '# Nitro Forge',
  '',
  `> Document studios on one Rust engine, with a shadcn registry (@nitro-forge) for the studio-workspace chrome, theme, provider and icons. Controls come from @nyc-tron. Nothing is on npm: the engines, ignition and studio-layout are monorepo packages at 0.0.0, and steps 1 to 3 of the install order cannot be reproduced outside this repo today. The links use the moving branch ${'`' + cfg.nitroForgeRef + '`'}, not a release tag, until the owner cuts one.`,
  '',
  'Start here: the provider prerequisite. Every studio component throws without StudioUIProvider (install studio-ui-provider and nyc-tron-host first). Install order has nine steps, numbered 0 to 8; a registry add covers steps 4 and 8 and the file parts of 5, 6 and 7.',
  '',
  '## Install and rules',
  '',
  link('docs/agent-native/install-order.md', 'Install order', 'The nine-step chain, which steps `shadcn add` covers, and the commands for the rest.'),
  link('SKILL.md', 'Agent skill', 'Provider first, install order, rebrand contract, token rules, what is deferred and why.'),
  link('AGENTS.md', 'Agent guide', 'Contracts, commands and contributor rules, plus the agent-native section.'),
  link('registry-excluded.json', 'Not in the registry', 'Four deferred adapters, 12 engines, ignition and studio-layout, each with a reason.'),
  '',
  `## Needs StudioUIProvider (${providerGroup.length})`,
  '',
  ...providerGroup.map((i) => link(`docs/components/${i.name}.md`, i.title, i.description)),
  '',
  `## No provider needed (${noProvider.length})`,
  '',
  ...noProvider.map((i) => link(`docs/components/${i.name}.md`, i.title, i.description)),
  '',
  '## Engines and foundations (docs only, no registry item)',
  '',
  ...enginePages.map(({ entry }) => link(`docs/engines/${entry.name}.md`, entry.package, entry.reason.split('. ')[0] + '.')),
  '',
  '## Optional',
  '',
  link('docs/agent-native/02-design-system.md', 'Design system', 'Token tiers, the rebrand contract and the five colour drift records.'),
  link('docs/agent-native/05-accessibility-review.md', 'Accessibility review', 'Source review of the 17 items; no item is verified.'),
  link('llms-full.txt', 'Full text', 'Every page above in one file.'),
  '',
].join('\n');
writeFileSync(join(ROOT, 'llms.txt'), llms);

const full = [llms, '\n---\n'];
for (const p of pages) full.push(`\n<!-- ${p.kind}: ${p.id} -->\n${p.text}`);
for (const f of ['docs/agent-native/install-order.md', 'SKILL.md']) {
  if (existsSync(join(ROOT, f))) full.push(`\n<!-- file: ${f} -->\n${readFileSync(join(ROOT, f), 'utf8')}`);
}
writeFileSync(join(ROOT, 'llms-full.txt'), full.join('\n'));

const size = (f) => readFileSync(join(ROOT, f)).length;
console.log(`build-docs: ${registry.items.length} component pages, ${enginePages.length} engine pages`);
console.log(`build-docs: llms.txt ${size('llms.txt')} bytes (~${Math.round(size('llms.txt') / 4)} tokens), llms-full.txt ${size('llms-full.txt')} bytes (~${Math.round(size('llms-full.txt') / 4)} tokens)`);
