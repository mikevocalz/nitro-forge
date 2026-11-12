'use strict';
// Expo config plugin: applies one brand manifest to the app config.
//
//   ["../../tooling/brand/plugin.cjs", { "manifest": "./brand.json" }]
//   ["../../tooling/brand/plugin.cjs", { "brands": "./brands", "default": "suite" }]
//
// With `brands`, FORGE_BRAND=<id> picks brands/<id>.json, so one Expo app
// builds the suite or any single studio as its own installable app.
// FORGE_BRAND_FILE=<path> overrides either form (the rebrand test uses it).
//
// The plugin sets the app name, launcher label, identifiers, scheme, icons
// and favicon, and exposes the brand to JavaScript as `extra.forgeBrand`.

const path = require('node:path');
const { load } = require('./brand.cjs');

function configPlugins(projectRoot) {
  // Resolve from the app, not from this file: pnpm does not hoist expo to the root.
  return require(require.resolve('expo/config-plugins', { paths: [projectRoot] }));
}

function manifestPath(projectRoot, props) {
  if (process.env.FORGE_BRAND_FILE) return path.resolve(process.cwd(), process.env.FORGE_BRAND_FILE);
  if (props.manifest) return path.resolve(projectRoot, props.manifest);
  if (props.brands) return path.resolve(projectRoot, props.brands, `${process.env.FORGE_BRAND || props.default || 'suite'}.json`);
  throw new Error('withForgeBrand needs a "manifest" or a "brands" option');
}

function withForgeBrand(config, props = {}) {
  const projectRoot = config._internal?.projectRoot ?? process.cwd();
  const brand = load(manifestPath(projectRoot, props));
  const rel = file => `./${path.relative(projectRoot, file).split(path.sep).join('/')}`;
  const icons = brand.iconFiles;

  config.name = brand.productName;
  config.slug = brand.slug;
  config.scheme = brand.scheme;
  config.icon = rel(icons.app);
  config.ios = { ...config.ios, bundleIdentifier: brand.ios.bundleIdentifier, icon: rel(icons.app) };
  config.android = {
    ...config.android,
    package: brand.android.package,
    adaptiveIcon: {
      foregroundImage: rel(icons.adaptiveForeground),
      backgroundImage: rel(icons.adaptiveBackground),
      monochromeImage: rel(icons.adaptiveMonochrome),
    },
  };
  config.web = { ...config.web, name: brand.productName, shortName: brand.shortName, favicon: rel(icons.favicon) };
  config.extra = {
    ...config.extra,
    forgeBrand: {
      id: brand.id,
      productName: brand.productName,
      shortName: brand.shortName,
      // Omitted for the suite: Expo serialises a null in `extra` as {}.
      ...(brand.engine ? { engine: brand.engine } : {}),
      bundleIdentifier: brand.ios.bundleIdentifier,
      androidPackage: brand.android.package,
    },
  };

  const { withInfoPlist, withStringsXml, AndroidConfig } = configPlugins(projectRoot);
  // The launcher shows the short name. Apple documents CFBundleName as a short
  // name of up to 15 characters, so it takes the short name too. The full
  // name stays in the store record, the web title and the About screen.
  config = withInfoPlist(config, mod => {
    mod.modResults.CFBundleDisplayName = brand.shortName;
    mod.modResults.CFBundleName = brand.shortName;
    return mod;
  });
  config = withStringsXml(config, mod => {
    mod.modResults = AndroidConfig.Strings.setStringItem(
      [AndroidConfig.Resources.buildResourceItem({ name: 'app_name', value: brand.shortName })],
      mod.modResults,
    );
    return mod;
  });
  return config;
}

module.exports = withForgeBrand;
