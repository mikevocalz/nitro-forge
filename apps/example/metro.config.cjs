const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
// Development consumes the application's actual source-owned UI package.
// A consuming app normally resolves @acme/ui from its own workspace instead.
const uiRoot = process.env.STUDIO_UI_ROOT || path.resolve(__dirname, '../../../nyc-mon/packages/ui');
const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), path.resolve(uiRoot, '..')];
config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, '@acme/ui': uiRoot };
module.exports = config;
