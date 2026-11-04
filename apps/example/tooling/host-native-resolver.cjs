const path = require('node:path');
const { createRequire } = require('node:module');
const HOST_NATIVE_MODULES = [
  'react', 'react-native', 'expo', 'expo-image', 'react-native-gesture-handler',
  'react-native-nitro-modules', 'react-native-skia', 'react-native-webgpu',
  'react-native-reanimated', 'react-native-worklets', 'react-native-svg',
  'react-native-safe-area-context', 'react-native-screens', '@expo/ui',
];

/** Source-owned shared UI must use the native modules linked into its host app,
 * not whichever SDK happens to be installed beside an external UI checkout. */
function createHostNativeResolver(projectRoot, previous, resolvePackageRoot) {
  const hostRequire = createRequire(path.join(projectRoot, 'package.json'));
  const rootFor = resolvePackageRoot || (name => path.dirname(hostRequire.resolve(`${name}/package.json`)));
  return (context, moduleName, platform) => {
    const next = previous || context.resolveRequest;
    const hostModule = platform && platform !== 'web'
      ? HOST_NATIVE_MODULES.find(name => moduleName === name || moduleName.startsWith(`${name}/`)) : undefined;
    if (!hostModule) return next(context, moduleName, platform);
    rootFor(hostModule); // Fail closed if the host does not declare/install it.
    // Keep the package name intact: RN0.88 uses export-only subpaths such as
    // react-native/setup-env. Absolute filesystem rewrites bypass those exports.
    return next({ ...context, originModulePath: path.join(projectRoot, 'package.json') }, moduleName, platform);
  };
}
module.exports = { createHostNativeResolver, HOST_NATIVE_MODULES };
