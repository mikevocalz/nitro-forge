// Contract: every package that puts native iOS code into the app under SwiftPM is
// compiled for the new architecture.
//
// CocoaPods adds RCT_NEW_ARCH_ENABLED through install_modules_dependencies. SwiftPM has
// no such hook, so a Package.swift that leaves it out compiles the package's Fabric
// component views as plain UIViews. They then have no +componentDescriptorProvider,
// React Native falls back to UIView's default (a provider whose constructor is null),
// and the app crashes in ComponentDescriptorRegistry::add the first time JS renders
// one. react-native-svg shipped that way after commit a1d0cee.
//
// The package set is not hardcoded. It is what the two autolinkers resolve for iOS:
// React Native's (react-native-config) and Expo's (resolve -p apple). A package added
// later is checked the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const appRoot = resolve(import.meta.dirname, '..', '..');
const hostRequire = createRequire(join(appRoot, 'package.json'));

type IosPackage = { name: string; root: string; via: 'react-native' | 'expo' };

function autolinkingCli(): string {
  const expoPkg = hostRequire.resolve('expo/package.json');
  const pkgJson = createRequire(expoPkg).resolve('expo-modules-autolinking/package.json');
  const bin = (JSON.parse(readFileSync(pkgJson, 'utf8')) as { bin: Record<string, string> }).bin;
  return join(dirname(pkgJson), Object.values(bin)[0] ?? 'bin/expo-modules-autolinking.js');
}

function runAutolinking(args: string[]): unknown {
  const out = execFileSync(process.execPath, [autolinkingCli(), ...args], {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out);
}

function packageRootOf(dir: string): string {
  let current = dir;
  while (!existsSync(join(current, 'package.json')) && dirname(current) !== current) current = dirname(current);
  return current;
}

/** Every package either autolinker links into the iOS app, deduplicated by root. */
function iosPackages(): IosPackage[] {
  const byRoot = new Map<string, IosPackage>();
  const rn = runAutolinking(['react-native-config', '--platform', 'ios', '--json']) as {
    dependencies: Record<string, { root: string; platforms?: { ios?: unknown } }>;
  };
  for (const [name, dep] of Object.entries(rn.dependencies)) {
    if (dep.platforms?.ios) byRoot.set(dep.root, { name, root: dep.root, via: 'react-native' });
  }
  const expo = runAutolinking(['resolve', '-p', 'apple', '--json']) as {
    modules: Array<{ packageName: string; pods: Array<{ podspecDir: string }> }>;
  };
  for (const mod of expo.modules) {
    const podspecDir = mod.pods[0]?.podspecDir;
    if (!podspecDir) continue;
    const root = packageRootOf(podspecDir);
    if (!byRoot.has(root)) byRoot.set(root, { name: mod.packageName, root, via: 'expo' });
  }
  return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const GUARD_RX = /^\s*#\s*(?:if|ifdef|elif)\b.*\bRCT_NEW_ARCH_ENABLED\b/m;
const NATIVE_SOURCE_RX = /\.(m|mm|h|hpp|cpp|swift)$/;
const SKIP_DIR_RX = /^(node_modules|android|windows|macos|web|lib|build|example|Tests?|__tests__|\.build)$/;

function gatedFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR_RX.test(name)) gatedFiles(full, out);
    } else if (NATIVE_SOURCE_RX.test(name) && GUARD_RX.test(readFileSync(full, 'utf8'))) {
      out.push(full);
    }
  }
  return out;
}

/** Settings blocks of one kind (`cSettings`, `cxxSettings`, `swiftSettings`) in a manifest. */
function settingsBlocks(manifest: string, kind: string): string[] {
  const blocks: string[] = [];
  const rx = new RegExp(`\\b${kind}:\\s*\\[`, 'g');
  for (let m = rx.exec(manifest); m; m = rx.exec(manifest)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < manifest.length && depth > 0; i++) {
      if (manifest[i] === '[') depth++;
      else if (manifest[i] === ']') depth--;
    }
    blocks.push(manifest.slice(m.index + m[0].length, i - 1));
  }
  return blocks;
}

