'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOURCE = path.resolve(__dirname, '..');
const NITRO = '1.0.0-alpha.nightly.136.gdb81de61bd32';
const VERSIONS = {
  expo: '58.0.24',
  'react-native': '0.88.1',
  'react-native-nitro-modules': NITRO,
  'nitro-core': NITRO,
};
const ASSETS = [
  'native/ForgeRust.xcframework/Info.plist',
  'native/ForgeRust.xcframework/ios-arm64/libnf_sys.a',
  'native/ForgeRust.xcframework/ios-arm64/Headers/nf_v1.h',
  'native/ForgeRust.xcframework/ios-arm64_x86_64-simulator/libnf_sys.a',
  'native/ForgeRust.xcframework/ios-arm64_x86_64-simulator/Headers/nf_v1.h',
  ...['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'].map(abi => `native/android/${abi}/libnf_sys.a`),
];

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function json(file, value) {
  write(file, JSON.stringify(value));
}
function fixture(t) {
  // These synthetic metadata/assets exercise Node configuration boundaries.
  // They are deliberately not native binaries and establish no compatibility.
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-plugin-test-'));
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  json(path.join(app, 'package.json'), { private: true });
  const root = path.join(app, 'node_modules/@nitro-forge/ignition');
  json(path.join(root, 'package.json'), {
    name: '@nitro-forge/ignition', type: 'module',
    exports: { './app.plugin.cjs': './app.plugin.cjs' },
  });
  write(path.join(root, 'app.plugin.cjs'), fs.readFileSync(path.join(SOURCE, 'app.plugin.cjs')));
  write(path.join(root, 'plugin/withForge.cjs'), fs.readFileSync(path.join(SOURCE, 'plugin/withForge.cjs')));
  for (const [name, version] of Object.entries(VERSIONS)) {
    json(path.join(app, 'node_modules', name, 'package.json'), { name, version, main: 'index.js' });
    write(path.join(app, 'node_modules', name, 'index.js'), 'throw new Error("Runtime must not be loaded");');
  }
  const manifest = {
    schemaVersion: 1, sourceCommit: 'a'.repeat(40), nitroVersion: NITRO,
    architectures: {
      ios: ['arm64-device', 'arm64-simulator', 'x86_64-simulator'],
      android: ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'],
    },
    files: ASSETS.map(file => ({ path: file, sha256: 'b'.repeat(64) })),
  };
  for (const asset of ASSETS) write(path.join(root, asset), 'synthetic test fixture');
  const saveManifest = () => json(path.join(root, 'native/assets.json'), manifest);
  saveManifest();
  const plugin = require(path.join(root, 'app.plugin.cjs'));
  const config = {
    name: 'Consumer', slug: 'consumer', orientation: 'default', newArchEnabled: true,
    platforms: ['ios', 'android'], experiments: { swiftPackageManager: true, other: 'retained' },
    ios: { bundleIdentifier: 'example.consumer', infoPlist: { Custom: 'retained' } },
    android: { package: 'example.consumer', permissions: ['CUSTOM'] },
    plugins: ['other-plugin', '@nitro-forge/ignition'],
    _internal: { projectRoot: app },
  };
  return { app, root, plugin, config, manifest, saveManifest };
}

test('optionless CJS entry preserves config identity and all platform metadata, without runtime loading', t => {
  const { plugin, config } = fixture(t);
  const before = JSON.stringify(config);
  assert.equal(plugin(config), config);
  assert.equal(plugin(config), config);
  assert.equal(JSON.stringify(config), before);
});

test('requires explicit initial SwiftPM opt-in for iOS and preserves the rejected input', t => {
  const { plugin, config } = fixture(t);
  delete config.experiments.swiftPackageManager;
  const before = JSON.stringify(config);
  assert.throws(() => plugin(config), /experiments.swiftPackageManager: true.*--no-install/);
  assert.equal(JSON.stringify(config), before);
  config.platforms = ['android'];
  assert.equal(plugin(config), config);
});

