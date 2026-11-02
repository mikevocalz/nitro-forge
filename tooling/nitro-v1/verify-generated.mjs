/**
 * Release barrier for the isolated Nitro v1 alpha probe.
 * This checks package boundaries and real Nitrogen output, NOT native linking.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageDir = join(root, "packages/ignition-v1-lab");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const preview = readJson(join(packageDir, "package.json"));
const config = readJson(join(packageDir, "nitro.json"));
const app = readJson(join(root, "apps/example/package.json"));
const stable = readJson(join(root, "packages/ignition/package.json"));

const v1 = "1.0.0-alpha.nightly.115.gcdaf72e60229";
assert.equal(preview.private, true, "v1 is not ready for publishing");
assert.equal(preview.devDependencies.nitrogen, v1, "Nitrogen runtime and codegen must use the same build");
assert.equal(preview.devDependencies["nitro-core"], v1);
assert.equal(preview.peerDependencies["nitro-core"], v1);
assert.equal(preview.peerDependencies["react-native-nitro-modules"], v1);
assert.equal(preview.imports["#nitro/*"], "./nitrogen/generated/shared/javascript/*.cjs");
assert.equal(config.environment, "react-native");
assert.deepEqual(config.cxxNamespace, ["nitroforge", "ignitionv1"]);
assert.equal(config.apple.moduleName, "NitroForgeV1");
assert.deepEqual(config.android.namespace, ["nitroforge", "ignitionv1"]);
assert.ok(!Object.hasOwn(config, "ios"), "Nitro v1 uses apple rather than ios");
assert.ok(!Object.hasOwn(config, "autolinking"), "Nitro v1 autolinking is expressed in decorators");
assert.ok(!Object.hasOwn(config.android, "androidNamespace"));
assert.ok(!Object.hasOwn(app.dependencies, "@nitro-forge/ignition-v1-lab"),
  "Do not autolink Nitro alpha and stable in the same native app");
assert.ok(!Object.hasOwn(app.dependencies, "nitro-core"),
  "Do not link Nitro v1 core into the existing stable app");
assert.ok(!Object.hasOwn(app.dependencies, "react-native-nitro-modules")
  || !app.dependencies["react-native-nitro-modules"].startsWith("1."),
  "Do not upgrade the Expo app's native runtime until device test approval");
assert.ok(stable.devDependencies["react-native-nitro-modules"].startsWith("^0."),
  "Stable Ignition API must remain unchanged in this preview PR");

for (const name of ["ForgeFactory", "ForgeDocument"]) {
  const spec = readFileSync(join(packageDir, "src/specs", name + ".nitro.ts"), "utf8");
  assert.match(spec, new RegExp("export declare class " + name + " extends HybridObject"));
  assert.match(spec, /@Apple\(/);
  assert.match(spec, /@Android\(/);
  const runtime = join(packageDir, "nitrogen/generated/shared/javascript", name + ".cjs");
  assert.ok(existsSync(runtime), "Nitrogen did not produce native class export " + runtime);
  const declaration = join(packageDir, "nitrogen/generated/shared/javascript", name + ".d.cts");
  assert.ok(existsSync(declaration), "Nitrogen missing exported class type " + declaration);
}
console.log("Nitro v1 alpha Nitrogen generated both native classes, matched package/ABI versions, and kept stable Expo isolation.");
console.log("No C++/Rust bridge, Xcode, Gradle, Skia rendering or real-device runtime was tested.");
