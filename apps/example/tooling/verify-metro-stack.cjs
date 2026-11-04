// Read-only preflight: never patches Expo or changes Metro's native file map.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const host = createRequire(path.resolve(__dirname, '../package.json'));
const expo = createRequire(host.resolve('expo/package.json'));
const configRequire = createRequire(expo.resolve('@expo/metro-config/package.json'));
const metro = createRequire(configRequire.resolve('@expo/metro/package.json'));
for (const name of Object.keys(metro('./package.json').dependencies)) {
  if (!name.startsWith('metro')) continue;
  assert.equal(metro(`${name}/package.json`).version, '0.87.2', `${name} must stay coherent`);
}
const resolver = metro('metro-resolver');
const result = resolver.resolve({
  originModulePath: '/external/workspace/source.ts',
  schemeResolvers: { 'forge-test': (_context, name, platform) => ({ type: 'sourceFile', filePath: `/resolved/${platform}/${name.slice('forge-test:'.length)}` }) },
}, 'forge-test:fixture', 'ios');
assert.equal(result.filePath, '/resolved/ios/fixture');
console.log('PASS: coherent Metro 0.87.2 family and actual schemeResolvers dispatch');
const cli = createRequire(expo.resolve('@expo/cli/package.json'));
const createFileMap = cli('./build/src/start/server/metro/createFileMap-fork').default;
const config = require('../metro.config.cjs');
let compatible = true;
for (const onDemand of [true, false]) {
  const { fileMap } = createFileMap({ ...config, resolver: { ...config.resolver, unstable_onDemandFilesystem: onDemand } }, { watch: false });
  const supported = typeof fileMap.addRoot === 'function' && typeof fileMap.getRoots === 'function';
  compatible &&= supported;
  console.log(`Expo on-demand filesystem=${onDemand}: dynamic-root API ${supported ? 'present' : 'MISSING'}`);
}
if (!compatible) {
  console.error('BLOCKED: Expo CLI file-map fork lacks Metro 0.87.2 addRoot/getRoots. Native/web Expo exports cannot start. See docs/native/SDK58_METRO_UPGRADE.md.');
  process.exitCode = 1;
}