test('omitted platforms includes iOS and therefore needs explicit SwiftPM', t => {
  const { plugin, config } = fixture(t);
  delete config.platforms;
  delete config.experiments.swiftPackageManager;
  assert.throws(() => plugin(config), /initial app config/);
});

test('rejects unknown options, missing project root and disabled architecture rather than mutating configuration', t => {
  const { plugin, config } = fixture(t);
  const before = JSON.stringify(config);
  assert.throws(() => plugin(config, { engine: ['prism'] }), /Unknown plugin option engine/);
  assert.throws(() => plugin(config, ['prism']), /options must be an object/);
  assert.throws(() => plugin(config, null), /options must be an object/);
  assert.equal(JSON.stringify(config), before);
  assert.throws(() => plugin({ ...config, _internal: {} }), /absolute _internal.projectRoot/);
  assert.throws(() => plugin({ ...config, newArchEnabled: false }), /New Architecture/);
});

test('reports actual and supported dependency versions', t => {
  const { app, plugin, config } = fixture(t);
  json(path.join(app, 'node_modules/react-native/package.json'), { name: 'react-native', version: '0.83.10' });
  assert.throws(() => plugin(config), /react-native version 0.83.10.*exactly 0.88.1/);
});

test('missing dependency fails without fallback to a runtime', t => {
  const { app, plugin, config } = fixture(t);
  fs.rmSync(path.join(app, 'node_modules/nitro-core'), { recursive: true });
  assert.throws(() => plugin(config), /Missing nitro-core.*supported dependency graph/);
});

test('metadata resolution handles package exports that hide package.json, without executing the exported module', t => {
  const { app, plugin, config } = fixture(t);
  json(path.join(app, 'node_modules/nitro-core/package.json'), {
    name: 'nitro-core', version: NITRO, exports: { '.': './index.js' },
  });
  assert.equal(plugin(config), config);
});

test('absent or malformed native manifest is an actionable package error', t => {
  const { root, plugin, config } = fixture(t);
  write(path.join(root, 'native/assets.json'), 'null');
  assert.throws(() => plugin(config), /Expected an object in packaged native\/assets.json/);
  fs.rmSync(path.join(root, 'native/assets.json'));
  assert.throws(() => plugin(config), /Cannot read packaged native\/assets.json/);
});

test('retains exact declared architecture sets, including legacy Android ABIs', t => {
  const { plugin, config, manifest, saveManifest } = fixture(t);
  manifest.architectures.android = ['arm64-v8a', 'x86_64'];
  saveManifest();
  assert.throws(() => plugin(config), /retain the declared android architectures/);
});

test('rejects incomplete assets and missing files instead of compiling Rust', t => {
  const { root, plugin, config, manifest, saveManifest } = fixture(t);
  manifest.files = manifest.files.filter(asset => !asset.path.endsWith('x86/libnf_sys.a'));
  saveManifest();
  assert.throws(() => plugin(config), /manifest is missing native\/android\/x86\/libnf_sys.a/);
  fs.rmSync(path.join(root, ASSETS[0]));
  assert.throws(() => plugin(config), /Missing native asset.*Info.plist/);
});

test('rejects malformed source/runtime identities', t => {
  const { plugin, config, manifest, saveManifest } = fixture(t);
  manifest.sourceCommit = 'not-a-commit';
  saveManifest();
  assert.throws(() => plugin(config), /Invalid native asset manifest/);
  manifest.sourceCommit = 'a'.repeat(40);
  manifest.nitroVersion = '0.37.0';
  saveManifest();
  assert.throws(() => plugin(config), /Invalid native asset manifest/);
});

test('rejects traversal, duplicate entries and malformed hashes', t => {
  const { plugin, config, manifest, saveManifest } = fixture(t);
  const original = manifest.files[0];
  for (const entry of [
    { path: 'native/../../outside', sha256: 'b'.repeat(64) },
    { ...original, sha256: 'incorrect' },
    original,
  ]) {
    manifest.files = [...manifest.files.slice(0, ASSETS.length), entry];
    saveManifest();
    assert.throws(() => plugin(config), /Invalid, duplicate or escaping path\/hash/);
  }
});

