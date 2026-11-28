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
// Studio engines nf-sys can link, in rust/nf-sys/Cargo.toml feature order.
// Must match the Cargo features, the C++ kindName table and ForgeEngineKind;
// withForge.node.cjs checks all three.
const ENGINES = Object.freeze([
  'prism', 'cadence', 'splice', 'folio', 'pitch', 'tally',
  'quill', 'photo', 'motion', 'design', 'draft', 'scene',
]);
// gradle.properties / Podfile.properties.json key read by android/build.gradle
// and scripts/resolve-engines.cjs.
const ENGINES_PROPERTY = 'nitroForge.engines';
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

/**
 * Canonical engine list from an array or a comma-separated string ("all"
 * allowed). Rejects empty, unknown and duplicate names. Returns names in
 * ENGINES order so the same selection always writes the same property.
 */
function parseEngineList(value, source) {
  let names;
  if (typeof value === 'string') {
    names = value.trim() === 'all' ? [...ENGINES] : value.split(',').map(name => name.trim());
  } else if (Array.isArray(value)) {
    names = value;
  } else {
    fail(`${source} must be an array of engine names: ${ENGINES.join(', ')}.`);
  }
  if (names.length === 0 || (names.length === 1 && names[0] === '')) {
    fail(`${source} must name at least one engine: ${ENGINES.join(', ')}.`);
  }
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== 'string' || !ENGINES.includes(name)) {
      fail(`${source} has unknown engine ${JSON.stringify(name)}. Known engines: ${ENGINES.join(', ')}.`);
    }
    if (seen.has(name)) fail(`${source} lists ${name} twice.`);
    seen.add(name);
  }
  return ENGINES.filter(name => seen.has(name));
}

function parseOptions(options) {
  if (options === undefined) return { engines: undefined };
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    fail('Plugin options must be an object, e.g. ["@nitro-forge/ignition", { engines: ["prism"] }].');
  }
  const unknown = Object.keys(options).filter(key => key !== 'engines');
  if (unknown.length) fail(`Unknown plugin option ${unknown.join(', ')}. The only option is engines.`);
  if (options.engines === undefined) return { engines: undefined };
  if (!Array.isArray(options.engines)) {
    fail(`The engines option must be an array of engine names: ${ENGINES.join(', ')}.`);
  }
  return { engines: parseEngineList(options.engines, 'The engines option') };
}

// Expo's withMod contract, written structurally so the plugin keeps loading
// nothing from Expo or React Native: the newest mod runs first, then hands its
// results to the mod registered before it.
function withMod(config, platform, mod, action) {
  config.mods ??= {};
  config.mods[platform] ??= {};
  const previous = config.mods[platform][mod];
  if (previous?.isProvider) fail(`Cannot add the ${platform}.${mod} mod after its provider.`);
  config.mods[platform][mod] = async function withForgeEngines({ modRequest, ...rest }) {
    const results = await action({ ...rest, modRequest });
    return previous ? previous(results) : results;
  };
  return config;
}

function withEngineProperties(config, engines, platforms) {
  const value = engines.join(',');
  if (platforms.includes('android')) {
    withMod(config, 'android', 'gradleProperties', async modConfig => {
      const properties = modConfig.modResults;
      const existing = properties.find(item => item.type === 'property' && item.key === ENGINES_PROPERTY);
      if (existing) existing.value = value;
      else properties.push({ type: 'property', key: ENGINES_PROPERTY, value });
      return modConfig;
    });
  }
  if (platforms.includes('ios')) {
    withMod(config, 'ios', 'podfileProperties', async modConfig => {
      modConfig.modResults[ENGINES_PROPERTY] = value;
      return modConfig;
    });
  }
  return config;
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

function validateAssets(packageRoot, engines) {
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
  // An archive without an engines field was built with every engine (the
  // nf-sys default). One with it must link every engine the app asked for.
  if (manifest.engines !== undefined) {
    const archived = parseEngineList(manifest.engines, 'Native asset manifest engines');
    const missing = (engines ?? ENGINES).filter(name => !archived.includes(name));
    if (missing.length) {
      fail(`This Ignition archive links ${archived.join(', ')} but the app needs ${missing.join(', ')}. Rebuild nf-sys with NF_ENGINES=${(engines ?? ENGINES).join(',')} or set the engines plugin option.`);
    }
  }
  // Producer and clean-consumer checks verify hashes and actual architecture
  // metadata. Presence validation here is not an ABI or native build verdict.
}

/**
 * Expo config plugin. The caller opts into SwiftPM in initial app config: Expo
 * chooses that route before running config plugins. No resources are acquired.
 *
 * Without options nothing native is touched. With { engines: [...] } the
 * plugin records the studio engines the app ships as nitroForge.engines in
 * android/gradle.properties (read by android/build.gradle, which checks the
 * Rust archive at CMake configure) and ios/Podfile.properties.json (read by
 * scripts/build-apple.sh through NF_APP_ROOT). Build nf-sys with the same set
 * (NF_ENGINES, or NF_APP_ROOT after prebuild) to drop the other engines.
 */
function withForge(config, options) {
  const { engines } = parseOptions(options);
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
  validateAssets(path.resolve(__dirname, '..'), engines);
  if (engines) withEngineProperties(config, engines, platforms);
  return config;
}

module.exports = withForge;
module.exports.ENGINES = ENGINES;
module.exports.ENGINES_PROPERTY = ENGINES_PROPERTY;
module.exports.parseEngineList = parseEngineList;
