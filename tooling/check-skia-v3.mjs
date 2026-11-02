/**
 * NitroForge's cross-platform GPU release gate.
 * It does not treat a manifest check as proof of a working native build.
 * Run with --registry in an online CI job to compare pinned vs published npm latest.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const example = readJson(join(root, "apps/example/package.json"));
const app = readJson(join(root, "apps/example/app.json"));
const deps = example.dependencies;

function parse(v) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  assert.ok(match, `Expected an exact npm version, got ${v}`);
  return match.slice(1).map(Number);
}
function atLeast(v, maj, min, pat = 0) {
  const actual = parse(v);
  return actual[0] > maj
    || (actual[0] === maj && (actual[1] > min
      || (actual[1] === min && actual[2] >= pat)));
}
function findLegacyDependencies() {
  const paths = [join(root, "package.json")];
  for (const dir of ["apps", "packages"]) {
    const base = join(root, dir);
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const file = join(base, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(file)) paths.push(file);
    }
  }
  return paths.filter((p) => {
    const pkg = readJson(p);
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
      (section) => Object.hasOwn(pkg[section] ?? {}, "@shopify/react-native-skia"),
    );
  });
}
const legacy = findLegacyDependencies();
assert.deepEqual(legacy, [], `Old Shopify Skia would conflict with v3: ${legacy.join(", ")}`);
assert.equal(parse(deps["react-native-skia"])[0], 3, "Only react-native-skia v3 is supported.");
assert.ok(atLeast(deps["react-native-skia"], 3, 7), "Skia v3 Graphite must be >=3.7.");
assert.ok(atLeast(deps["react-native-webgpu"], 0, 17), "WebGPU must be >=0.17 for Skia >=3.7 (same Dawn family).");
assert.ok(atLeast(deps["expo"], 58, 0), "Expo example must target SDK 58+.");
assert.ok(atLeast(deps["react-native"], 0, 88), "Expo SDK 58 targets React Native 0.88+.");
const properties = app.expo.plugins.find((plugin) =>
  Array.isArray(plugin) && plugin[0] === "expo-build-properties",
);
assert.ok(properties, "Skia v3 needs the expo-build-properties native configuration.");
assert.ok(properties[1]?.android?.minSdkVersion >= 26, "Skia v3 requires Android minSdk 26.");
assert.ok(Number(properties[1]?.ios?.deploymentTarget) >= 16.4, "Expo SDK 58 requires iOS 16.4+.");

console.log(`Skia v${deps["react-native-skia"]} Graphite + WebGPU v${deps["react-native-webgpu"]}: manifest contract OK.`);
console.log("Not a runtime/build check. Verify one react-native-webgpu-dawn, Android Vulkan 1.1, and device builds.");

if (process.argv.includes("--registry")) {
  for (const name of ["react-native-skia", "react-native-webgpu"]) {
    const latest = execFileSync("npm", ["view", name, "version", "--fetch-retries=1", "--fetch-timeout=12000"], {
      cwd: root, encoding: "utf8", timeout: 20000,
    }).trim();
    assert.equal(deps[name], latest, `${name} has an upstream npm update (${latest}); review its Dawn pairing and open a dependency PR.`);
    console.log(`${name}: pinned and published npm latest are both ${latest}`);
  }
}
