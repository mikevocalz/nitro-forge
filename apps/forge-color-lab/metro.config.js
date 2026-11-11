const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

// NYC-Tron UI ships className recipes (bg-surface-raised, rounded-control, ...);
// Uniwind compiles them against the tokens in global.css.
module.exports = withUniwindConfig(getDefaultConfig(__dirname), {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
