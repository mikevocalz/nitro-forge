import assert from "node:assert/strict";
import { test } from "node:test";
import { lockfileVersions, storeVersions, versionAtLeast } from "./skia-v3-policy.mjs";

test("versionAtLeast compares dotted versions per component", () => {
  assert.equal(versionAtLeast("16.4", "16.4"), true);
  assert.equal(versionAtLeast("16.10", "16.4"), true);
  assert.equal(versionAtLeast("17", "16.4"), true);
  assert.equal(versionAtLeast("16.3", "16.4"), false);
  assert.equal(versionAtLeast("15.1", "16.4"), false);
  assert.equal(versionAtLeast(26, 26), true);
  assert.equal(versionAtLeast(24, 26), false);
  assert.throws(() => versionAtLeast("16.x", "16.4"));
  assert.throws(() => versionAtLeast(undefined, "16.4"));
});

const lock = `packages:

  react-native-webgpu-dawn@157.0.0:
    resolution: {integrity: sha512-a}

  'react-native-webgpu-dawn@157.1.0':
    resolution: {integrity: sha512-b}

snapshots:

  react-native-skia@3.8.1(react@19.3.0):
    dependencies:
      react-native-webgpu-dawn: 157.0.0

  react-native-webgpu-dawn@157.0.0: {}
`;

test("lockfileVersions counts distinct declared versions only", () => {
  assert.deepEqual([...lockfileVersions(lock, "react-native-webgpu-dawn")].sort(), [
    "157.0.0",
    "157.1.0",
  ]);
  assert.equal(lockfileVersions("packages:\n", "react-native-webgpu-dawn").size, 0);
});

test("storeVersions treats peer-hash directories of one version as one version", () => {
  const entries = [
    "react-native-webgpu-dawn@157.0.0",
    "react-native-webgpu-dawn@157.0.0_react@19.3.0",
    "react-native-skia@3.8.1_react@19.3.0",
  ];
  assert.deepEqual([...storeVersions(entries, "react-native-webgpu-dawn")], ["157.0.0"]);
  entries.push("react-native-webgpu-dawn@157.1.0");
  assert.equal(storeVersions(entries, "react-native-webgpu-dawn").size, 2);
});