function definesIn(manifest: string, kind: string): boolean {
  return settingsBlocks(manifest, kind).some(b => /\.define\(\s*"RCT_NEW_ARCH_ENABLED"/.test(b));
}

/** Expo ships some modules as prebuilt XCFrameworks; SwiftPM never compiles their sources. */
function isPrebuilt(root: string): boolean {
  return ['debug', 'release'].every(flavor => existsSync(join(root, 'prebuilds', 'output', flavor, 'xcframeworks')));
}

/** Why a package's gated sources would compile without the new architecture, or null. */
function newArchProblem(root: string): string | null {
  const gated = gatedFiles(root);
  if (gated.length === 0 || isPrebuilt(root)) return null;
  const manifestPath = join(root, 'Package.swift');
  if (!existsSync(manifestPath)) {
    return `${gated.length} gated files and no Package.swift to define RCT_NEW_ARCH_ENABLED`;
  }
  const manifest = readFileSync(manifestPath, 'utf8');
  const needs = new Set<string>();
  for (const f of gated) needs.add(f.endsWith('.swift') ? 'swiftSettings' : f.endsWith('.h') ? 'header' : /\.(mm|cpp|hpp)$/.test(f) ? 'cxxSettings' : 'cSettings');
  if (needs.delete('header')) needs.add('cSettings').add('cxxSettings');
  const missing = [...needs].filter(kind => !definesIn(manifest, kind));
  return missing.length ? `${gated.length} gated files (e.g. ${relative(root, gated[0] ?? root)}); Package.swift lacks the define in ${missing.join(', ')}` : null;
}

const packages = iosPackages();

test('autolinking resolves the packages this contract is meant to cover', () => {
  const names = new Set(packages.map(p => p.name));
  for (const expected of ['@nitro-forge/ignition', 'react-native-svg', 'react-native-safe-area-context', 'react-native-screens', '@expo/ui', '@nyc-tron/reserved-regions']) {
    assert.ok(names.has(expected), `${expected} missing from autolinking output: ${[...names].join(', ')}`);
  }
});

test('every iOS package with RCT_NEW_ARCH_ENABLED-gated sources is built with the define', () => {
  const problems = packages.map(p => [p.name, newArchProblem(p.root)] as const).filter(([, why]) => why != null);
  assert.deepEqual(Object.fromEntries(problems), {});
});

test('the check rejects a manifest without the define and accepts one with it', () => {
  const without = 'cSettings: [.define("REACT_NATIVE_MINOR_VERSION", to: "88"), .headerSearchPath("x")],\ncxxSettings: [.define("NDEBUG", .when(configuration: .release))],\n';
  const withIt = 'cSettings: [.define("RCT_NEW_ARCH_ENABLED", to: "1")],\ncxxSettings: [.headerSearchPath("y"), .define("RCT_NEW_ARCH_ENABLED", to: "1")],\n';
  assert.equal(definesIn(without, 'cSettings') || definesIn(without, 'cxxSettings'), false);
  assert.equal(definesIn(withIt, 'cSettings') && definesIn(withIt, 'cxxSettings'), true);
});

// When an iOS build is on disk, check the binary itself: every Fabric component class
// the codegen registry maps a component name to must carry its own
// +componentDescriptorProvider, or it inherits UIView's null one.
test('built app: every third-party Fabric component class implements componentDescriptorProvider', t => {
  const products = join(appRoot, 'ios', 'build', 'DerivedData', 'Build', 'Products');
  const provider = join(appRoot, 'ios', 'build', 'generated', 'ios', 'ReactCodegen', 'RCTThirdPartyComponentsProvider.mm');
  const configs = existsSync(products) ? readdirSync(products).filter(d => d.endsWith('-iphoneos') || d.endsWith('-iphonesimulator')) : [];
  const binary = configs.map(c => join(products, c, 'NitroForge.app', 'NitroForge')).find(p => existsSync(p));
  if (!binary || !existsSync(provider)) {
    t.skip('no iOS build on disk');
    return;
  }
  const classes = [...readFileSync(provider, 'utf8').matchAll(/NSClassFromString\(@"([A-Za-z0-9_]+)"\)/g)].map(m => m[1] ?? '');
  assert.ok(classes.length > 0, 'codegen listed no third-party components');
  const symbols = execFileSync('nm', [binary], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const present = new Set([...symbols.matchAll(/_OBJC_CLASS_\$_([A-Za-z0-9_]+)/g)].map(m => m[1]));
  const implemented = new Set([...symbols.matchAll(/\+\[([A-Za-z0-9_]+) componentDescriptorProvider\]/g)].map(m => m[1]));
  // react-native-screens compiles NSObject stubs for its opt-in "gamma" components
  // (RNS_GAMMA_ENABLED); they stay inert unless that flag is set.
  const screens = packages.find(p => p.name === 'react-native-screens');
  const stubsHeader = screens ? join(screens.root, 'ios', 'stubs', 'RNSGammaStubs.h') : '';
  const stubs = new Set(
    stubsHeader && existsSync(stubsHeader)
      ? [...readFileSync(stubsHeader, 'utf8').matchAll(/@interface (\w+) : NSObject/g)].map(m => m[1])
      : [],
  );
  const missingClass = classes.filter(c => !present.has(c));
  const broken = classes.filter(c => present.has(c) && !implemented.has(c) && !stubs.has(c));
  assert.deepEqual(missingClass, [], 'codegen maps these components to classes the binary does not contain');
  assert.deepEqual(broken, [], 'these classes fall back to UIView\'s null provider');
});
