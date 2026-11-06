/**
 * Optional NYC-Tron dev-link for a Forge app's metro.config.js.
 *
 *   const { withNycTronDevLink } = require("../../tooling/nyc-tron-metro.cjs");
 *   module.exports = withNycTronDevLink(config, { projectRoot: __dirname });
 *
 * With NYC_TRON_ROOT unset this returns the config untouched, and the app
 * bundles the release tarballs it installed. With NYC_TRON_ROOT pointing at a
 * NYC-Tron-UI checkout, the checkout joins watchFolders and the shared
 * runtime packages below always resolve to the app's own copies, so a linked
 * NYC-Tron source tree cannot pull in its own React or React Native.
 *
 * NYC-Tron packages export their built dist/ files, so keep `pnpm build` (or
 * `tsc -w -p tsconfig.build.json` in the package you are editing) running in
 * the checkout. The dev-link only changes what Metro bundles. Native modules (for example
 * @nyc-tron/native-controls' SwiftUI/Compose views) still come from the
 * installed tarball until the app is reinstalled against the checkout.
 */
const fs = require("node:fs");
const path = require("node:path");

const SHARED_RUNTIME = [
  "react",
  "react-native",
  "@expo/ui",
  "expo-modules-core",
  "expo-file-system",
  "zustand",
  "@tanstack/react-table",
  "react-native-gesture-handler",
];

function isSharedRuntime(moduleName, names) {
  return names.some((name) => moduleName === name || moduleName.startsWith(name + "/"));
}

/** Resolve `@nyc-tron/x/sub` through the linked package's exports map to a file. */
function resolveLinkedFile(packageDir, manifest, subpath, platform) {
  const key = subpath ? "./" + subpath : ".";
  const entry = manifest.exports ? manifest.exports[key] : key === "." ? manifest.main : undefined;
  const conditions = platform === "web" ? ["browser", "default"] : ["react-native", "default"];
  let target = entry;
  if (target && typeof target === "object") {
    target = conditions.map((condition) => target[condition]).find((value) => typeof value === "string");
  }
  if (typeof target !== "string") {
    throw new Error(`${manifest.name} does not export "${key}" (NYC_TRON_ROOT dev-link)`);
  }
  const file = path.join(packageDir, target);
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing. Build ${manifest.name} in the NYC_TRON_ROOT checkout first.`);
  }
  return file;
}

function packageNameOf(moduleName) {
  const parts = moduleName.split("/");
  return moduleName.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Resolve the named packages from the app for every importer, chaining any
 * existing resolver. Use it directly for Forge's own source packages (for
 * example react-native-nitro-modules required by @nitro-forge/ignition);
 * withNycTronDevLink applies it with SHARED_RUNTIME when a checkout is linked.
 *
 * @param {import("metro-config").MetroConfig} config
 * @param {{ projectRoot: string, packages: string[] }} options
 */
function pinToApp(config, options) {
  const upstream = config.resolver?.resolveRequest;
  const appOrigin = path.join(options.projectRoot, "package.json");
  return {
    ...config,
    resolver: {
      ...config.resolver,
      resolveRequest(context, moduleName, platform) {
        const next = upstream ?? context.resolveRequest;
        if (isSharedRuntime(moduleName, options.packages))
          return next({ ...context, originModulePath: appOrigin }, moduleName, platform);
        return next(context, moduleName, platform);
      },
    },
  };
}

/**
 * @param {import("metro-config").MetroConfig} config
 * @param {{ projectRoot: string, nycTronRoot?: string, sharedRuntime?: string[], includePackages?: string[] }} options
 */
function withNycTronDevLink(config, options) {
  const nycTronRoot = options.nycTronRoot ?? process.env.NYC_TRON_ROOT;
  if (!nycTronRoot) return config;

  const linkedRoot = path.resolve(nycTronRoot);
  if (!fs.existsSync(path.join(linkedRoot, "packages"))) {
    throw new Error(`NYC_TRON_ROOT=${linkedRoot} is not a NYC-Tron-UI checkout (no packages/ directory)`);
  }
  const names = options.sharedRuntime ?? SHARED_RUNTIME;
  // Source packages in the checkout, keyed by package name.
  const linkedPackages = new Map();
  for (const dir of fs.readdirSync(path.join(linkedRoot, "packages"))) {
    const manifestPath = path.join(linkedRoot, "packages", dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.name && manifest.name.startsWith("@nyc-tron/") &&
        (!options.includePackages || options.includePackages.includes(manifest.name)))
      linkedPackages.set(manifest.name, { dir: path.dirname(manifestPath), manifest });
  }

  // Shared runtime resolves from the app so linked and installed code share one copy.
  const pinned = pinToApp(config, { projectRoot: options.projectRoot, packages: names });
  const upstream = pinned.resolver.resolveRequest;
  return {
    ...pinned,
    watchFolders: [...(config.watchFolders ?? []), linkedRoot],
    resolver: {
      ...pinned.resolver,
      resolveRequest(context, moduleName, platform) {
        const name = packageNameOf(moduleName);
        const linked = linkedPackages.get(name);
        if (linked) {
          const subpath = moduleName.slice(name.length + 1);
          return { type: "sourceFile", filePath: resolveLinkedFile(linked.dir, linked.manifest, subpath, platform) };
        }
        return upstream(context, moduleName, platform);
      },
    },
  };
}

module.exports = { withNycTronDevLink, pinToApp, SHARED_RUNTIME };
