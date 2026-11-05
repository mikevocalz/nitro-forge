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

module.exports = withNycTronDevLink(
  pinToApp(config, { projectRoot, packages: [...SHARED_RUNTIME, "react-native-nitro-modules"] }),
  { projectRoot },
);