test('rejects a symlinked asset escaping the installed package', t => {
  const { app, root, plugin, config } = fixture(t);
  const asset = path.join(root, ASSETS[0]);
  fs.rmSync(asset);
  write(path.join(app, 'outside'), 'outside');
  fs.symlinkSync(path.join(app, 'outside'), asset);
  assert.throws(() => plugin(config), /must be a nonempty file inside/);
});

test('rejects a native manifest symlink outside the package before reading it', t => {
  const { app, root, plugin, config } = fixture(t);
  const manifestPath = path.join(root, 'native/assets.json');
  fs.renameSync(manifestPath, path.join(app, 'outside-manifest.json'));
  fs.symlinkSync(path.join(app, 'outside-manifest.json'), manifestPath);
  assert.throws(() => plugin(config), /native\/assets.json must be a file inside/);
});

// ---- engines option -------------------------------------------------------

const REPO = path.resolve(SOURCE, '../..');
const ALL_ENGINES = ['prism', 'cadence', 'splice', 'folio', 'pitch', 'tally',
  'quill', 'photo', 'motion', 'design', 'draft', 'scene'];

// Runs the mods the plugin registered the way Expo's providers do: hand in
// the file contents as modResults and collect what comes back.
async function runMods(config, files) {
  const out = {};
  for (const [platform, mod, initial] of [
    ['android', 'gradleProperties', files.gradle],
    ['ios', 'podfileProperties', files.podfile],
  ]) {
    const run = config.mods?.[platform]?.[mod];
    if (!run || initial === undefined) continue;
    const result = await run({ ...config, modResults: initial, modRequest: { platform, modName: mod } });
    out[mod] = result.modResults;
  }
  return out;
}

test('omitted or empty options leave native files alone and register no mods', t => {
  const { plugin, config } = fixture(t);
  const before = JSON.stringify(config);
  assert.equal(plugin(config), config);
  assert.equal(plugin(config, {}), config);
  assert.equal(plugin(config, { engines: undefined }), config);
  assert.equal(config.mods, undefined);
  assert.equal(JSON.stringify(config), before);
});

test('engines writes one canonical property for each platform and keeps other entries', async t => {
  const { plugin, config } = fixture(t);
  assert.equal(plugin(config, { engines: ['tally', 'prism'] }), config);
  const results = await runMods(config, {
    gradle: [
      { type: 'comment', value: 'kept' },
      { type: 'property', key: 'hermesEnabled', value: 'true' },
      { type: 'property', key: 'nitroForge.engines', value: 'scene' },
    ],
    podfile: { 'expo.jsEngine': 'hermes' },
  });
  assert.deepEqual(results.gradleProperties, [
    { type: 'comment', value: 'kept' },
    { type: 'property', key: 'hermesEnabled', value: 'true' },
    { type: 'property', key: 'nitroForge.engines', value: 'prism,tally' },
  ]);
  assert.deepEqual(results.podfileProperties, {
    'expo.jsEngine': 'hermes', 'nitroForge.engines': 'prism,tally',
  });
  const appended = await runMods(config, { gradle: [], podfile: {} });
  assert.deepEqual(appended.gradleProperties, [{ type: 'property', key: 'nitroForge.engines', value: 'prism,tally' }]);
});

test('engine mods chain onto mods registered before them, newest first', async t => {
  const { plugin, config } = fixture(t);
  const order = [];
  config.mods = { android: { gradleProperties: async c => { order.push('earlier'); return c; } } };
  plugin(config, { engines: ['cadence'] });
  const results = await runMods(config, { gradle: [] });
  assert.deepEqual(order, ['earlier']);
  assert.deepEqual(results.gradleProperties, [{ type: 'property', key: 'nitroForge.engines', value: 'cadence' }]);
  config.mods.ios = { podfileProperties: Object.assign(async c => c, { isProvider: true }) };
  assert.throws(() => plugin(config, { engines: ['cadence'] }), /after its provider/);
});

