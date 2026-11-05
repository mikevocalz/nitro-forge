const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
// Workspace packages and pnpm assets live outside the app directory.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), path.resolve(__dirname, "../..")])];

// NYC-Tron UI ships className recipes (bg-accent, bg-surface-raised, ...);
// Uniwind compiles them against the tokens in global.css.
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
