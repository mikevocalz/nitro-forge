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

test('rejects options, missing project root and disabled architecture rather than mutating configuration', t => {
  const { plugin, config } = fixture(t);
  assert.throws(() => plugin(config, {}), /optionless/);
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
