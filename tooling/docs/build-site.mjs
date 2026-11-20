#!/usr/bin/env node
// Static, dependency-free docs site: docs/site/. Opens from file://.
//   node tooling/docs/build-site.mjs            write the site
//   node tooling/docs/build-site.mjs --check    also verify links, headings, colour pairs, sizes and external loads
// Direction: docs/agent-native/06-docs-direction.md (paper on graphite). Colours come from theme.ts.
// Needs Node >=24.3.0 (type stripping) to import theme.ts. Output is deterministic for the same inputs.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, config, readJson } from '../registry/lib.mjs';
import { css, js } from './site-assets.mjs';

const cfg = config();
const theme = await import(pathToFileURL(join(ROOT, 'packages/studio-workspace/src/theme.ts')).href);
const registry = readJson(join(ROOT, 'registry.json'));
const excluded = readJson(join(ROOT, 'registry-excluded.json'));
const tokensMap = readJson(join(ROOT, 'docs/agent-native/tokens.map.json'));
const chain = readJson(join(ROOT, 'tooling/docs/install-chain.json'));
const compat = readJson(join(ROOT, 'compatibility.v1.json'));
const installOrder = readFileSync(join(ROOT, 'docs/agent-native/install-order.md'), 'utf8');
const OUT = join(ROOT, 'docs/site');
const fail = (m) => { console.error(`build-site: ${m}`); process.exit(1); };
const CHECK = process.argv.includes('--check');

const inputHash = createHash('sha256')
  .update(readFileSync(join(ROOT, 'registry.json'))).update(readFileSync(join(ROOT, 'registry-excluded.json')))
  .update(readFileSync(join(ROOT, 'docs/agent-native/tokens.map.json'))).update(readFileSync(join(ROOT, 'tooling/docs/install-chain.json')))
  .update(readFileSync(join(ROOT, 'packages/studio-workspace/src/theme.ts')))
  .update(JSON.stringify(readdirSync(join(ROOT, 'docs/components')).map((f) => readFileSync(join(ROOT, 'docs/components', f), 'utf8'))))
  .digest('hex').slice(0, 8);

// ---- helpers -----------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pageLinkFix = (h) => h;

function inline(text) {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
  return out;
}

/** Minimal Markdown: headings, paragraphs, tables, fenced code, lists, inline code, bold, links. */
function render(md, file, { skipParas = () => false, tableClass = '' } = {}) {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{2,4}) (.+)$/);
    if (h) { const lvl = h[1].length; out.push(`<h${lvl} id="${slug(h[2])}">${inline(h[2])}</h${lvl}>`); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(`<table${tableClass ? ` class="${tableClass}"` : ''}><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, k) => `<td data-l="${esc(head[k] ?? '')}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,4} |```|\||- )/.test(lines[i])) para.push(lines[i++]);
    const text = para.join(' ');
    if (!skipParas(text)) out.push(`<p>${inline(text)}</p>`);
  }
  return out.join('\n');
}

