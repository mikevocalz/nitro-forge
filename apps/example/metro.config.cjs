const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const { withUniwindConfig } = require('uniwind/metro');
const { createHostNativeResolver } = require('./tooling/host-native-resolver.cjs');
// Development consumes the application's actual source-owned UI package.
// A consuming app normally resolves @acme/ui from its own workspace instead.
const uiRoot = process.env.STUDIO_UI_ROOT || path.resolve(__dirname, '../../../nyc-mon/packages/ui');
const config = getDefaultConfig(__dirname);
// Explicit finite source-owned roots include assets and pnpm symlink targets.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), path.resolve(__dirname, '../..'), path.resolve(uiRoot, '../..')])];
config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, '@acme/ui': uiRoot };
config.resolver.resolveRequest = createHostNativeResolver(__dirname, config.resolver.resolveRequest);
module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './src/uniwind-types.d.ts',
  polyfills: { rem: 14 },
});
