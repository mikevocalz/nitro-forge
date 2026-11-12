#!/usr/bin/env node
// Rebrand test. Replaces a name in one brand manifest, generates the native
// projects (and optionally the web build) from it, and fails if the old name
// is left in the app label, the title bar and About strings, or the bundle
// metadata.
//
//   node tooling/brand/rebrand-check.mjs --app apps/example \
//     --manifest apps/example/brands/prism.json --from Prism --to Lumen \
//     [--platforms ios,android] [--web] [--keep]
//
// --keep leaves ios/ and android/ in place so CI can compile them next.
// The script refuses to run when ios/ or android/ already exist in the app.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const brandLib = createRequire(import.meta.url)('./brand.cjs');
const { values: args } = parseArgs({
  options: {
    app: { type: 'string' }, manifest: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
    platforms: { type: 'string', default: 'ios,android' }, web: { type: 'boolean', default: false }, keep: { type: 'boolean', default: false },
  },
});
for (const k of ['app', 'manifest', 'from', 'to']) if (!args[k]) throw new Error(`--${k} is required`);

const app = resolve(args.app);
const platforms = args.platforms.split(',').filter(Boolean);
const failures = [];
const passes = [];
const check = (ok, what) => (ok ? passes : failures).push(what);
const noOldName = (text, where) => {
  const hits = brandLib.findName(text, args.from);
  check(hits.length === 0, hits.length ? `${where}: old name "${args.from}" found: ${hits.slice(0, 5).map(h => `"…${h}…"`).join(', ')}` : `${where}: no "${args.from}"`);
};

for (const p of platforms) if (existsSync(join(app, p))) throw new Error(`${relative(process.cwd(), join(app, p))} exists; move it away before running the rebrand test`);

// 1. Write the rebranded manifest beside the original so its icon paths resolve.
const original = JSON.parse(readFileSync(args.manifest, 'utf8'));
const renamed = brandLib.rebrand(original, args.from, args.to);
const renamedFile = join(dirname(resolve(args.manifest)), `.rebrand-${basename(args.manifest)}`);
writeFileSync(renamedFile, JSON.stringify(renamed, null, 2));
const brand = brandLib.load(renamedFile);
const env = { ...process.env, FORGE_BRAND_FILE: renamedFile, CI: '1', EXPO_NO_TELEMETRY: '1' };
const expo = (...a) => execFileSync('pnpm', ['exec', 'expo', ...a], { cwd: app, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] });

const textFiles = (dir, maxBytes = 2_000_000) => {
  const out = [];
  const skip = new Set(['build', 'Pods', '.gradle', 'node_modules', '.cxx']);
  const walk = d => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) { if (!skip.has(name)) walk(full); continue; }
      if (/\.(png|jpg|jpeg|webp|jar|keystore|ttf|otf)$/i.test(name) || st.size > maxBytes) continue;
      out.push(full);
    }
  };
  walk(dir);
  return out;
};

