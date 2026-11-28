// Shared step for the tooling/verify-*.mjs contract scripts.
//
// The editor controls (@nitro-forge/editor-controls) compile under their own
// compiler flags (see packages/editor-controls/tsconfig.json), so a contract
// cannot compile their sources under Forge's stricter base flags. Instead:
//   1. tronSubpathsMissing() checks that a NYC-Tron UI build exports every
//      @nyc-tron/ui subpath the controls import. For a NYC-Tron checkout,
//      stageTronDeclarations() copies its declarations into this tree first.
//   2. emitEditorControlsDeclarations() compiles the controls with their own
//      flags against that NYC-Tron UI build and writes their declarations to
//      a temporary folder.
//   3. The caller compiles its contract with Forge's base flags, resolving
//      @nitro-forge/editor-controls/* to those declarations.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const controls = join(root, 'packages/editor-controls');

/** Every `@nyc-tron/ui/...` specifier imported by the editor-controls sources. */
export function tronSubpathsUsed() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name))
        for (const m of readFileSync(path, 'utf8').matchAll(/["'](@nyc-tron\/ui\/[^"']+)["']/g)) found.add(m[1]);
    }
  };
  walk(join(controls, 'src'));
  return [...found].sort();
}

/**
 * Copy a NYC-Tron checkout's @nyc-tron/ui declarations (package.json and
 * the .d.ts files under dist) under packages/editor-controls/node_modules/.cache and
 * return { dir, dispose }. A checkout has its own node_modules, so compiling
 * against it in place would load a second copy of react-native-gesture-handler,
 * react-native and the other shared packages, and their nominal types (enums,
 * classes) would not match the copies the controls import. From the staged
 * copy, those imports resolve to the packages installed for the controls, as
 * they do at runtime (see SHARED_RUNTIME in tooling/nyc-tron-metro.cjs).
 */
export function stageTronDeclarations(uiDir) {
  const cache = join(controls, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const dir = join(mkdtempSync(join(cache, 'forge-tron-')), 'node_modules/@nyc-tron/ui');
  mkdirSync(dir, { recursive: true });
  cpSync(join(uiDir, 'package.json'), join(dir, 'package.json'));
  cpSync(join(uiDir, 'dist'), join(dir, 'dist'), {
    recursive: true,
    filter: (source) => statSync(source).isDirectory() || source.endsWith('.d.ts'),
  });
  return { dir, dispose: () => rmSync(join(dir, '../../..'), { recursive: true, force: true }) };
}

/** Subpaths the controls import that the given @nyc-tron/ui package does not export with a types file. */
export function tronSubpathsMissing(uiDir) {
  const manifest = JSON.parse(readFileSync(join(uiDir, 'package.json'), 'utf8'));
  return tronSubpathsUsed().filter((specifier) => {
    const entry = manifest.exports?.['.' + specifier.slice('@nyc-tron/ui'.length)];
    return typeof entry?.types !== 'string' || !existsSync(join(uiDir, entry.types));
  });
}

/**
 * Compile the editor controls against `tronPaths` (a tsconfig `paths` map for
 * @nyc-tron/ui) and return { paths, dispose }: a `paths` entry that resolves
 * @nitro-forge/editor-controls/* to the emitted declarations, and a cleanup.
 * The declarations go under packages/editor-controls/node_modules/.cache so
 * their own imports (react, react-native, ...) resolve from the package.
 */
export function emitEditorControlsDeclarations(tronPaths) {
  const cache = join(controls, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const outDir = mkdtempSync(join(cache, 'forge-contract-'));
  try {
    const config = join(outDir, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({
      extends: join(controls, 'tsconfig.json'),
      compilerOptions: {
        noEmit: false, emitDeclarationOnly: true, declaration: true, declarationMap: false, sourceMap: false,
        rootDir: join(controls, 'src'), outDir: join(outDir, 'types'), paths: tronPaths,
      },
    }));
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', config], { cwd: root, stdio: 'inherit' });
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }
  // One entry per export: a subpath such as ./NativeSeekBar has platform
  // files (NativeSeekBar.web.tsx, ...) rather than a file of the same name.
  const { exports } = JSON.parse(readFileSync(join(controls, 'package.json'), 'utf8'));
  const paths = {};
  for (const [key, entry] of Object.entries(exports)) {
    const file = entry.types.replace(/^\.\/(?:src|dist)\//, '').replace(/(?:\.d)?\.tsx?$/, '.d.ts');
    paths['@nitro-forge/editor-controls' + key.slice(1)] = [join(outDir, 'types', file)];
  }
  return { paths, dispose: () => rmSync(outDir, { recursive: true, force: true }) };
}
