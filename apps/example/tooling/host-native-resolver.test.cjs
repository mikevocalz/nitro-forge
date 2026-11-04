const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHostNativeResolver } = require('./host-native-resolver.cjs');

test('shared UI resolves host Expo Image and Gesture Handler on iOS and Android/Meta', () => {
  const calls = [];
  const context = { originModulePath: '/external-ui/node_modules/solito/image/native.js', resolveRequest: (_context, name, platform) => { calls.push([name, platform, _context.originModulePath]); return { type: 'sourceFile', filePath: name }; } };
  const resolver = createHostNativeResolver('/host', null, name => `/host/node_modules/${name}`);
  for (const platform of ['ios', 'android', 'visionos']) {
    assert.equal(resolver(context, 'expo-image', platform).filePath, 'expo-image');
    assert.equal(resolver(context, 'react-native-gesture-handler', platform).filePath, 'react-native-gesture-handler');
  }
  assert.equal(calls.length, 6);
  assert.equal(resolver(context, 'uniwind', 'ios').filePath, 'uniwind');
  assert.equal(resolver(context, '@expo/html-elements', 'android').filePath, '@expo/html-elements');
  assert.ok(calls.every(call => call[2] === '/host/package.json'));
  assert.equal(resolver(context, 'react-native/setup-env', 'ios').filePath, 'react-native/setup-env');
  assert.equal(resolver(context, 'react', 'ios').filePath, 'react');
  assert.equal(resolver(context, 'react-native/Libraries/Image/Image', 'android').filePath, 'react-native/Libraries/Image/Image');
  assert.equal(resolver(context, 'expo-image/build/index', 'android').filePath, path.join('expo-image', 'build/index'));
});

test('web/Next Image and unrelated packages retain the existing resolver', () => {
  const original = [], fallback = [];
  const context = { resolveRequest: (...args) => fallback.push(args) };
  const resolver = createHostNativeResolver('/host', (_context, name, platform) => { original.push([name, platform]); return name; }, () => { throw new Error('must not resolve native package'); });
  for (const name of ['expo-image', 'next/image', 'solito/image', 'react-native-gesture-handler', 'expo-image-other']) assert.equal(resolver(context, name, 'web'), name);
  assert.equal(resolver(context, '@acme/ui/Image', 'android'), '@acme/ui/Image');
  assert.equal(original.length, 6); assert.equal(fallback.length, 0);
});

test('missing host native module fails instead of silently borrowing another app SDK', () => {
  const resolver = createHostNativeResolver('/host', null, () => { throw new Error('host dependency missing'); });
  assert.throws(() => resolver({ resolveRequest: () => 'wrong external package' }, 'expo-image', 'android'), /host dependency missing/);
});
