// Expo 58 default Metro config, plus two pins:
// 1. The Forge source packages (Ignition, Cadence) live outside this app, so
//    their requires of the native runtime resolve from the app. That keeps one
//    React, one React Native and the single Nitro v1 copy the native build links.
// 2. NYC_TRON_ROOT, when set, bundles a local NYC-Tron-UI checkout instead of
//    the release tarballs. See docs/NYC_TRON_UI_HANDOFF.md.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withAcceptanceEntry } = require("./acceptance-entry.cjs");
const { pinToApp, withNycTronDevLink, SHARED_RUNTIME } = require("../../tooling/nyc-tron-metro.cjs");

const projectRoot = __dirname;
const forgeRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.join(forgeRoot, "packages/ignition"),
  path.join(forgeRoot, "packages/cadence"),
  path.join(forgeRoot, "packages/telemetry"),
  path.join(forgeRoot, "packages/board"),
];

// lib0's React Native WebCrypto entry expects a separate browser polyfill.
// Yjs only uses getRandomValues through lib0/random; supply Expo's native RNG
// for that importer alone. Other WebCrypto/subtle consumers keep normal
// resolution and cannot mistake this for a complete WebCrypto implementation.
const upstreamResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if ((platform === "ios" || platform === "android") && moduleName === "lib0/webcrypto" &&
      /\/lib0\/(?:random\.js|dist\/random(?:-[\w-]+)?\.cjs)$/.test(context.originModulePath.replaceAll("\\", "/"))) {
    return { type: "sourceFile", filePath: path.join(projectRoot, "yjs-random.native.ts") };
  }
  return (upstreamResolver ?? context.resolveRequest)(context, moduleName, platform);
};

// Explicit lab mode serves a separate acceptance entry. Normal consumers keep
// their released dependency graph; candidate-only exports are isolated here.
withAcceptanceEntry(config, projectRoot);

module.exports = withNycTronDevLink(
  pinToApp(config, { projectRoot, packages: [...SHARED_RUNTIME, "react-native-nitro-modules"] }),
  { projectRoot, ...(process.env.NYC_TRON_PACKAGES ? {
    includePackages: process.env.NYC_TRON_PACKAGES.split(",").map(name => name.trim()).filter(Boolean),
  } : {}) },
);
