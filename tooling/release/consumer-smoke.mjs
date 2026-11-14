import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertInstalledInside, checkExports, checkSourceClosure, files, hash, inside, json, requireDisk } from './archive-files.mjs';
import { candidate } from './candidate-manifest.mjs';
import { unpackArchive } from './unpack-archive.mjs';
import { checkLicenseMembers } from './license-materials.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: {
  manifest: { type: 'string' }, output: { type: 'string' }, stage: { type: 'string', default: 'prepare' },
  'expected-source': { type: 'string' }, platform: { type: 'string' },
} });
assert.ok(values.manifest && values.output && values['expected-source'], '--manifest, --output, --expected-source required');
const manifestFile = resolve(values.manifest), app = resolve(values.output);
const manifest = candidate(manifestFile, values['expected-source']);
const fromCheckout = relative(root, app);
assert.ok(fromCheckout === '..' || fromCheckout.startsWith(`..${sep}`) || isAbsolute(fromCheckout), 'Consumer must be outside checkout');
assert.ok(!process.env.NYC_TRON_ROOT && !process.env.NYC_TRON_PACKAGES && !process.env.NODE_PATH, 'Development source links are forbidden');
const receiptPath = resolve(app, 'forge-consumer-receipt.json');
const identity = hash(manifestFile);
function run(command, args, cwd = app) {
  requireDisk(cwd);
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } });
}
if (values.stage === 'prepare') {
  assert.ok(!existsSync(app), 'Consumer directory exists; choose a fresh app');
  requireDisk(dirname(app), manifest.archives.reduce((n, a) => n + statSync(inside(dirname(manifestFile), a.archive)).size, 0) * 3);
  const inspect = mkdtempSync(resolve(tmpdir(), 'forge-consumer-archive-'));
  try {
    for (const archive of manifest.archives) {
      const extracted = unpackArchive(inside(dirname(manifestFile), archive.archive), resolve(inspect, archive.name.split('/')[1]));
      const pkg = json(resolve(extracted, 'package.json'));
      assert.equal(pkg.name, archive.name);
      assert.equal(pkg.version, manifest.version);
      checkExports(extracted, pkg);
      checkSourceClosure(extracted, pkg);
      checkLicenseMembers(extracted, pkg, manifest.originalLicenseSha256, manifest.sourceCommit);
      assert.deepEqual(files(extracted).sort(), archive.contents.map(f => f.path).sort(), 'Archive content inventory omitted/added files');
      for (const file of archive.contents) assert.equal(hash(inside(extracted, file.path)), file.sha256, `Archive content inventory mismatch: ${file.path}`);
    }
  } finally { rmSync(inspect, { recursive: true, force: true }); }
  mkdirSync(app, { recursive: true });
  const fixture = resolve(root, 'tooling/release/consumer-fixture');
  cpSync(fixture, app, { recursive: true });
  const dependencies = { ...manifest.runtime, 'expo-file-system': '58.0.13', zustand: '5.1.0' };
  const overrides = {};
  const artifacts = resolve(app, 'artifacts');
  mkdirSync(artifacts);
  for (const archive of manifest.archives) {
    const file = inside(dirname(manifestFile), archive.archive);
    const staged = inside(artifacts, archive.archive);
    cpSync(file, staged);
    assert.equal(hash(staged), archive.sha256, `Staged archive checksum mismatch: ${archive.archive}`);
    // Keep the lockfile independent of Linux/macOS runner absolute paths.
    // These are copies of the same verified archives, never checkout sources.
    const specifier = `file:./artifacts/${archive.archive}`;
    dependencies[archive.name] = specifier;
    overrides[archive.name] = specifier;
  }
  const tron = json(resolve(root, 'tooling/nyc-tron.json'));
  // Pinned release UI control used by the visible acceptance fixture.
  assert.ok(tron.packages['@nyc-tron/ui']?.url, 'Missing pinned Tron UI archive');
  dependencies['@nyc-tron/ui'] = tron.packages['@nyc-tron/ui'].url;
  writeFileSync(resolve(app, 'package.json'), JSON.stringify({
    name: 'forge-clean-consumer', private: true, version: '0.0.0', main: 'index.js',
    packageManager: 'pnpm@12.18.0', dependencies,
    devDependencies: { typescript: '7.0.2', '@types/react': '19.3.0' },
    pnpm: { overrides },
  }, null, 2) + '\n');
  writeFileSync(resolve(app, 'pnpm-workspace.yaml'), 'packages:\n  - "."\nminimumReleaseAge: 0\n');
  writeFileSync(resolve(app, '.npmrc'), 'node-linker=isolated\nenable-global-virtual-store=false\n');
  writeFileSync(receiptPath, JSON.stringify({ sourceCommit: manifest.sourceCommit, manifestSha256: identity, stages: ['prepare'], nativeRuntime: 'NOT RUN' }, null, 2));
} else {
  assert.equal(json(receiptPath).manifestSha256, identity, 'Consumer belongs to different archive bytes');
  assert.ok(realpathSync(app) === app, 'Consumer root cannot be a symlink');
  switch (values.stage) {
    case 'install': run('corepack', ['pnpm', 'install', '--strict-peer-dependencies', '--ignore-scripts',
      ...(existsSync(resolve(app, 'pnpm-lock.yaml')) ? ['--frozen-lockfile'] : [])]); break;
    case 'verify': {
      const appRequire = createRequire(resolve(app, 'package.json'));
      const observed = [];
      function metadata(name, resolver = appRequire) {
        const entry = resolver.resolve(name);
        assertInstalledInside(app, entry);
        let packageRoot = dirname(entry);
        while (!existsSync(resolve(packageRoot, 'package.json')) || json(resolve(packageRoot, 'package.json')).name !== name) {
          const parent = dirname(packageRoot);
          assert.notEqual(parent, packageRoot, `Installed package metadata missing: ${name}`);
          assertInstalledInside(app, parent);
          packageRoot = parent;
        }
        assertInstalledInside(app, packageRoot);
        const file = resolve(packageRoot, 'package.json'), pkg = json(file);
        assert.equal(pkg.name, name);
        observed.push({ name, version: pkg.version, entry: realpathSync(entry), packageRoot: realpathSync(packageRoot), packageJsonSha256: hash(file) });
        return { packageRoot, pkg };
      }
      for (const runtime of [...Object.keys(manifest.runtime), 'zustand', '@nyc-tron/ui', 'expo-file-system']) {
        const { pkg } = metadata(runtime);
        if (manifest.runtime[runtime]) assert.equal(pkg.version, manifest.runtime[runtime], `Installed runtime differs: ${runtime}`);
      }
      for (const archive of manifest.archives) {
        const { packageRoot, pkg } = metadata(archive.name);
        assert.equal(pkg.version, manifest.version);
        checkExports(packageRoot, pkg);
        checkLicenseMembers(packageRoot, pkg, manifest.originalLicenseSha256, manifest.sourceCommit);
        for (const file of archive.contents) assert.equal(hash(inside(packageRoot, file.path)), file.sha256, `Installed bytes changed: ${archive.name}/${file.path}`);
      }
      const expoRequire = createRequire(appRequire.resolve('expo/package.json'));
      for (const name of ['expo-modules-core', '@expo/cli', '@expo/config-plugins']) metadata(name, expoRequire);
      const { resolveConfigPluginFunctionWithInfo } = expoRequire('@expo/config-plugins/build/utils/plugin-resolver');
      const bare = resolveConfigPluginFunctionWithInfo(app, '@nitro-forge/ignition');
      const direct = resolveConfigPluginFunctionWithInfo(app, '@nitro-forge/ignition/app.plugin.cjs');
      assert.ok(bare.pluginFile.endsWith('/app.plugin.cjs') && bare.isPluginFile);
      assert.equal(bare.pluginFile, direct.pluginFile);
      bare.plugin({ ...json(resolve(app, 'app.json')).expo, _internal: { projectRoot: app } });
      const rn = observed.find(pkg => pkg.name === 'react-native');
      const reactNativeRenderer = ['dev', 'prod'].map(mode => {
        const file = inside(rn.packageRoot, `Libraries/Renderer/implementations/ReactFabric-${mode}.js`);
        const version = readFileSync(file, 'utf8').match(/version:\s*"([^"]+)",\s*rendererPackageName:\s*"react-native-renderer"/)?.[1];
        assert.ok(version, 'Actual installed Fabric renderer version must be identifiable');
        return { mode, version, sha256: hash(file) };
      });
      writeFileSync(resolve(app, 'installed-packages.json'), JSON.stringify({ sourceCommit: manifest.sourceCommit, manifestSha256: identity, reactNativeRenderer,
        lockSha256: hash(resolve(app, 'pnpm-lock.yaml')), packages: observed,
        archives: manifest.archives.map(({ name, sha256 }) => ({ name, sha256 })),
      }, null, 2) + '\n');
      break;
    }
    case 'bundle':
      run('corepack', ['pnpm', 'exec', 'tsc', '--noEmit']);
      for (const platform of ['ios', 'android']) {
        run('corepack', ['pnpm', 'exec', 'expo', 'export', '--platform', platform, '--dump-sourcemap', '--output-dir', `export-${platform}`]);
        run(process.execPath, [resolve(root, 'tooling/release/check-consumer-bundle.mjs'), resolve(app, `export-${platform}`), platform]);
      }
      break;
    case 'prebuild':
      assert.ok(['ios', 'android'].includes(values.platform));
      if (values.platform === 'ios') assert.equal(process.platform, 'darwin', 'iOS integration requires macOS; skipped setup is not a pass');
      {
      const packageHash = hash(resolve(app, 'package.json')), lockHash = hash(resolve(app, 'pnpm-lock.yaml'));
      run('corepack', ['pnpm', 'exec', 'expo', 'prebuild', '--clean', '--platform', values.platform]);
      assert.equal(hash(resolve(app, 'package.json')), packageHash, 'Prebuild changed the pinned dependency graph; diagnose template mismatch');
      assert.equal(hash(resolve(app, 'pnpm-lock.yaml')), lockHash, 'Prebuild changed the frozen lockfile');
      if (values.platform === 'ios') {
        const project = execFileSync('find', ['ios', '-maxdepth', '1', '-name', '*.xcodeproj'], { cwd: app, encoding: 'utf8' }).trim();
        assert.ok(project && !project.includes('\n'));
        assert.ok(existsSync(resolve(app, project, '.spm-injected.json')), 'SwiftPM was not integrated');
      }
      }
      break;
    default: throw new Error(`Unknown consumer stage: ${values.stage}`);
  }
  const receipt = json(receiptPath);
  receipt.stages.push(values.stage + (values.platform ? `:${values.platform}` : ''));
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ stage: values.stage, app, sourceCommit: manifest.sourceCommit, manifestSha256: identity }));
