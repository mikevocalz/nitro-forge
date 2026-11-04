const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hostRequire = createRequire(path.join(root, 'package.json'));
const expoRequire = createRequire(hostRequire.resolve('expo/package.json'));
const bundled = hostRequire('expo/bundledNativeModules.json');
const semver = expoRequire('semver');
const manifest = hostRequire('./package.json');
const config = require('../metro.config.cjs');
const moduleRoots = {};
for (const name of ['expo-image', 'react-native-gesture-handler']) {
  assert.ok(manifest.dependencies[name], `${name} must be declared by the native host`);
  const installed = hostRequire(`${name}/package.json`);
  const matchesExpo = semver.satisfies(installed.version, bundled[name]);
  // Explicit latest-npm migration: Gesture Handler 3.4 is newer than SDK58's
  // bundled 3.3. A custom native build is required; Expo Go is not validation.
  const latestCandidate = name === 'react-native-gesture-handler' && installed.version === '3.4.0';
  assert.ok(matchesExpo || latestCandidate, `${name}@${installed.version} must match the documented host candidate`);
  if (!matchesExpo) console.log(`${name}@${installed.version}: deliberate latest-npm deviation from Expo ${bundled[name]}; native build/device validation remains required`);
  moduleRoots[name] = path.dirname(hostRequire.resolve(`${name}/package.json`));
  // Exercise the actual Metro config with a shared UI/Solito source origin.
  const context = { originModulePath: '/external-shared-ui/node_modules/solito/image/native.js', resolveRequest: (_context, target) => target };
  for (const platform of ['ios', 'android']) assert.equal(config.resolver.resolveRequest(context, name, platform), name);
  assert.equal(config.resolver.resolveRequest(context, name, 'web'), name);
  console.log(`${name}@${installed.version}: host declaration and Metro resolution passed`);
}
for (const name of ['react', 'react-native']) {
  const context = { resolveRequest: (_context, target) => target };
  const root = path.dirname(hostRequire.resolve(`${name}/package.json`));
  assert.equal(config.resolver.resolveRequest(context, name, 'android'), name);
  assert.equal(config.resolver.resolveRequest(context, name, 'ios'), name);
}
const autoPackage = expoRequire.resolve('expo-modules-autolinking/package.json');
const autoManifest = expoRequire('expo-modules-autolinking/package.json');
const cli = path.resolve(path.dirname(autoPackage), autoManifest.bin['expo-modules-autolinking']);
const autolink = (command, platform) => JSON.parse(execFileSync(process.execPath, [cli, command, '--project-root', root, '--platform', platform, '--json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
for (const platform of ['apple', 'android']) {
  const modules = autolink('resolve', platform).modules.filter(module => module.packageName === 'expo-image');
  assert.equal(modules.length, 1, `exactly one ExpoImage module for ${platform}`);
  const image = modules[0];
  assert.equal(image.packageVersion, hostRequire('expo-image/package.json').version);
  if (platform === 'apple') {
    assert.ok(image.modules.some(module => module.class === 'ImageModule'));
    assert.ok(image.pods.some(pod => pod.podName === 'ExpoImage' && pod.podspecDir.startsWith(moduleRoots['expo-image'] + path.sep)));
  } else {
    assert.ok(image.projects.some(project => project.modules.some(module => module.classifier === 'expo.modules.image.ExpoImageModule') && project.sourceDir.startsWith(moduleRoots['expo-image'] + path.sep)));
  }
  console.log(`ExpoImage ${platform} autolinking passed (configuration evidence, not a native build)`);
}
for (const platform of ['ios', 'android']) {
  const dependency = autolink('react-native-config', platform).dependencies['react-native-gesture-handler'];
  assert.equal(dependency.root, moduleRoots['react-native-gesture-handler']);
  assert.ok(dependency.platforms[platform]);
  console.log(`Gesture Handler ${platform} autolinking passed (configuration evidence, not device input)`);
}
const nightly = '1.0.0-alpha.nightly.120.g33ef045b96c0';
assert.equal(hostRequire('react-native-nitro-modules/package.json').version, nightly);
assert.equal(hostRequire('nitro-core/package.json').version, nightly);
const skiaRequire = createRequire(hostRequire.resolve('react-native-skia/package.json'));
const webgpuRequire = createRequire(hostRequire.resolve('react-native-webgpu/package.json'));
assert.equal(skiaRequire('./package.json').version, '3.9.1');
assert.equal(webgpuRequire('./package.json').version, '0.21.0');
assert.equal(skiaRequire('react-native-webgpu-dawn/package.json').version, '157.1.0');
assert.equal(webgpuRequire('react-native-webgpu-dawn/package.json').version, '157.1.0');
console.log('Skia/WebGPU share Dawn157.1.0; native host declares exact Nitro v1 runtime');
for (const platform of ['ios', 'android']) {
  const dependency = autolink('react-native-config', platform).dependencies['@nitro-forge/ignition'];
  assert.equal(dependency.root, path.resolve(root, '../../packages/ignition'));
  assert.ok(dependency.platforms[platform]);
  if (platform === 'ios') assert.ok(dependency.platforms.ios.podspecPath.endsWith('/NitroForgeV1.podspec'));
  else assert.equal(dependency.platforms.android.packageInstance, 'new NitroForgePackage()');
  console.log(`Ignition v1 ${platform} packaging discovered (not a native compile/link)`);
}
