import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [directory, platform] = process.argv.slice(2);
assert.ok(directory && ['ios', 'android'].includes(platform));
const bundle = resolve(directory, '_expo/static/js', platform);
const mapFile = readdirSync(bundle).find(name => name.endsWith('.map'));
assert.ok(mapFile, 'Missing Metro source map');
const { sources } = JSON.parse(readFileSync(resolve(bundle, mapFile), 'utf8'));
const copies = new Map();
for (const source of sources) {
  const match = source.match(/node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) {
    const [, instance, name] = match;
    if (!copies.has(name)) copies.set(name, new Set());
    copies.get(name).add(instance);
  }
}
const required = ['react', 'react-native', 'react-native-nitro-modules', 'nitro-core', 'zustand', '@nyc-tron/ui',
  ...['ignition', 'prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'].map(n => `@nitro-forge/${n}`)];
for (const name of required) {
  const instances = copies.get(name);
  assert.equal(instances?.size, 1, `Expected one bundled ${name}, found ${instances?.size ?? 0}`);
  const instance = [...instances][0];
  if (name.startsWith('@nyc-tron/')) assert.ok(instance.includes('+NYC-Tron-UI+releases+download+'), 'Tron source fallback');
  if (name.startsWith('@nitro-forge/')) assert.ok(instance.includes('@file+'), 'Forge source/registry fallback');
  console.log(`${name}: one ${platform} archive/runtime instance`);
}
