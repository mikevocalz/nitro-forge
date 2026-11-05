/**
 * Headless engine package boundary policy.  A manifest/source guard, not proof
 * that Rust binaries, Nitro codegen or npm publish tarballs are valid.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const engineNames = ["prism", "cadence", "splice", "folio", "pitch", "tally", "quill"];
const get = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

for (const engine of engineNames) {
  const pkg = get("packages/" + engine + "/package.json");
  assert.equal(pkg.name, "@nitro-forge/" + engine);
  const runtime = pkg.dependencies ?? {};
  assert.equal(runtime["@nitro-forge/ignition"], "workspace:*");
  for (const [name] of Object.entries(runtime)) {
    assert.ok(!name.startsWith("@acme/") && !name.startsWith("@moyo/"),
      engine + " is not permitted to depend on Moyo: " + name);
    assert.ok(!["react", "react-native", "expo", "@expo/ui", "react-native-skia",
      "@shopify/react-native-skia", "react-native-webgpu"].includes(name),
      engine + " is headless and cannot depend on renderer/UI: " + name);
  }
}

const ignition = get("packages/ignition/package.json");
assert.equal(ignition.name, "@nitro-forge/ignition");
const all = [get("package.json"), get("apps/example/package.json"), ignition,
  ...engineNames.map((n) => get("packages/" + n + "/package.json"))];
for (const pkg of all) {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  assert.ok(!Object.hasOwn(allDeps, "@shopify/react-native-skia"),
    pkg.name + " must not link old Shopify Skia v2");
  if (Object.hasOwn(allDeps, "react-native-skia")) {
    assert.match(allDeps["react-native-skia"], /^[~^]?3\./,
      "New renderer only supports react-native-skia v3");
  }
}
console.log("Ignition and seven headless public engines have no UI/renderer/Moyo production dependencies.");
console.log("This check does not validate generated native code, release tarballs, licenses or npm latest.");
