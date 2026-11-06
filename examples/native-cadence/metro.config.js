// Expo 58 default Metro config, plus two pins:
// 1. The Forge source packages (Ignition, Cadence) live outside this app, so
//    their requires of the native runtime resolve from the app. That keeps one
//    React, one React Native and the single Nitro v1 copy the native build links.
// 2. NYC_TRON_ROOT, when set, bundles a local NYC-Tron-UI checkout instead of
//    the release tarballs. See docs/NYC_TRON_UI_HANDOFF.md.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { pinToApp, withNycTronDevLink, SHARED_RUNTIME } = require("../../tooling/nyc-tron-metro.cjs");

const projectRoot = __dirname;
const forgeRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.join(forgeRoot, "packages/ignition"),
  path.join(forgeRoot, "packages/cadence"),
];

// Explicit lab mode serves a separate acceptance entry. Normal consumers keep
// their released dependency graph; candidate-only exports are isolated here.
const acceptanceEntry = { checkpoints: "checkpoint-acceptance", transactions: "transaction-acceptance" }[process.env.FORGE_ACCEPTANCE];
if (acceptanceEntry) {
  const rewrite = config.server?.rewriteRequestUrl;
  config.server = {
    ...config.server,
    rewriteRequestUrl(url) {
      const rewritten = rewrite ? rewrite(url) : url;
      return rewritten.replace(/\/index\.bundle(?=\?|$)/, `/${acceptanceEntry}.bundle`);
    },
  };
}

module.exports = withNycTronDevLink(
  pinToApp(config, { projectRoot, packages: [...SHARED_RUNTIME, "react-native-nitro-modules"] }),
  { projectRoot, ...(process.env.NYC_TRON_PACKAGES ? {
    includePackages: process.env.NYC_TRON_PACKAGES.split(",").map(name => name.trim()).filter(Boolean),
  } : {}) },
);
