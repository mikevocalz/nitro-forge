const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const { withUniwindConfig } = require('uniwind/metro');
const { createHostNativeResolver } = require('./tooling/host-native-resolver.cjs');
const config = getDefaultConfig(__dirname);
// The monorepo root holds the workspace packages and pnpm's store links.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), path.resolve(__dirname, '../..')])];
config.resolver.resolveRequest = createHostNativeResolver(__dirname, config.resolver.resolveRequest);
module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './src/uniwind-types.d.ts',
  polyfills: { rem: 14 },
});
