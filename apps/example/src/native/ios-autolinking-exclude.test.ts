// Contract: nothing the app or NYC-Tron UI imports for native UI may be
// dropped from iOS autolinking.
//
// expo.autolinking.ios.exclude removes a module from the SwiftPM graph without any
// build error. The JS still calls requireNativeModule('ExpoUI') and the app dies at
// launch with "Cannot find native module 'ExpoUI'". Commit a1d0cee did exactly that
// to @expo/ui, which NYC-Tron's expo-controls import (NativeActionMenu, Select, SwiftUI
// host views). These checks fail at test time instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const appRoot = resolve(import.meta.dirname, '..', '..');
const repoRoot = resolve(appRoot, '..', '..');
const hostRequire = createRequire(join(appRoot, 'package.json'));
/** NYC-Tron packages the host installs, from the release pinned in tooling/nyc-tron.json. */
const kitRoots = (JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies;
const nycTronRoots = Object.keys(kitRoots).filter(name => name.startsWith('@nyc-tron/'))
  // The packages export no ./package.json, so read the host's own link.
  .map(name => realpathSync(join(appRoot, 'node_modules', name)));

type AutolinkingConfig = { exclude?: string[]; ios?: { exclude?: string[] } };
type AppPackageJson = { expo?: { autolinking?: AutolinkingConfig } };

/** Every package name excluded from iOS autolinking, top-level or iOS-only. */
function iosExcluded(pkg: AppPackageJson): Set<string> {
  const autolinking = pkg.expo?.autolinking ?? {};
  return new Set([...(autolinking.exclude ?? []), ...(autolinking.ios?.exclude ?? [])]);
}

const SOURCE_RX = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIR_RX = /^(node_modules|build|dist|\.next|\.expo|ios|android|__tests__)$/;
const SPECIFIER_RX = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR_RX.test(name)) sourceFiles(full, out);
    } else if (SOURCE_RX.test(name) && !/\.test\.[a-z]+$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function packageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? null);
}

/** Bare package names imported anywhere under `dirs`. */
function importedPackages(dirs: string[]): Set<string> {
  const names = new Set<string>();
  for (const file of dirs.flatMap(d => sourceFiles(d))) {
    for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER_RX)) {
      const name = match[1] ? packageName(match[1]) : null;
      if (name) names.add(name);
    }
  }
  return names;
}

/** Whether the host's installed copy of `name` ships iOS native code. */
function hostPackageRoot(name: string): string | null {
  try {
    return dirname(hostRequire.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

function shipsIosNative(root: string): boolean {
  const config = join(root, 'expo-module.config.json');
  if (existsSync(config)) {
    const platforms: string[] = JSON.parse(readFileSync(config, 'utf8')).platforms ?? [];
    if (platforms.some(p => p === 'apple' || p === 'ios')) return true;
  }
  if (existsSync(join(root, 'Package.swift'))) return true;
  const hasPodspec = (dir: string) => existsSync(dir) && readdirSync(dir).some(f => f.endsWith('.podspec'));
  return hasPodspec(root) || hasPodspec(join(root, 'ios'));
}

const appPkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as AppPackageJson;
const { HOST_NATIVE_MODULES } = hostRequire('./tooling/host-native-resolver.cjs') as { HOST_NATIVE_MODULES: string[] };

function nativeImportsExcluded(dirs: string[], excluded: Set<string>): string[] {
  return [...importedPackages(dirs)]
    .filter(name => excluded.has(name))
    .filter(name => {
      const root = hostPackageRoot(name);
      return root != null && shipsIosNative(root);
    })
    .sort();
}

test('no package the host routes shared UI to is excluded from iOS autolinking', () => {
  const excluded = iosExcluded(appPkg);
  assert.deepEqual(HOST_NATIVE_MODULES.filter(name => excluded.has(name)), []);
});

test('no native package the app or workspace packages import is excluded from iOS autolinking', () => {
  const dirs = [join(appRoot, 'app'), join(appRoot, 'src'), ...readdirSync(join(repoRoot, 'packages')).map(p => join(repoRoot, 'packages', p))];
  assert.deepEqual(nativeImportsExcluded(dirs, iosExcluded(appPkg)), []);
});

test('no native package NYC-Tron UI imports is excluded from iOS autolinking', () => {
  const dist = nycTronRoots.map(root => join(root, 'dist'));
  const kitImports = importedPackages(dist);
  assert.ok(kitImports.has('@expo/ui'), 'expo-controls is expected to import @expo/ui; if it stopped, update this contract');
  assert.deepEqual(nativeImportsExcluded(dist, iosExcluded(appPkg)), []);
});

test('@expo/ui carries the SwiftPM manifest Expo autolinking needs to build it', () => {
  // Without Package.swift, Expo's SwiftPM plugin refuses @expo/ui (it ships
  // spm.config.json with no prebuilt XCFramework), which is what the exclude hid.
  const root = hostPackageRoot('@expo/ui');
  assert.ok(root, '@expo/ui must be installed in the host app');
  const manifest = readFileSync(join(root, 'Package.swift'), 'utf8');
  assert.match(manifest, /\.library\(name: "ExpoUI", targets: \["ExpoUI", "ExpoUIObjC"\]\)/);
  assert.ok(existsSync(join(root, 'ios', 'ExpoUIObjC', 'include', 'ExpoUITouchHandlerHelper.h')));
});

test('the contract catches the exclude list commit a1d0cee shipped', () => {
  const a1d0cee = { expo: { autolinking: { ios: { exclude: ['@expo/ui', 'expo-dev-client'] } } } };
  const excluded = iosExcluded(a1d0cee);
  assert.deepEqual(HOST_NATIVE_MODULES.filter(name => excluded.has(name)), ['@expo/ui']);
});