try {
  console.log(`Rebrand ${args.manifest}: "${args.from}" -> "${args.to}"`);
  console.log(`  productName "${brand.productName}", shortName "${brand.shortName}", ${brand.ios.bundleIdentifier} / ${brand.android.package}`);
  // `engine` binds the studio code and `icons` the artwork files; neither is shown as a name.
  const nameFields = brandLib.NAME_FIELDS.map(f => f.split('.').reduce((o, k) => o?.[k], renamed));
  noOldName(nameFields.join('\n'), 'rebranded manifest name fields');

  // 2. Resolved Expo config: name, slug, scheme, identifiers, web and extra.
  const config = JSON.parse(expo('config', '--type', 'public', '--json'));
  check(config.name === brand.productName, `config.name is "${config.name}"`);
  check(config.extra?.forgeBrand?.shortName === brand.shortName, `extra.forgeBrand.shortName is "${config.extra?.forgeBrand?.shortName}"`);
  const { engine: _engine, ...shownBrand } = config.extra?.forgeBrand ?? {};
  const identity = [config.name, config.slug, config.scheme, config.ios?.bundleIdentifier, config.android?.package, config.web?.name, config.web?.shortName, JSON.stringify(shownBrand)];
  noOldName(identity.join('\n'), 'resolved Expo config (name, slug, scheme, identifiers, web, extra.forgeBrand)');

  // 3. Title bar and About strings, from the same function the screens call.
  const surfacesModule = join(app, 'src/brand/surfaces.ts');
  if (existsSync(surfacesModule)) {
    const { brandSurfaces } = await import(surfacesModule);
    const s = brandSurfaces(config.extra.forgeBrand, config.version ?? '0.0.0');
    const strings = [s.homeTitle, s.workspaceTitle('Studio'), s.documentTitle('Studio'), s.leading.label, s.about.title, s.about.heading, ...s.about.rows.flatMap(r => [r.label, r.value])];
    check(strings.includes(brand.productName) || strings.includes(brand.shortName), `title bar and About show the new name: ${JSON.stringify(strings)}`);
    noOldName(strings.join('\n'), 'title bar and About strings');
  }

  // 4. Native projects.
  if (platforms.length) expo('prebuild', '--no-install', '--clean', '--platform', platforms.length === 2 ? 'all' : platforms[0]);
  if (platforms.includes('ios')) {
    const project = readdirSync(join(app, 'ios')).find(n => n.endsWith('.xcodeproj'));
    const target = project.replace(/\.xcodeproj$/, '');
    noOldName(target, `iOS project name "${target}"`);
    const plist = readFileSync(join(app, 'ios', target, 'Info.plist'), 'utf8');
    const plistValue = key => plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
    check(plistValue('CFBundleDisplayName') === brand.shortName, `iOS launcher label (CFBundleDisplayName) is "${plistValue('CFBundleDisplayName')}"`);
    check(plistValue('CFBundleName') === brand.shortName, `iOS CFBundleName is "${plistValue('CFBundleName')}"`);
    const pbx = readFileSync(join(app, 'ios', project, 'project.pbxproj'), 'utf8');
    const ids = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g)].map(m => m[1]);
    check(ids.length > 0 && ids.every(id => id === brand.ios.bundleIdentifier), `iOS bundle identifier is ${[...new Set(ids)].join(', ')}`);
    for (const file of textFiles(join(app, 'ios'))) noOldName(readFileSync(file, 'utf8') + file, `ios/${relative(join(app, 'ios'), file)}`);
  }
  if (platforms.includes('android')) {
    const strings = readFileSync(join(app, 'android/app/src/main/res/values/strings.xml'), 'utf8');
    check(strings.includes(`<string name="app_name">${brand.shortName}</string>`), `Android launcher label (app_name) is "${brand.shortName}"`);
    const gradle = readFileSync(join(app, 'android/app/build.gradle'), 'utf8');
    check(gradle.includes(`applicationId '${brand.android.package}'`) || gradle.includes(`applicationId "${brand.android.package}"`), `Android applicationId is ${brand.android.package}`);
    for (const file of textFiles(join(app, 'android'))) noOldName(readFileSync(file, 'utf8') + file, `android/${relative(join(app, 'android'), file)}`);
  }

  // 5. Web build: the page title and the embedded app config.
  if (args.web) {
    const out = mkdtempSync(join(tmpdir(), 'forge-rebrand-web-'));
    expo('export', '--platform', 'web', '--max-workers', '2', '--no-minify', '--output-dir', out);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    check(title === brand.productName, `web <title> is "${title}"`);
    noOldName(title, 'web <title>');
    const js = textFiles(out, Infinity).filter(f => f.endsWith('.js')).map(f => readFileSync(f, 'utf8')).join('\n');
    check(js.includes(brand.productName), `web bundle carries "${brand.productName}"`);
    check(!js.includes(JSON.stringify(original.productName).slice(0, -1) + '"'), `web bundle has no "${original.productName}" string`);
    rmSync(out, { recursive: true, force: true });
  }
} finally {
  rmSync(renamedFile, { force: true });
  if (!args.keep) for (const p of platforms) rmSync(join(app, p), { recursive: true, force: true });
}

for (const p of passes) console.log(`  ok   ${p}`);
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`${passes.length} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
