// Read-only preflight: never patches Expo or changes Metro's native file map.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const host = createRequire(path.resolve(__dirname, '../package.json'));
const expo = createRequire(host.resolve('expo/package.json'));
const configRequire = createRequire(expo.resolve('@expo/metro-config/package.json'));
const metro = createRequire(configRequire.resolve('@expo/metro/package.json'));
// Deliberate user-requested compatibility candidate, not Expo's upstream pin.
const EXPO_METRO = '0.87.2';
for (const name of Object.keys(metro('./package.json').dependencies)) {
  if (!name.startsWith('metro')) continue;
  assert.equal(metro(`${name}/package.json`).version, EXPO_METRO, `${name} must stay coherent`);
}
const resolver = metro('metro-resolver');
const result = resolver.resolve({
  originModulePath: '/external/workspace/source.ts',
  schemeResolvers: { 'forge-test': (_context, name, platform) => ({ type: 'sourceFile', filePath: `/resolved/${platform}/${name.slice('forge-test:'.length)}` }) },
}, 'forge-test:fixture', 'ios');
assert.equal(result.filePath, '/resolved/ios/fixture');
console.log(`PASS: coherent Metro ${EXPO_METRO} family and actual schemeResolvers dispatch`);

const expoFileMap = configRequire("@expo/metro-file-map");
const FileMap = expoFileMap.default || expoFileMap;
assert.equal(typeof FileMap.prototype.addRoot, "function");
assert.equal(typeof FileMap.prototype.getRoots, "function");
console.log("PASS: Expo file-map exposes real dynamic-root APIs; run watcher tests for semantics");