test('engines only touches the platforms the app builds', async t => {
  const { plugin, config } = fixture(t);
  config.platforms = ['android'];
  plugin(config, { engines: ['scene'] });
  assert.ok(config.mods.android.gradleProperties);
  assert.equal(config.mods.ios, undefined);
});

test('engines is validated before anything is registered', t => {
  const { plugin, config } = fixture(t);
  for (const [engines, message] of [
    ['prism', /must be an array/],
    [[], /at least one engine/],
    [['prism', 'prism'], /lists prism twice/],
    [['Prism'], /unknown engine "Prism"/],
    [['prism', 7], /unknown engine 7/],
    [['raw'], /Known engines: prism, cadence/],
  ]) {
    assert.throws(() => plugin(config, { engines }), message);
    assert.equal(config.mods, undefined);
  }
});

test('the full engine list is accepted and written explicitly', async t => {
  const { plugin, config } = fixture(t);
  plugin(config, { engines: [...ALL_ENGINES].reverse() });
  const results = await runMods(config, { gradle: [], podfile: {} });
  assert.equal(results.podfileProperties['nitroForge.engines'], ALL_ENGINES.join(','));
});

test('an archive that records its engines must link every engine the app asks for', t => {
  const { plugin, config, manifest, saveManifest } = fixture(t);
  manifest.engines = ['prism', 'tally'];
  saveManifest();
  assert.equal(plugin(config, { engines: ['prism'] }), config);
  assert.throws(() => plugin(config, { engines: ['prism', 'scene'] }),
    /links prism, tally but the app needs scene.*NF_ENGINES=prism,scene/);
  // Without the option the app needs every engine.
  assert.throws(() => plugin(config), /but the app needs cadence, splice/);
  manifest.engines = ['prism', 'bogus'];
  saveManifest();
  assert.throws(() => plugin(config, { engines: ['prism'] }), /Native asset manifest engines has unknown engine "bogus"/);
  delete manifest.engines; // older/default archive: every engine
  saveManifest();
  assert.equal(plugin(config, { engines: ['scene'] }), config);
});

test('the plugin engine list matches Cargo features, the C++ table and ForgeEngineKind', () => {
  const { ENGINES } = require(path.join(SOURCE, 'plugin/withForge.cjs'));
  assert.deepEqual([...ENGINES], ALL_ENGINES);
  const cargo = fs.readFileSync(path.join(REPO, 'rust/nf-sys/Cargo.toml'), 'utf8');
  const features = [...cargo.matchAll(/^([a-z]+) = \["dep:([a-z]+)-engine"\]$/gm)].map(m => {
    assert.equal(m[1], m[2]);
    return m[1];
  });
  assert.deepEqual(features, ALL_ENGINES);
  const all = cargo.match(/^all = \[([^\]]*)\]/m)[1].match(/"([a-z]+)"/g).map(name => name.slice(1, -1));
  assert.deepEqual(all, ALL_ENGINES);
  assert.match(cargo, /^default = \["all"\]$/m);
  const cpp = fs.readFileSync(path.join(SOURCE, 'cpp/HybridForgeFactory.cpp'), 'utf8');
  assert.deepEqual([...cpp.matchAll(/return "([a-z]+)";/g)].map(m => m[1]), ALL_ENGINES);
  const contracts = fs.readFileSync(path.join(SOURCE, 'src/contracts.ts'), 'utf8');
  const kinds = contracts.match(/export type ForgeEngineKind =([^;]*);/)[1].match(/"([a-z]+)"/g).map(n => n.slice(1, -1));
  assert.deepEqual(kinds, ALL_ENGINES);
  const cmake = fs.readFileSync(path.join(SOURCE, 'android/forge-engines.cmake'), 'utf8');
  assert.deepEqual(cmake.match(/set\(FORGE_KNOWN_ENGINES ([a-z ]+)\)/)[1].split(' '), ALL_ENGINES);
});

// ---- build-script resolution ----------------------------------------------

