/**
 * Headless engine package boundary policy.  A manifest/source guard, not proof
 * that Rust binaries, Nitro codegen or npm publish tarballs are valid.
 *
 * Two checks:
 *   1. Manifests: the headless engines and Ignition depend on no UI,
 *      renderer or Moyo package, and nothing links Shopify Skia v2.
 *   2. Entries: no package's `react-native` or `default` export entry reaches
 *      a Node builtin or an ES-module `require()` (see entry-reachability.mjs).
 *      Source entries are always checked; built lib/ entries are checked
 *      where they exist. `--built` fails when a built entry is missing, for
 *      use after `turbo run build`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { checkPackageEntries, formatViolation, listWorkspacePackages } from "./entry-reachability.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const engineNames = ["prism", "cadence", "splice", "folio", "pitch", "tally", "quill"];
const get = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

export function checkManifests() {
  for (const engine of engineNames) {
    const pkg = get("packages/" + engine + "/package.json");
    assert.equal(pkg.name, "@nitro-forge/" + engine);
    // Ignition is a peer, so a consumer installs one copy of its native module
    // for every engine; the devDependency keeps the workspace build linked.
    assert.ok(!Object.hasOwn(pkg.dependencies ?? {}, "@nitro-forge/ignition"),
      engine + " must take @nitro-forge/ignition as a peerDependency, not a dependency");
    assert.equal(pkg.peerDependencies?.["@nitro-forge/ignition"], "workspace:*");
    assert.equal(pkg.devDependencies?.["@nitro-forge/ignition"], "workspace:*");
    const runtime = { ...pkg.dependencies, ...pkg.peerDependencies };
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
}

/** Entry reachability for every workspace package under packages/. */
export function checkEntries(packageDirs, options) {
  return packageDirs.map((dir) => checkPackageEntries(dir, options));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkManifests();
  console.log("Ignition and seven headless public engines have no UI/renderer/Moyo production dependencies.");

  const requireBuilt = process.argv.includes("--built");
  const results = checkEntries(listWorkspacePackages(root), { requireBuilt });
  const violations = results.flatMap((r) => r.violations);
  const checked = results.reduce((sum, r) => sum + r.checked, 0);
  const skipped = results.flatMap((r) => r.skipped);
  if (violations.length > 0) {
    console.error(`${violations.length} export entr${violations.length === 1 ? "y reaches" : "ies reach"} Node-only code or a missing file:`);
    for (const v of violations) console.error("  " + formatViolation(v));
    process.exitCode = 1;
  } else {
    console.log(`${checked} react-native/default export entries across ${results.length} packages reach no Node builtin and no ES-module require().`);
  }
  if (skipped.length > 0) console.log(`${skipped.length} built entries not checked because lib/ is not built; run turbo run build, then pass --built.`);
  console.log("This check does not validate generated native code, release tarballs, licenses or npm latest.");
}
