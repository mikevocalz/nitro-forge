'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const NITRO_VERSION = '1.0.0-alpha.nightly.136.gdb81de61bd32';
const SUPPORTED_VERSIONS = {
  expo: '58.0.24',
  'react-native': '0.88.1',
  'react-native-nitro-modules': NITRO_VERSION,
  'nitro-core': NITRO_VERSION,
};
const ARCHITECTURES = {
  ios: ['arm64-device', 'arm64-simulator', 'x86_64-simulator'],
  android: ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'],
};
const APPLE_ROOT = 'native/ForgeRust.xcframework';
const REQUIRED_ASSETS = [
  `${APPLE_ROOT}/Info.plist`,
  `${APPLE_ROOT}/ios-arm64/libnf_sys.a`,
  `${APPLE_ROOT}/ios-arm64/Headers/nf_v1.h`,
  `${APPLE_ROOT}/ios-arm64_x86_64-simulator/libnf_sys.a`,
  `${APPLE_ROOT}/ios-arm64_x86_64-simulator/Headers/nf_v1.h`,
  ...ARCHITECTURES.android.map(abi => `native/android/${abi}/libnf_sys.a`),
];

function fail(message) {
  throw new Error(`[Nitro Forge] ${message}`);
}

function readJson(file, description) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(`Expected an object in ${description}.`);
    }
    return value;
  } catch (error) {
    fail(`Cannot read ${description}: ${error.message}`);
  }
}

// Resolution reads metadata only. In particular, never require a React Native
// runtime or the Ignition barrel in the Node process evaluating Expo config.
function readInstalledPackage(appRequire, name) {
  let metadataPath;
  try {
    metadataPath = appRequire.resolve(`${name}/package.json`);
  } catch {
    let entry;
    try {
      entry = appRequire.resolve(name);
    } catch {
      fail(`Missing ${name}. Install the supported dependency graph in the Expo app before prebuild.`);
    }
    let directory = path.dirname(entry);
    while (true) {
      const candidate = path.join(directory, 'package.json');
      if (fs.existsSync(candidate)) {
        const metadata = readJson(candidate, `${name} package metadata`);
        if (metadata.name === name) return metadata;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    fail(`Cannot find metadata for installed ${name}.`);
  }
  const metadata = readJson(metadataPath, `${name} package metadata`);
  if (metadata.name !== name) fail(`Resolved ${name} metadata has an unexpected package name.`);
  return metadata;
}

function validateArchitectures(manifest) {
  for (const [platform, expected] of Object.entries(ARCHITECTURES)) {
    const declared = manifest.architectures?.[platform];
    if (!Array.isArray(declared) || declared.length !== expected.length ||
        !expected.every(architecture => declared.includes(architecture))) {
      fail(`Native asset manifest must retain the declared ${platform} architectures: ${expected.join(', ')}.`);
    }
  }
}

function validateAssets(packageRoot) {
  const root = fs.realpathSync(packageRoot);
  const manifestPath = path.join(root, 'native/assets.json');
  let realManifest;
  try {
    realManifest = fs.realpathSync(manifestPath);
  } catch {
    fail('Cannot read packaged native/assets.json. Install a complete produced Ignition archive.');
  }
  if (!realManifest.startsWith(root + path.sep) || !fs.statSync(realManifest).isFile()) {
    fail('Packaged native/assets.json must be a file inside the installed Ignition package.');
  }
  const manifest = readJson(realManifest, 'packaged native/assets.json');
  if (manifest.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? '') ||
      manifest.nitroVersion !== NITRO_VERSION || !Array.isArray(manifest.files)) {
    fail('Invalid native asset manifest. Install a complete produced Ignition archive; do not build Rust in the consumer.');
  }
  validateArchitectures(manifest);
  const listed = new Set();
  for (const asset of manifest.files) {
    const relative = asset?.path;
    if (typeof relative !== 'string' || !relative.startsWith('native/') ||
        relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..') ||
        !/^[0-9a-f]{64}$/.test(asset.sha256 ?? '') || listed.has(relative)) {
      fail('Invalid, duplicate or escaping path/hash in the packaged native asset manifest.');
    }
    listed.add(relative);
    const file = path.resolve(root, relative);
    let realFile;
    try {
      realFile = fs.realpathSync(file);
      if (!realFile.startsWith(root + path.sep) || !fs.statSync(realFile).isFile() ||
          fs.statSync(realFile).size === 0) {
        fail(`Native asset ${relative} must be a nonempty file inside the installed Ignition package.`);
      }
    } catch (error) {
      if (error.message.startsWith('[Nitro Forge]')) throw error;
      fail(`Missing native asset ${relative}. Install a complete produced Ignition archive.`);
    }
  }
  for (const required of REQUIRED_ASSETS) {
    if (!listed.has(required)) fail(`Native asset manifest is missing ${required}. Install the universal Apple/Android Ignition archive.`);
  }
  // Producer and clean-consumer checks verify hashes and actual architecture
  // metadata. Presence validation here is not an ABI or native build verdict.
}

/**
 * Optionless Expo config plugin. The caller opts into SwiftPM in initial app
 * config: Expo chooses that route before running config plugins. No resources
 * are acquired and no native projects/configuration are mutated here.
 */
module.exports = function withForge(config, options) {
  if (options !== undefined) fail('This config plugin is optionless. Use plugins: ["@nitro-forge/ignition"].');
  if (!config || typeof config !== 'object') fail('Expected the Expo app configuration.');
  const projectRoot = config._internal?.projectRoot;
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    fail('Expo must provide an absolute _internal.projectRoot when evaluating the plugin.');
  }
  if (config.newArchEnabled !== true) {
    fail('Set newArchEnabled: true in the Expo app config; Nitro v1 requires the New Architecture.');
  }
  const platforms = config.platforms ?? ['ios', 'android', 'web'];
  if (!Array.isArray(platforms)) fail('Expo platforms must be an array.');
  if (platforms.includes('ios') && config.experiments?.swiftPackageManager !== true) {
    fail('Set experiments.swiftPackageManager: true explicitly in the initial app config. On macOS run ordinary expo prebuild with installation enabled; --no-install skips SwiftPM setup.');
  }
  const appRequire = createRequire(path.join(projectRoot, 'package.json'));
  for (const [name, expected] of Object.entries(SUPPORTED_VERSIONS)) {
    const actual = readInstalledPackage(appRequire, name).version;
    if (actual !== expected) {
      fail(`Unsupported ${name} version ${String(actual)}; this candidate requires exactly ${expected}.`);
    }
  }
  validateAssets(path.resolve(__dirname, '..'));
  return config;
};
