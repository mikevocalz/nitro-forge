// Contract between modules/reserved-regions and @acme/ui's useReservedRegions().
//
// The kit looks the module up by the name "ReservedRegions" (globalThis.expoV2
// on Android, requireOptionalNativeModule on iOS). If the native name drifts, or
// a platform drops out of autolinking, nothing fails to build: the hook just
// returns [] forever and the persona dock never appears. These checks fail first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', 'modules', 'reserved-regions');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const JS_NAME = 'ReservedRegions';

type ModuleConfig = {
  platforms?: string[];
  apple?: { modules?: string[] };
  android?: { modules?: Array<string | { class: string }> };
};
const config = JSON.parse(read('expo-module.config.json')) as ModuleConfig;

test('expo-module.config.json autolinks both platforms', () => {
  assert.ok(config.platforms?.includes('apple'), 'platforms must include "apple"');
  assert.ok(config.platforms?.includes('android'), 'platforms must include "android"');
});

test('apple: the config lists the Swift class, and that class is exported as ReservedRegions', () => {
  assert.deepEqual(config.apple?.modules, ['ReservedRegionsModule']);
  const swift = read('ios/ReservedRegionsModule.swift');
  assert.match(swift, new RegExp(`@ExpoModule\\("${JS_NAME}"\\)\\s*\\n\\s*public final class ReservedRegionsModule\\b`));
  assert.match(swift, /@JS[\s\S]*?func query\(\) async -> \[ReservedRegionRecord\]/);
});

test('android: the Kotlin v2 module is compiled in and exported as ReservedRegions', () => {
  // v2 modules are found by the compiler plugin. Listing the class under
  // android.modules would put it in the legacy ExpoModulesPackageList, which
  // expects expo.modules.kotlin.modules.Module and fails to compile.
  assert.equal(config.android?.modules, undefined, 'android.modules must stay unset for a v2 module');
  assert.match(read('android/build.gradle'), /expoModule\s*\{[^}]*\bv2 true\b/);

  const kotlin = read('android/src/main/java/ai/nitroforge/reservedregions/ReservedRegionsModule.kt');
  assert.match(kotlin, new RegExp(`@ExpoModule\\("${JS_NAME}"\\)\\s*\\nclass ReservedRegionsModule : Module\\(\\)`));
  assert.match(kotlin, /@JS\s*\n\s*suspend fun query\(\): List<ReservedRegionRecord>/);
  // The kit subscribes with addListener('changed', (regions: ReservedRegion[]) => …).
  assert.match(kotlin, /@Event\("changed"\)\s*\n\s*val onChanged = event<List<ReservedRegionRecord>>/);
});

test('android record carries every field ReservedRegion declares', () => {
  const record = read('android/src/main/java/ai/nitroforge/reservedregions/ReservedRegionRecord.kt');
  for (const field of ['kind', 'x', 'y', 'width', 'height', 'margins', 'active', 'orientation', 'state', 'occlusionType', 'separating']) {
    assert.match(record, new RegExp(`\\bval ${field}:`), `ReservedRegionRecord.${field} missing`);
  }
});
