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
const EXAMPLES = 'tooling/docs/examples';
const EXAMPLE_TEST = 'tooling/docs/examples.test.ts';

/** The tested example for an engine or foundation page: tooling/docs/examples/<name>.ts. */
function exampleOf(name) {
  const rel = `${EXAMPLES}/${name}.ts`;
  if (!existsSync(join(ROOT, rel))) fail(`${rel} is missing. Every engine and foundation page shows a tested example.`);
  const code = readFileSync(join(ROOT, rel), 'utf8').trimEnd();
  const ops = code.match(/^export const ops = \[([^\]]*)\]/m)?.[1].match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
  const engine = code.match(/^export const engine = '([a-z]+)'/m)?.[1];
  const imports = [...code.matchAll(/^import (?!type ).* from '(@nitro-forge\/[^']+)';$/gm)].map((m) => ({ line: m[0], spec: m[1] }));
  return { rel, code, ops, engine, imports };
}

const ENGINE_REQUIRES = '`@nitro-forge/ignition` (native host, install-order.md step 1)';
// The old NYC-Tron path of the editor controls, built from parts so this file does not match
// tooling/verify-nyc-tron-pin.mjs's check for imports of it.
const OLD_FORGE = '@nyc-tron/ui/components/' + 'forge/';
const FOUNDATION = {
  ignition: {
    requires: 'Rust, Xcode or the Android NDK; see docs/agent-native/install-order.md steps 0 and 1',
    states: 'A `DocumentHandle` is live from `open`, `openInitialized` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed `apply` throws `EngineError` and leaves the document, its ids and both history stacks unchanged; `applyBatch` takes 1 to 64 commands and commits them as one undo step. `undo` and `redo` resolve `false` when there is nothing to move. Contract: docs/ARCHITECTURE.md.',
    a11y: 'Not UI. Nothing in this package renders, so there is nothing to review. The studio components that render engine state carry their own A11y sections in docs/components/.',
    dont: [
      "Do not call `__undo`, `__redo` or `__snapshot` through `apply`; they are host ops. Use `undo()`, `redo()` and `snapshot()`.",
      'Do not run `shadcn add` for this package; shadcn cannot run nitrogen, pod install or CMake (decision 4).',
    ],
    do: [
      'Create the host once per app with `createNitroHost()`; in Node tests use `new CliHost()` from `@nitro-forge/ignition/cli` after `cargo build --locked -p nf-cli`.',
      'Prefer an engine facade (`TallyDocument`, `PrismDocument` and the rest) over raw `apply` calls; the facades carry the payload types from docs/ENGINE_OPS.md.',
    ],
  },
  'studio-layout': {
    requires: 'none; pure TypeScript with no runtime dependencies',
    states: 'Pure functions over a `Layout` value. `dockPanel`, `collapsePanel`, `floatPanel` and `resizeDock` return `{ ok: true, layout }` or `{ ok: false, layout, reason }`, where a failed call returns the layout it was given. `parsePreset` returns `null` for a preset it rejects.',
    a11y: 'Not UI. The workspace chrome that renders a layout (`forge-workspace`) carries its own A11y section.',
    do: [
      'Validate saved presets with `parsePreset` before making them active.',
      'Pass the set of panel ids the studio knows; unknown ids fail with `unknown-panel`.',
    ],
    dont: [
      'Do not run `shadcn add` for this package; it is a private workspace package with no tarball (decision 3).',
      'Do not mutate a `Layout` in place; use the returned layout.',
    ],
  },
  'editor-controls': {
    requires: '`@nyc-tron/ui` from the release pinned in `tooling/nyc-tron.json`, with `patches/@nyc-tron__ui@1.0.0-rc.2.patch` adding 20 export-map entries rc.2 lacks (packages/editor-controls/README.md)',
    purpose: 'The editor controls (audio and MIDI, timeline, spreadsheet, canvas and layers, color, photo, motion, vector, office, PDF) moved here unchanged from NYC-Tron UI\'s `packages/ui/src/components/forge/` at commit `5a1ea4db`. Import them as `@nitro-forge/editor-controls/<path>`: the export `./<path>` is the old `' + OLD_FORGE + '<path>`, except three precision helpers that now come from `@nyc-tron/ui/components/shell/`. Nothing in Forge may import `' + OLD_FORGE + '*`; `node tooling/verify-nyc-tron-pin.mjs` fails if anything does.',
    states: 'Controlled components: the caller passes values and callbacks. The controls own no persistence, file I/O, engine state or undo; the engine adapters (`@nitro-forge/cadence`, `@nitro-forge/tally` and the rest) supply those.',
    a11y: 'Not part of the agent-native source review, so nothing here is verified (decision 34). The package has its own render tests, including `packages/editor-controls/tests/render/screen-reader-audit.render.test.mjs`; this page does not restate their results.',
    do: [
      'Add `"@nitro-forge/editor-controls": "workspace:*"` to the consuming package and import `@nitro-forge/editor-controls/<path>`.',
      'Run `pnpm --filter @nitro-forge/editor-controls build` before typechecking a consumer on its own; consumers typecheck against `dist/`.',
      'Extend the control that exists here (knob, graph, crop overlay and the rest) instead of writing a second one in another package.',
    ],
    dont: [
      'Do not import `' + OLD_FORGE + '*` or depend on `@nyc-tron/forge/*` registry items; the controls live here now.',
      'Do not run `shadcn add` for this package; it is a private workspace package with no tarball (decision 3).',
    ],
  },
};

