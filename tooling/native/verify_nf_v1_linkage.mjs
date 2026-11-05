#!/usr/bin/env node
/** Static source+generated registration gate, NOT a native device proof. */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const packageRoot = resolve(root, "packages/ignition-v1-lab");
const load = path => readFileSync(resolve(packageRoot, path), "utf8");
const pkg = JSON.parse(load("package.json"));

assert.equal(pkg.swiftpmConfig.name, "NitroForgeV1");
assert.equal(pkg.peerDependencies["react-native-nitro-modules"],
  "1.0.0-alpha.nightly.120.g33ef045b96c0");
assert.match(load("Package.swift"), /addNitrogenTargets/);
assert.match(load("Package.swift"), /NitroForgeRust\.xcframework/);
assert.match(load("Package.swift"), /nitrogen:begin/);
assert.match(load("android/CMakeLists.txt"), /libnf_sys\.a/);
assert.match(load("android/CMakeLists.txt"), /HybridForgeFactory\.cpp/);
assert.match(load("android/CMakeLists.txt"), /HybridForgeDocument\.cpp/);
assert.match(load("android/CMakeLists.txt"), /nf_sys/);
assert.match(load("android/src/main/cpp/cpp-adapter.cpp"), /registerAllNatives/);
// The library must not raise the app's minSdk; a hidden floor broke manifest merge.
assert.doesNotMatch(load("android/build.gradle"), /Math\.max\(rootVersion\("minSdkVersion"/);
assert.match(load("android/src/main/java/com/margelo/nitro/nitroforge/ignitionv1/NitroForgeV1Package.kt"),
  /NitroForgeV1OnLoad\.initializeNative/);
assert.match(load("react-native.config.js"), /ios: \{\}/);
assert.match(load("react-native.config.js"), /android: \{\}/);

const expected = [
  "nitrogen/generated/android/NitroForgeV1+autolinking.cmake",
  "nitrogen/generated/android/NitroForgeV1+autolinking.gradle",
  "nitrogen/generated/android/NitroForgeV1OnLoad.cpp",
  "nitrogen/generated/apple/NitroForgeV1Autolinking.cpp",
  "nitrogen/generated/shared/javascript/ForgeFactory.cjs",
];
for (const path of expected) {
  assert.ok(existsSync(resolve(packageRoot, path)), "Missing generated Nitro v1 file: " + path);
}
const appleLink = load("nitrogen/generated/apple/NitroForgeV1Autolinking.cpp");
assert.match(appleLink, /registerHybridClasses/);
const androidLink = load("nitrogen/generated/android/NitroForgeV1OnLoad.cpp");
assert.match(androidLink, /registerAllNatives/);
assert.ok(!load("android/src/main/cpp/cpp-adapter.cpp").includes("createHybridObject"));
console.log("Nitro v1 generated SwiftPM/Android sources and registration contracts verified");
