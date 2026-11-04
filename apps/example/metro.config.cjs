const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const { createHostNativeResolver } = require('./tooling/host-native-resolver.cjs');
// Development consumes the application's actual source-owned UI package.
// A consuming app normally resolves @acme/ui from its own workspace instead.
const uiRoot = process.env.STUDIO_UI_ROOT || path.resolve(__dirname, '../../../nyc-mon/packages/ui');
const config = getDefaultConfig(__dirname);
// Metro 0.87.1 (Expo 58's pin) only resolves files inside watched roots, so the
// sibling UI package is watched explicitly alongside Expo's monorepo defaults.
config.watchFolders = [...(config.watchFolders ?? []), uiRoot];
config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, '@acme/ui': uiRoot };
config.resolver.resolveRequest = createHostNativeResolver(__dirname, config.resolver.resolveRequest);
module.exports = config;