// ---- data ------------------------------------------------------------------------------------
const built = new Map(registry.items.map((i) => [i.name, readJson(join(ROOT, 'r', `${i.name}.json`))]));
const items = registry.items.map((i) => built.get(i.name));
const providerItems = items.filter((i) => i.meta.needsProvider);
const freeItems = items.filter((i) => !i.meta.needsProvider);
const engines = excluded.engines;
const foundations = excluded.foundations;
const A11Y_WORD = { 'reviewed-pass': 'source read, no failures found', 'reviewed-fail': 'source read, failures found', unverified: 'not reviewed' };
const studios = readFileSync(join(ROOT, 'packages/studio-layout/src/index.ts'), 'utf8').match(/STUDIOS\s*=\s*\[([^\]]+)\]/)[1].match(/"([a-z]+)"/g).map((x) => x.replaceAll('"', ''));
const manifests = Object.fromEntries([...readFileSync(join(ROOT, 'packages/studio-workspace/src/app-manifest.ts'), 'utf8').matchAll(/^\s{2}([a-z]+): \{ task: '([^']+)'/gm)].map((m) => [m[1], m[2]]));
const rBuilt = existsSync(join(ROOT, 'r/registry.json'));
const cmd = (names) => `npx shadcn@4.23.0 add ${names.map((n) => `@nitro-forge/${n}`).join(' ')}`;

// Install chain cross-check with install-order.md.
{
  const rows = installOrder.match(/^\| (\d) \|/gm) ?? [];
  if (rows.length !== chain.steps.length) fail(`install-chain.json has ${chain.steps.length} steps, install-order.md table has ${rows.length}`);
  const fences = (section) => {
    const start = installOrder.indexOf(`### ${section}.`);
    if (start === -1) fail(`install-order.md has no section "${section}"`);
    const end = installOrder.indexOf('\n### ', start + 5);
    const text = installOrder.slice(start, end === -1 ? undefined : end);
    return [...text.matchAll(/```(?:bash|tsx|json)?\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());
  };
  for (const s of chain.steps) if (s.fences === 'all') s.fenceBlocks = fences(s.section);
}

// ---- shell -----------------------------------------------------------------------------------
const NAV = [
  ['index.html', 'Home'],
  ['install.html', 'Install'],
  ['tokens.html', 'Tokens'],
  ['search.html', 'Search'],
];
function shell({ file, title, desc, body, facts = '', wide = false, lead = '' }) {
  const depth = file.split('/').length - 1;
  const up = '../'.repeat(depth);
  const href = (p) => up + p;
  const cur = (p) => (p === file ? ' aria-current="page"' : '');
  const li = (p, label, extra = '') => `<li><a href="${href(p)}"${cur(p)}>${esc(label)}${extra}</a></li>`;
  const side = `<nav class="side" aria-label="Site"><details class="menu" open><summary class="btn">Menu</summary><div>
<ul>${NAV.map(([p, l]) => li(p, l)).join('')}</ul>
<h2>Components</h2>
<ul>${providerItems.map((i) => li(`components/${i.name}.html`, i.title)).join('')}</ul>
<h2>No provider needed</h2>
<ul>${freeItems.map((i) => li(`components/${i.name}.html`, i.title)).join('')}</ul>
<h2>Engines and foundations</h2>
<ul>${[...engines, ...foundations].map((e) => li(`engines/${e.name}.html`, e.package)).join('')}</ul>
</div></details></nav>`;
  const status = `<footer class="status" role="contentinfo">
<span>Registry: ${rBuilt ? `r/ built, ${items.length} items, tag <code>${esc(cfg.tag)}</code> (placeholder)` : 'r/ not built: shadcn add resolves nothing yet'}</span>
<span>Distribution: GitHub release tarballs, ${esc(compat.version)}, npm ${esc(compat.distribution.npm)}, status ${esc(compat.distribution.status)}</span>
<span>Generated from inputs <code>${inputHash}</code></span>
<span><a href="${href('../../llms.txt')}">llms.txt</a> <a href="${href('../../AGENTS.md')}">AGENTS.md</a></span>
</footer>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Nitro Forge</title>
<meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="${href('site.css')}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<a class="mark" href="${href('index.html')}">Nitro Forge</a>
<form action="${href('search.html')}" method="get" role="search"><input type="search" name="q" aria-label="Search the docs" placeholder="Search, press / to focus"></form>
<div class="ctl">
<select id="brand" aria-label="Brand"><option value="suite">Suite brand</option><option value="prism">Prism brand</option></select>
<select id="scheme" aria-label="Scheme"><option value="system">System scheme</option><option value="dark">Dark</option><option value="light">Light</option></select>
<select id="density" aria-label="Density"><option value="standard">Standard</option><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select>
</div>
</header>
<div class="layout${wide ? ' wide' : ''}">
${side}
<main id="main" class="main">
<div class="cols">
<article class="sheet">
<h1>${esc(title)}</h1>
${lead}
${body}
</article>
${facts}
</div>
</main>
</div>
${status}
<script src="${href('site.js')}"></script>
</body>
</html>
`;
}
const mkr = (kind, label) => `<span class="mk ${kind}"><i aria-hidden="true"></i>${esc(label)}</span>`;
const copyBlock = (id, title, text) => `<div class="block"><header><span>${esc(title)}</span><button type="button" class="btn" data-copy="${id}" hidden>Copy</button></header><pre id="${id}">${esc(text)}</pre></div>`;
const sr = '';

// ---- pages -----------------------------------------------------------------------------------
const pages = new Map();
const add = (file, html) => pages.set(file, html);

// Component pages.
for (const it of items) {
  const md = readFileSync(join(ROOT, 'docs/components', `${it.name}.md`), 'utf8');
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^\s*# .+\n/, '');
  const prereqSkip = (t) => t.startsWith('**Prerequisite.**') || /^Needs `@nitro-forge\//.test(t);
  const strip = [];
  if (it.name === cfg.provider) strip.push('This item is the provider. Install it first, then a host such as <code>nyc-tron-host</code>.');
  else if (it.meta.needsProvider) strip.push(`Needs StudioUIProvider. Install <code>studio-ui-provider</code> and <code>nyc-tron-host</code> first, then follow <a href="../install.html#step-7">install step 7</a>.`);
  else if (it.name !== 'brand-theme') strip.push('No provider needed.');
  else strip.push('No provider needed. Needs <code>studio-theme</code>.');
  for (const p of it.meta.prerequisites ?? []) strip.push(`Needs <code>${esc(p.id)}</code> first (<a href="../install.html#step-${p.step}">step ${p.step}</a>). shadcn cannot install it.`);
  const stripHtml = `<div class="strip" role="note"><strong>Prerequisite</strong>${strip.map((s) => `<p>${s}</p>`).join('')}</div>`;
  const sections = render(body, md, { skipParas: prereqSkip });
  const peers = md.match(/^- Peers: (.*)$/m)?.[1] ?? 'none';
  const forAgents = [it.meta.needsProvider ? `${cmd(['studio-ui-provider', 'nyc-tron-host'])}` : null, cmd([it.name])].filter(Boolean).join('\n');
  const lead = `<p class="lead">${esc(it.description)}</p>${stripHtml}
${copyBlock(`cmd-${it.name}`, 'Install command', cmd([it.name]))}`;
  const agentBlock = `<h2 id="for-agents">For agents</h2><p>Run these in order. Steps 1 to 3 of the install order cannot be installed outside the monorepo today.</p><pre>${esc(forAgents)}</pre>`;
  const facts = `<aside class="facts" aria-label="Facts"><h2>Facts</h2><dl>
<dt>Needs StudioUIProvider</dt><dd>${it.meta.needsProvider ? 'yes' : it.name === cfg.provider ? 'this is the provider' : 'no'}</dd>
<dt>Needs ignition</dt><dd>${(it.meta.prerequisites ?? []).some((p) => p.id.endsWith('ignition')) ? 'yes, step 1' : 'no'}</dd>
<dt>Needs studio-layout</dt><dd>${(it.meta.prerequisites ?? []).some((p) => p.id.endsWith('studio-layout')) ? 'yes, step 3' : 'no'}</dd>
<dt>Accessibility</dt><dd>${esc(it.meta.a11yStatus)}: ${esc(A11Y_WORD[it.meta.a11yStatus])}</dd>
<dt>Peers</dt><dd>${inline(peers)}</dd>
<dt>Installs</dt><dd>${(it.dependencies ?? []).map((d) => `<code>${esc(d)}</code>`).join(', ') || 'none'}</dd>
<dt>Source files</dt><dd class="mono">${it.meta.sourceFiles.map((f) => esc(f.replace('packages/', ''))).join('<br>') || 'none'}</dd>
<dt>Generated from</dt><dd class="mono">${inputHash}</dd>
</dl></aside>`;
  add(`components/${it.name}.html`, shell({ file: `components/${it.name}.html`, title: it.title, desc: it.description, lead, body: `<button type="button" class="btn copypage" id="copypage" hidden>Copy page</button>${sections}${agentBlock}`, facts }));
}

// Engine and foundation pages.
for (const e of [...engines, ...foundations]) {
  const md = readFileSync(join(ROOT, 'docs/engines', `${e.name}.md`), 'utf8');
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^\s*# .+\n/, '');
  const lead = `<div class="strip" role="note"><strong>Not a registry item</strong><p>${esc(e.reason)} ${esc(e.returns ?? '')}</p></div>`;
  add(`engines/${e.name}.html`, shell({ file: `engines/${e.name}.html`, title: e.package, desc: e.reason, lead, body: render(body, md) }));
}

// Home.
{
  const rosterRows = engines.map((e) => {
    const task = manifests[e.name];
    const hasStudio = studios.includes(e.name);
    return { e, task: task ?? 'no studio manifest', studio: hasStudio ? 'studio' : 'no studio' };
  });
  const table = `<table class="stack"><thead><tr><th scope="col">Engine</th><th scope="col">Task</th><th scope="col">Form</th><th scope="col">Registry items that need it</th></tr></thead><tbody>${rosterRows.map((r) => `<tr id="engine-${r.e.name}"><th scope="row" data-l="Engine"><a href="engines/${r.e.name}.html">${esc(r.e.name)}</a></th><td data-l="Task">${esc(r.task)} (${r.studio})</td><td data-l="Form">${mkr('ring', 'tarball package')}</td><td data-l="Registry items that need it">none</td></tr>`).join('')}</tbody></table>`;
  const found = `<table class="stack"><thead><tr><th scope="col">Foundation</th><th scope="col">Form</th><th scope="col">Why</th></tr></thead><tbody>
<tr><th scope="row" data-l="Foundation"><a href="engines/ignition.html">ignition</a></th><td data-l="Form">${mkr('ring', 'native host, prerequisite')}</td><td data-l="Why">shadcn cannot run nitrogen, pod install or CMake (decision 4).</td></tr>
<tr><th scope="row" data-l="Foundation"><a href="engines/studio-layout.html">studio-layout</a></th><td data-l="Form">${mkr('ring', 'private package')}</td><td data-l="Why">No tarball and no versioning scheme (decision 3).</td></tr>
<tr><th scope="row" data-l="Foundation"><a href="components/forge-icon.html">icons</a></th><td data-l="Form">${mkr('full', 'registry item forge-icon')}</td><td data-l="Why">Plain source, installs with its own dependencies.</td></tr>
</tbody></table>`;
  const list = (group) => `<ul>${group.map((i) => `<li id="${i.name}"><a href="components/${i.name}.html">${esc(i.title)}</a>. ${esc(i.description)} Accessibility: ${esc(A11Y_WORD[i.meta.a11yStatus])}.</li>`).join('')}</ul>`;
  const body = `<p class="lead">Document studios on one Rust engine, delivered as a shadcn registry of source files plus tarball packages. Controls come from NYC-Tron.</p>
<div class="banner" role="note"><strong>Status.</strong> ${rBuilt ? `The registry is built: ${items.length} items in <code>r/</code>.` : '<code>r/</code> is not built.'} The tag <code>${esc(cfg.tag)}</code> in the registry URLs is a placeholder, so <code>shadcn add</code> against GitHub resolves nothing until a release exists. Packages are at ${esc(compat.version)} and nothing is on npm. Steps 1 to 3 of the install cannot be reproduced outside the monorepo today. <a href="install.html#step-1">See step 1</a>.</div>
<div class="paths"><a class="btn primary" href="install.html">Read the install order</a><a class="btn" href="components/${providerItems[0].name}.html">Wire a component</a><a class="btn" href="tokens.html#rebrand">Rebrand</a></div>
<h2 id="engines">Engines</h2><p>Twelve engines, read from <code>ENGINE_KINDS</code>. None has a registry item today (decision 3).</p>${table}
<h2 id="foundations">Foundations</h2>${found}
<h2 id="registry">Registry items</h2>
<h3 id="needs-provider">Needs StudioUIProvider (${providerItems.length})</h3>${list(providerItems)}
<h3 id="no-provider">No provider needed (${freeItems.length})</h3>${list(freeItems)}
<h2 id="not-in-registry">Not in the registry</h2><p>Four binding adapters, 12 engines, ignition and studio-layout. Each has a reason in <a href="../../registry-excluded.json">registry-excluded.json</a>.</p>`;
  add('index.html', shell({ file: 'index.html', title: 'Nitro Forge', desc: 'Document studios on one Rust engine, delivered as a shadcn registry and tarball packages.', body, facts: `<aside class="facts" aria-label="Facts"><h2>Facts</h2><dl><dt>Registry items</dt><dd>${items.length}</dd><dt>Excluded</dt><dd>${excluded.adapters.length} adapters, ${engines.length} engines, ${foundations.length} foundations</dd><dt>Tag</dt><dd class="mono">${esc(cfg.tag)} (placeholder)</dd><dt>Generated from</dt><dd class="mono">${inputHash}</dd></dl></aside>` }));
}

// Install.
{
  const regLabel = { yes: ['full', 'registry add: yes'], partly: ['part', 'registry add: partly'], no: ['ring', 'registry add: no'] };
  const prompt = `Install a Nitro Forge studio in this order: ${chain.steps.map((s) => `${s.n} ${s.title}`).join('; ')}. Steps 1 to 3 work only inside the monorepo today. Stop and ask instead of inventing a release URL. Install the provider and host before any studio component.`;
  const rows = chain.steps.map((s) => {
    const [kind, label] = regLabel[s.registry];
    const blocks = s.fenceBlocks ?? [s.commands.join('\n')];
    const text = s.commands && !s.fenceBlocks ? s.commands.join('\n') : null;
    const cmds = s.fenceBlocks ? s.fenceBlocks.map((b, k) => copyBlock(`s${s.n}-${k}`, 'Commands', b)).join('') : copyBlock(`s${s.n}-0`, 'Commands', text);
    return `<li id="step-${s.n}" data-registry="${s.registry}"><div class="n" aria-hidden="true">${s.n}</div><div><h3>Step ${s.n}. ${inline(s.title)}</h3><p>${inline(s.why)}</p><p>${mkr(kind, label)}</p></div><div class="cmd">${cmds}${s.source ? `<p>${inline(s.source)}</p>` : ''}</div></li>`;
  }).join('');
  const sec = installOrder.slice(installOrder.indexOf('## Registry add versus tarball or native install'), installOrder.indexOf('## Known gaps in the chain'));
  const tableMd = sec.split('\n').filter((l) => l.startsWith('|')).join('\n');
  const gaps = installOrder.slice(installOrder.indexOf('## Known gaps in the chain')).split('\n').filter((l) => l.startsWith('- ')).join('\n');
  const body = `<div class="banner" role="note">Nothing here is published to npm. Steps 1 to 3 cannot be reproduced outside the monorepo today: no tarball or release exists for <code>ignition</code>, the engines or <code>studio-layout</code>. Source: install-order.md.</div>
<h2 id="agent">Agent prompt</h2>${copyBlock('agent-prompt', 'Prompt', prompt)}
<label class="chk"><input type="checkbox" id="only-registry" hidden> <span class="js-only" hidden>Show only steps a registry add covers</span></label>
<h2 id="chain">The chain</h2><ol class="chain" start="0">${rows}</ol>
<h2 id="registry-vs-tarball">Registry add versus tarball or native install</h2>${render(tableMd, 'install-order.md', { tableClass: '' })}
<h2 id="gaps">Known gaps</h2>${render(gaps, 'install-order.md')}
<p>No verify command is stated in the repo for any step. UNVERIFIED.</p>`;
  add('install.html', shell({ file: 'install.html', title: 'Install order', desc: 'The nine-step chain for a new studio and which steps a registry add covers.', body, wide: true }));
}

// Tokens.
{
  const N = { dark: { raised: theme.workspaceThemes.dark.raised, text: theme.workspaceThemes.dark.text }, light: { raised: theme.workspaceThemes.light.raised, text: theme.workspaceThemes.light.text } };
  const PR = { suite: { dark: pick(theme.workspaceThemes.dark), light: pick(theme.workspaceThemes.light) }, prism: { dark: pick(theme.prismThemes.dark), light: pick(theme.prismThemes.light) } };
  function pick(c) { return { accent: c.accent, ink: c.ink, soft: c.soft }; }
  const lum = (h) => { const c = [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const checks = (p, s) => [['ink on accent', ratio(p[s].ink, p[s].accent), 4.5], ['accent as focus on raised', ratio(p[s].accent, N[s].raised), 3], ['text on soft', ratio(N[s].text, p[s].soft), 4.5]];
  const precomputed = ['suite', 'prism'].map((b) => `<h3>${b === 'suite' ? 'Suite' : 'Prism'} values</h3><table><thead><tr><th scope="col">Scheme</th><th scope="col">Pair</th><th scope="col">Ratio</th><th scope="col">Needs</th><th scope="col">Result</th></tr></thead><tbody>${['dark', 'light'].flatMap((s) => checks(PR[b], s).map(([n, r, m]) => `<tr><td>${s}</td><td>${n}</td><td>${r.toFixed(2)}</td><td>${m}</td><td>${r >= m ? 'passes' : 'fails'}</td></tr>`)).join('')}</tbody></table>`).join('');
  const inputs = ['dark', 'light'].flatMap((s) => ['accent', 'ink', 'soft'].map((k) => `<label>${s} ${k}<input type="text" id="c-${s}-${k}" value="${PR.suite[s][k]}" aria-describedby="checker-out" autocomplete="off" spellcheck="false"></label>`)).join('');
  const t = theme.workspaceThemes;
  const contract = `<table><thead><tr><th scope="col">Key</th><th scope="col">Feeds</th><th scope="col">Suite dark</th><th scope="col">Suite light</th><th scope="col">Prism dark</th><th scope="col">Prism light</th></tr></thead><tbody>${['accent', 'ink', 'soft'].map((k) => `<tr><th scope="row"><code>${k}</code></th><td>${tokensMap.rebrand.fanOut[k].map((v) => `<code>${v}</code>`).join(', ')}</td><td><span class="swatch" style="background:${t.dark[k]}"></span>${t.dark[k]}</td><td><span class="swatch" style="background:${t.light[k]}"></span>${t.light[k]}</td><td><span class="swatch" style="background:${theme.prismThemes.dark[k]}"></span>${theme.prismThemes.dark[k]}</td><td><span class="swatch" style="background:${theme.prismThemes.light[k]}"></span>${theme.prismThemes.light[k]}</td></tr>`).join('')}</tbody></table>`;
  const neutrals = ['base', 'raised', 'deep', 'line', 'text', 'muted'];
  const drift = tokensMap.drift.map((d) => `<h3 id="drift-${d.id.toLowerCase()}">${d.id}. ${esc(d.topic)}</h3><table><thead><tr><th scope="col">Source</th><th scope="col">Value</th></tr></thead><tbody>${Object.entries(d.values).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${(String(v).match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => `<span class="swatch" style="background:${h}"></span>`).join('')}${esc(v)}</td></tr>`).join('')}</tbody></table>`).join('');
  const tokenRows = tokensMap.tokens.map((x) => `<tr id="${esc(x.name)}" data-tier="${esc(x.tier)}"><th scope="row" data-l="Name"><code>${esc(x.name)}</code></th><td data-l="Tier">${esc(x.tier)}</td><td data-l="Role">${esc(x.role ?? x.source ?? '')}</td><td data-l="Dark">${swatch(x.dark ?? x.value)}</td><td data-l="Light">${swatch(x.light)}</td><td data-l="Status">${esc(x.status ?? '')}</td><td data-l="Overridable">${esc(x.overridable ?? 'locked')}</td></tr>`).join('');
  function swatch(v) { if (v === undefined || v === null || v === '') return ''; const s = String(v); return /^#[0-9A-Fa-f]{6}$/.test(s) ? `<span class="swatch" style="background:${s}"></span>${s}` : esc(s); }
  const tiers = [...new Set(tokensMap.tokens.map((x) => x.tier))].sort();
  const starter = JSON.stringify({ dark: PR.prism.dark, light: PR.prism.light, defaultDensity: 'standard' }, null, 2);
  const body = `<p class="lead">A brand changes three keys per scheme: <code>accent</code>, <code>ink</code> and <code>soft</code>. Everything else is locked or deferred.</p>
<h2 id="rebrand">Rebrand contract</h2>
<p>The file is <code>brand.theme.json</code>, separate from <code>tooling/brand/brand.schema.json</code> (decision 24). Minimum override: 3 keys by 2 schemes, 6 values.</p>${contract}
${copyBlock('starter', 'brand.theme.json starter (Prism override)', starter)}
<h2 id="checker">Accent checker</h2>
<noscript><p>Script is off. These are the ratios for the shipped values, computed at build time.</p></noscript>
<div id="checker" class="checker" data-neutrals='${esc(JSON.stringify(N))}' data-presets='${esc(JSON.stringify(PR))}'>
<label>Start from <select id="c-preset"><option value="suite">Suite</option><option value="prism">Prism</option></select></label><span></span><span></span>${inputs}
<div class="res" id="checker-out" aria-live="polite"></div></div>
<h3>Precomputed ratios</h3>${precomputed}
<h2 id="deferred">Deferred</h2>
<p>The six neutral keys wait for an owner-supplied contrast check (decision 23): ${neutrals.map((n) => `<code>${n}</code>`).join(', ')}. The checker does not measure them. A radius override is struck: chrome keeps 4 px (AGENTS.md).</p>
<h2 id="locked">Locked</h2><ul>${tokensMap.locked.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<h2 id="drift">Drift</h2><p>Kept as separate tokens. Unification changes pixels and is the owner's call (decisions 5 and 20).</p>${drift}
<h2 id="token-table">Tokens (${tokensMap.tokens.length})</h2>
<div class="searchbar"><input type="search" id="token-filter" aria-label="Filter tokens" placeholder="Filter tokens" hidden><select id="token-tier" aria-label="Tier" hidden><option value="">All tiers</option>${tiers.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
<p id="token-empty" hidden></p>
<table class="token-table stack"><thead><tr><th scope="col">Name</th><th scope="col">Tier</th><th scope="col">Role</th><th scope="col">Dark</th><th scope="col">Light</th><th scope="col">Status</th><th scope="col">Overridable</th></tr></thead><tbody id="tokens-body">${tokenRows}</tbody></table>
<h2 id="densities">Densities</h2><p>${tokensMap.densities.names.map((n) => `<code>${n}</code>`).join(', ')}. Default <code>${tokensMap.densities.default}</code>. Changes: ${tokensMap.densities.changes.join(', ')}. Never changes: ${tokensMap.densities.neverChanges.join(', ')}, colour and motion.</p>`;
  add('tokens.html', shell({ file: 'tokens.html', title: 'Tokens and rebrand', desc: 'The three-key rebrand contract, what is locked or deferred, colour drift, and all tokens.', body, wide: true }));
}

// Search.
{
  const idx = [];
  for (const i of items) idx.push({ g: 'Components', t: i.title, d: i.description, u: `components/${i.name}.html` });
  for (const t of tokensMap.tokens) idx.push({ g: 'Tokens', t: t.name, d: `${t.tier}. ${t.role ?? ''}`.trim(), u: `tokens.html#${t.name}` });
  for (const s of chain.steps) idx.push({ g: 'Install', t: `Step ${s.n}. ${s.title}`, d: s.why, u: `install.html#step-${s.n}` });
  for (const e of engines) idx.push({ g: 'Engines', t: e.name, d: `${manifests[e.name] ?? 'no studio manifest'}. Tarball package.`, u: `engines/${e.name}.html` });
  for (const e of foundations) idx.push({ g: 'Engines', t: e.name, d: e.reason, u: `engines/${e.name}.html` });
  const group = (g) => idx.filter((x) => x.g === g);
  const noscript = ['Components', 'Tokens', 'Install', 'Engines'].map((g) => `<details class="group"${g === 'Components' ? ' open' : ''}><summary>${g} (${group(g).length})</summary>${group(g).map((x) => `<a class="row-link" href="${x.u}">${esc(x.t)}<small>${esc(x.d ?? '')}</small></a>`).join('')}</details>`).join('');
  const body = `<p class="lead">Find an item, token, step or engine by name or by the task.</p>
<div class="searchbar" id="searchui" hidden><input type="search" id="q" aria-label="Query" placeholder="Type a name or a task. Try provider or rebrand."><fieldset class="chips"><legend class="sr">Scope</legend>${['All', 'Components', 'Tokens', 'Install', 'Engines'].map((s, k) => `<label><input type="radio" name="scope" value="${s}"${k === 0 ? ' checked' : ''}><span>${s}</span></label>`).join('')}</fieldset></div>
<p id="search-error" class="banner err" hidden></p><p id="search-empty" hidden></p>
<div id="results" hidden></div>
<div id="all">${noscript}</div>
<p>Indexed from the registry titles and descriptions, the token map, the install chain and the engine roster. Generated from inputs <code>${inputHash}</code>.</p>
<script type="application/json" id="index">${JSON.stringify(idx).replace(/</g, '\\u003c')}</script>`;
  add('search.html', shell({ file: 'search.html', title: 'Search', desc: 'Search components, tokens, install steps and engines.', body }));
}

// ---- write ------------------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const siteJs = js.replace("var d=document,r=d.documentElement;r.classList.add('js');", "var d=document,r=d.documentElement;r.classList.add('js');d.querySelectorAll('[hidden][data-copy],#only-registry,.js-only,#searchui,#token-filter,#token-tier,#copypage').forEach(function(e){e.hidden=false});var mn=d.querySelector('details.menu');if(mn&&window.innerWidth<=700)mn.removeAttribute('open');");
writeFileSync(join(OUT, 'site.css'), css(theme) + '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}\n');
writeFileSync(join(OUT, 'site.js'), siteJs);
for (const [file, html] of pages) {
  const path = join(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html.replace(/<button type="button" class="btn" data-copy=/g, '<button type="button" class="btn" hidden data-copy='));
}
console.log(`build-site: ${pages.size} pages, site.css ${readFileSync(join(OUT, 'site.css')).length} bytes, site.js ${readFileSync(join(OUT, 'site.js')).length} bytes`);

// ---- checks -----------------------------------------------------------------------------------
if (CHECK) {
  const problems = [];
  const files = [...pages.keys()];
  const ids = new Map();
  for (const f of files) {
    const html = pages.get(f);
    ids.set(f, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    if ((html.match(/<h1[ >]/g) ?? []).length !== 1) problems.push(`${f}: needs exactly one h1`);
    if ((html.match(/<main[ >]/g) ?? []).length !== 1) problems.push(`${f}: needs exactly one main`);
    if (Buffer.byteLength(html) > 150 * 1024 && f !== 'tokens.html') problems.push(`${f}: ${Buffer.byteLength(html)} bytes, over 150 KB`);
    if (/(?:src|href)="https?:\/\//.test(html)) problems.push(`${f}: loads an external resource`);
  }
  for (const f of files) {
    const html = pages.get(f);
    for (const m of html.matchAll(/(?:href|src)="([^"#]*)(#[^"]*)?"/g)) {
      const [, p, hash] = m;
      if (!p && !hash) continue;
      if (/^(https?:|mailto:)/.test(p)) continue;
      const target = p ? posix.normalize(posix.join(posix.dirname(f), p)) : f;
      const known = pages.has(target) || ['site.css', 'site.js'].includes(target) || existsSync(resolve(OUT, target));
      if (!known) { problems.push(`${f}: link ${p} does not resolve`); continue; }
      if (hash && pages.has(target) && !ids.get(target).has(hash.slice(1))) problems.push(`${f}: anchor ${p}${hash} has no target`);
    }
  }
  const ratioOf = (a, b) => { const l = (h) => { const c = [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }; const x = l(a); const y = l(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const pairs = [];
  for (const [bname, th] of [['suite', theme.workspaceThemes], ['prism', theme.prismThemes]]) {
    for (const s of ['dark', 'light']) {
      const c = th[s];
      pairs.push([`${bname} ${s} text on base`, c.text, c.base, 4.5], [`${bname} ${s} muted on raised`, c.muted, c.raised, 4.5], [`${bname} ${s} paperInk on paper`, c.paperInk, c.paper, 4.5],
        [`${bname} ${s} ink on accent`, c.ink, c.accent, 4.5], [`${bname} ${s} accent on base (focus)`, c.accent, c.base, 3], [`${bname} ${s} text on soft`, c.text, c.soft, 4.5], [`${bname} ${s} accent on raised (focus)`, c.accent, c.raised, 3]);
    }
  }
  for (const [name, a, b, min] of pairs) { const r = ratioOf(a, b); if (r < min) problems.push(`colour pair ${name} is ${r.toFixed(2)}, needs ${min}`); }
  const sheetLink = ratioOf('#5236B8', theme.workspaceThemes.dark.paper);
  if (sheetLink < 4.5) problems.push(`sheet link colour on paper is ${sheetLink.toFixed(2)}`);
  if (engines.length !== 12) problems.push(`roster has ${engines.length} engines, expected 12`);
  if (chain.steps.length !== 9) problems.push('install chain is not 9 steps');
  if (readFileSync(join(OUT, 'site.css')).length > 24 * 1024) problems.push('site.css over 24 KB');
  if (readFileSync(join(OUT, 'site.js')).length > 16 * 1024) problems.push('site.js over 16 KB');
  if (/\bfetch\(|\bimport\(/.test(siteJs)) problems.push('site.js uses fetch or import');
  if (problems.length) { console.error(`build-site --check: ${problems.length} problem(s)`); for (const p of problems) console.error(`  ${p}`); process.exit(1); }
  console.log(`build-site --check: OK (${files.length} pages, ${pairs.length} colour pairs)`);
}
