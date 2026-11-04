// Read-only preflight: never patches Expo or changes Metro's native file map.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const host = createRequire(path.resolve(__dirname, '../package.json'));
const expo = createRequire(host.resolve('expo/package.json'));
const configRequire = createRequire(expo.resolve('@expo/metro-config/package.json'));
const metro = createRequire(configRequire.resolve('@expo/metro/package.json'));
// Expo's own Metro package declares the Metro version it was built against;
// the workspace overrides must match it exactly.
const EXPO_METRO = metro('./package.json').dependencies.metro;
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