test('build scripts resolve engines from NF_ENGINES, then the app, then all', t => {
  const { resolve, cargoArgs } = require(path.join(SOURCE, 'scripts/resolve-engines.cjs'));
  assert.deepEqual(resolve('android', {}), ALL_ENGINES);
  assert.equal(cargoArgs(resolve('apple', {})), '', 'default build passes no feature flags');
  assert.deepEqual(resolve('android', { NF_ENGINES: 'all' }), ALL_ENGINES);
  assert.deepEqual(resolve('android', { NF_ENGINES: ' tally , prism ' }), ['prism', 'tally']);
  assert.equal(cargoArgs(['prism', 'tally']), '--no-default-features --features prism,tally');
  assert.throws(() => resolve('apple', { NF_ENGINES: 'prism,raw' }), /NF_ENGINES has unknown engine "raw"/);
  assert.throws(() => resolve('apple', { NF_ENGINES: ',' }), /unknown engine ""/);

  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-engines-app-'));
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  write(path.join(app, 'android/gradle.properties'), '# c\nhermesEnabled=true\nnitroForge.engines = scene,folio\n');
  json(path.join(app, 'ios/Podfile.properties.json'), { 'nitroForge.engines': 'cadence' });
  assert.deepEqual(resolve('android', { NF_APP_ROOT: app }), ['folio', 'scene']);
  assert.deepEqual(resolve('apple', { NF_APP_ROOT: app }), ['cadence']);
  assert.deepEqual(resolve('apple', { NF_APP_ROOT: app, NF_ENGINES: 'prism' }), ['prism'], 'NF_ENGINES wins');
  write(path.join(app, 'android/gradle.properties'), 'hermesEnabled=true\n');
  assert.deepEqual(resolve('android', { NF_APP_ROOT: app }), ALL_ENGINES, 'no property means all');
  json(path.join(app, 'ios/Podfile.properties.json'), { 'nitroForge.engines': 'prism,nope' });
  assert.throws(() => resolve('apple', { NF_APP_ROOT: app }), /nitroForge.engines in .* unknown engine "nope"/);
});

// ---- Android CMake check ----------------------------------------------------

test('Android CMake fails configure when the archive lacks a requested engine', t => {
  const { spawnSync } = require('node:child_process');
  if (spawnSync('cmake', ['--version']).status !== 0) {
    t.skip('cmake is not installed');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-engines-cmake-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'engines.txt');
  const configure = (engines, archived) => {
    if (archived === undefined) fs.rmSync(file, { force: true });
    else write(file, `${archived}\n`);
    const args = [`-DFORGE_RUST_ENGINES_FILE=${file}`];
    if (engines !== undefined) args.push(`-DNITRO_FORGE_ENGINES=${engines}`);
    const run = spawnSync('cmake', [...args, '-P', path.join(SOURCE, 'android/forge-engines.cmake')], { encoding: 'utf8' });
    // CMake wraps long messages; compare with whitespace collapsed.
    return { ok: run.status === 0, log: (run.stdout + run.stderr).replace(/\s+/g, ' ') };
  };
  assert.ok(configure(undefined, undefined).ok, 'default: no property, no engines.txt');
  assert.ok(configure('all', ALL_ENGINES.join(',')).ok);
  assert.ok(configure('prism,tally', 'prism,tally').ok);
  const extra = configure('prism', 'prism,tally');
  assert.ok(extra.ok);
  assert.match(extra.log, /also links tally/);
  const missing = configure('prism,scene', 'prism,tally');
  assert.ok(!missing.ok);
  assert.match(missing.log, /links prism,tally but the app needs scene.*NF_ENGINES=prism,scene/s);
  const defaultNeedsAll = configure(undefined, 'prism');
  assert.ok(!defaultNeedsAll.ok);
  assert.match(defaultNeedsAll.log, /needs cadence,splice/);
  const unknown = configure('prism,raw', 'prism');
  assert.ok(!unknown.ok);
  assert.match(unknown.log, /unknown engine 'raw'/);
  const twice = configure('prism,prism', 'prism');
  assert.ok(!twice.ok);
  assert.match(twice.log, /lists prism twice/);
  const unchecked = configure('prism', undefined);
  assert.ok(unchecked.ok);
  assert.match(unchecked.log, /engines.txt is missing/);
});
