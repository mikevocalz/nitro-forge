const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const { createHostNativeResolver } = require('./tooling/host-native-resolver.cjs');
// Development consumes the application's actual source-owned UI package.
// A consuming app normally resolves @acme/ui from its own workspace instead.
const uiRoot = process.env.STUDIO_UI_ROOT || path.resolve(__dirname, '../../../nyc-mon/packages/ui');
const config = getDefaultConfig(__dirname);
// SDK58's default on-demand filesystem handles the sibling UI's pnpm links.
// Retain Expo's monorepo/watch/scheme defaults instead of old watchFolders hacks.
config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, '@acme/ui': uiRoot };
config.resolver.resolveRequest = createHostNativeResolver(__dirname, config.resolver.resolveRequest);
module.exports = config;