const MAX_ENTRY_POINTS = 16;

function enginePage(entry, kind) {
  const src = engineSource(entry.name);
  if (!src) fail(`packages/${entry.name} not found for ${entry.name}`);
  const { pj, exportsList } = src;
  const f = FOUNDATION[entry.name];
  const ex = exampleOf(entry.name);
  const description = (pj.description || '').trim() || 'The package has no description field.';
  const exportKeys = Object.keys(pj.exports ?? {}).map((k) => (k === '.' ? entry.package : `${entry.package}/${k.slice(2)}`));
  const task = manifestTask[entry.name];
  const mark = (section, files, body) => `<!-- generated:begin ${section} source=${files} -->\n${body}\n<!-- generated:end ${section} -->`;
  const pkgJson = `packages/${entry.name}/package.json`;
  const purpose = [
    `${description}`,
    kind === 'engine' ? (task ? `Studio task line (APP_MANIFESTS): "${task}".` : 'No studio manifest names this engine.') : '',
    f?.purpose ?? '',
    `Not a registry item. ${entry.reason}`,
  ].filter(Boolean).join(' ');
  const own = ex.imports.filter((i) => i.spec === entry.package || i.spec.startsWith(`${entry.package}/`));
  if (own.length === 0) fail(`${ex.rel} does not import ${entry.package}`);
  const installBody = [
    `- Package: \`${entry.package}\``,
    `- Import: ${own.map((i) => `\`${i.line}\``).join(' ')}`,
    `- Peers: ${Object.keys(pj.peerDependencies ?? {}).map((p) => `\`${p}\``).join(', ') || 'none'}`,
    `- Requires: ${f?.requires ?? ENGINE_REQUIRES}`,
    `- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is ${pj.version} inside a monorepo. Install by \`workspace:*\` inside this repo.`,
    '- Installs: none',
    `- Files: \`packages/${entry.name}\` in the repo; nothing is copied by shadcn`,
  ].join('\n');
  const shownKeys = exportKeys.slice(0, MAX_ENTRY_POINTS).map((k) => `\`${k}\``).join(', ');
  const moreKeys = exportKeys.length > MAX_ENTRY_POINTS ? `, and ${exportKeys.length - MAX_ENTRY_POINTS} more in \`${pkgJson}\`` : '';
  const propsBody = `Not a component, so there are no props. ${exportKeys.length} entry point${exportKeys.length === 1 ? '' : 's'}: ${shownKeys}${moreKeys}. ${exportsList.length ? `Top-level exports of \`src/index.ts\` (${exportsList.length}): ${exportsList.slice(0, 40).map((e) => `\`${e}\``).join(', ')}${exportsList.length > 40 ? ', and more' : ''}.` : ''}`.trim();

  const opsEngine = ex.engine ?? entry.name;
  const states = f?.states ?? `A document is live from \`open\`${entry.name === 'folio' ? ', `create`, `openPdf`' : ''} or \`openSnapshot\` until \`close\`. After \`close\`, every call throws \`document handle <id> is closed\`. A failed op throws \`EngineError\` and leaves the document, its ids and its undo history unchanged. \`save()\` returns the NFD1 snapshot bytes that \`openSnapshot\` reads. \`undo()\` and \`redo()\` resolve \`false\` when there is nothing to move.`;
  const a11y = f?.a11y ?? `Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show ${entry.name} state carry their own A11y sections in docs/components/.`;
  const host = ex.ops.length
    ? 'The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.'
    : '';
  const tested = ex.ops.length
    ? `\`pnpm test:docs-examples\` runs this file (\`${ex.rel}\`) against the real engine through nf-cli (\`${EXAMPLE_TEST}\`). It fails if the example sends an op it does not declare, or declares one that is missing from the ${opsEngine}-engine section of docs/ENGINE_OPS.md or from the package source. Ops: ${ex.ops.map((o) => `\`${o}\``).join(', ')}.`
    : `\`pnpm test:docs-examples\` runs this file (\`${ex.rel}\`) in Node (\`${EXAMPLE_TEST}\`).`;
  const exampleBody = [tested, host, `\`\`\`ts example=${entry.name}\n${ex.code}\n\`\`\``].filter(Boolean).join('\n\n');

  const bullets = (list) => list.map((b) => `- ${b}`).join('\n');
  const doBody = f
    ? `### Do\n\n${bullets(f.do)}\n- Check \`registry-excluded.json\` for the reason and the condition for returning.\n\n### Don't\n\n${bullets(f.dont)}\n- Do not publish or invent a release URL for it.`
    : `### Do\n\n- Read the ${entry.name}-engine section of \`docs/ENGINE_OPS.md\` for op names and payloads before calling \`apply\`.\n- Group several edits that must undo together with \`handle.applyBatch\` (one undo step).\n- Treat \`${entry.package}\` as a monorepo dependency until a tarball release exists.\n\n### Don't\n\n- Do not run \`shadcn add\` for this package; it has no registry item (${entry.package} needs the Rust binary).\n- Do not claim an npm install; \`compatibility.v1.json\` records npm as not used.\n- Do not keep your own undo stack; the engine records one entry per mutating op.`;
  const sections = {
    Purpose: [purpose, `${pkgJson}${task ? ',packages/studio-workspace/src/app-manifest.ts' : ''}`],
    Install: [installBody, `${pkgJson},compatibility.v1.json,${ex.rel}`],
    Props: [propsBody, `${pkgJson},packages/${entry.name}/src/index.ts`],
    Variants: ['none', pkgJson],
    States: [states, `packages/ignition/src/document.ts,${pkgJson}`],
    A11y: [a11y, pkgJson],
    Example: [exampleBody, `${ex.rel},docs/ENGINE_OPS.md`],
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
  return { text: `${fm}\n\n# ${pascal(entry.name)}\n\n${body}`, task, description, ops: ex.ops };
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
for (const p of enginePages) {
  const page = enginePage(p.entry, p.kind);
  writeFileSync(join(engDir, `${p.entry.name}.md`), page.text);
  Object.assign(p, page);
  pages.push({ kind: p.kind, id: p.entry.name, displayName: pascal(p.entry.name), entry: p.entry, text: page.text });
}

// ---- llms.txt and llms-full.txt --------------------------------------------------------------------
// Links are relative to llms.txt, so whoever fetches it from a ref (branch, tag or commit) reads the pages
// of that same ref. Nothing here names a moving branch.
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const providerGroup = registry.items.filter((i) => rBuilt(i.name).meta.needsProvider);
const noProvider = registry.items.filter((i) => !rBuilt(i.name).meta.needsProvider);
const link = (path, title, desc) => `- [${title}](${path}): ${oneLine(desc)}`;
const versions = [...new Set(enginePages.map(({ entry }) => readJson(join(ROOT, 'packages', entry.name, 'package.json')).version))].sort();
const FOUNDATION_LINE = {
  ignition: 'Engine host and DocumentHandle: open, apply, applyBatch, snapshot, restore, undo, redo, close.',
  'studio-layout': 'Dock and panel layout model behind the studio workspace. Pure functions, no UI.',
  'editor-controls': 'The editor controls (audio, timeline, spreadsheet, layers, color, photo, motion, office). Import @nitro-forge/editor-controls/<path>, never @nyc-tron/ui/components/forge/*.',
};
const engineLine = ({ entry, kind, task, description, ops }) => {
  const what = kind === 'engine' ? (task ?? description) : FOUNDATION_LINE[entry.name] ?? description;
  return `${what} Tested example${ops.length ? ` (ops ${ops.join(', ')})` : ''}.`;
};
const counts = `${excluded.adapters.length} deferred adapters, ${excluded.engines.length} engines and ${excluded.foundations.length} foundations (${excluded.foundations.map((f) => f.name).join(', ')})`;
const llms = [
  '# Nitro Forge',
  '',
  `> Document studios on ${excluded.engines.length} Rust engines, with a shadcn registry (@nitro-forge) for the studio-workspace chrome, theme, provider and icons. General controls come from @nyc-tron; the editor controls are @nitro-forge/editor-controls. Nothing is on npm and nothing is tagged: the engines, ignition, studio-layout and editor-controls are monorepo packages (version ${versions.join(', ')}) with no release or tarball, so steps 1 to 3 of the install order cannot be reproduced outside this repo today. Links below are relative to this file.`,
  '',
  'Start here: the provider prerequisite. Every studio component throws without StudioUIProvider (install studio-ui-provider and nyc-tron-host first). Install order has nine steps, numbered 0 to 8; a registry add covers steps 4 and 8 and the file parts of 5, 6 and 7. Each engine page has an example that CI runs against the real engine.',
  '',
  '## Install and rules',
  '',
  link('docs/agent-native/install-order.md', 'Install order', 'The nine-step chain, which steps `shadcn add` covers, and the commands for the rest.'),
  link('SKILL.md', 'Agent skill', 'Provider first, install order, engines, editor controls, rebrand contract, token rules, what is deferred and why. A copy ships in packages/ignition/skills/nitro-forge, which skills.sh.json points `npx skills add mikevocalz/nitro-forge --skill nitro-forge` at.'),
  link('AGENTS.md', 'Agent guide', 'Contracts, commands and contributor rules, plus the agent-native section.'),
  link('docs/ENGINE_OPS.md', 'Engine ops', 'Authoritative op names and payloads per engine. The TS facades and the Rust engines follow it.'),
  link('docs/ARCHITECTURE.md', 'Architecture', 'Engine trait semantics, threading, ownership, undo, envelope format and error codes.'),
  link('packages/editor-controls/README.md', 'Editor controls', 'Where the controls came from, the import mapping from @nyc-tron/ui/components/forge, the rc.2 export patch.'),
  link('registry-excluded.json', 'Not in the registry', `${counts}, each with a reason.`),
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
  ...enginePages.map((p) => link(`docs/engines/${p.entry.name}.md`, p.entry.package, engineLine(p))),
  '',
  '## Optional',
  '',
  link('docs/agent-native/02-design-system.md', 'Design system', 'Token tiers, the rebrand contract and the five colour drift records.'),
  link('docs/agent-native/05-accessibility-review.md', 'Accessibility review', 'Source review of the 17 items; no item is verified.'),
  link('llms-full.txt', 'Full text', 'Every page above in one file.'),
  '',
].join('\n');
writeFileSync(join(ROOT, 'llms.txt'), llms);

// The skill ships inside @nitro-forge/ignition, the package every consumer installs, the way vercel-labs/ui
// ships its skill inside @ui-sdk/core. skills.sh.json points `npx skills add` at that folder. SKILL.md at the
// root stays the source; this is a copy.
const SKILL_COPY = 'packages/ignition/skills/nitro-forge/SKILL.md';
mkdirSync(join(ROOT, SKILL_COPY, '..'), { recursive: true });
writeFileSync(join(ROOT, SKILL_COPY), readFileSync(join(ROOT, 'SKILL.md'), 'utf8'));

const full = [llms, '\n---\n'];
for (const p of pages) full.push(`\n<!-- ${p.kind}: ${p.id} -->\n${p.text}`);
for (const f of ['docs/agent-native/install-order.md', 'SKILL.md']) {
  if (existsSync(join(ROOT, f))) full.push(`\n<!-- file: ${f} -->\n${readFileSync(join(ROOT, f), 'utf8')}`);
}
writeFileSync(join(ROOT, 'llms-full.txt'), full.join('\n'));

const size = (f) => readFileSync(join(ROOT, f)).length;
console.log(`build-docs: ${registry.items.length} component pages, ${enginePages.length} engine pages`);
console.log(`build-docs: llms.txt ${size('llms.txt')} bytes (~${Math.round(size('llms.txt') / 4)} tokens), llms-full.txt ${size('llms-full.txt')} bytes (~${Math.round(size('llms-full.txt') / 4)} tokens)`);
