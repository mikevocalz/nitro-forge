const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const { withUniwindConfig } = require('uniwind/metro');
const { createHostNativeResolver } = require('./tooling/host-native-resolver.cjs');
const config = getDefaultConfig(__dirname);
// The monorepo root holds the workspace packages and pnpm's store links.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), path.resolve(__dirname, '../..')])];
// Workspace packages export built lib/ files; their `@nitro-forge/source`
// condition serves src/ so the app bundles without building them first.
// FORGE_BUILT_PACKAGES=1 bundles the built lib/ entries instead, as a release
// tarball consumer would (run `turbo run build` first).
// Node-only subpaths (ignition/cli, folio/render, photo/raw) have no
// react-native target under either condition, so they stay unresolvable here.
if (process.env.FORGE_BUILT_PACKAGES !== '1') {
  config.resolver.unstable_conditionNames = [...new Set([...(config.resolver.unstable_conditionNames ?? []), '@nitro-forge/source'])];
}
config.resolver.resolveRequest = createHostNativeResolver(__dirname, config.resolver.resolveRequest);
module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './src/uniwind-types.d.ts',
  polyfills: { rem: 14 },
});
