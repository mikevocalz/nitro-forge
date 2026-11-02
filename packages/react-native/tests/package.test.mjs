import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pkgRoot = join(root, "packages/react-native");
const get = (path) => JSON.parse(readFileSync(path, "utf8"));
const pkg = get(join(pkgRoot, "package.json"));
const cfg = get(join(pkgRoot, "nitro.json"));
const v1 = "1.0.0-alpha.nightly.115.gcdaf72e60229";

test("new package has a single independent identity and no duplicate lab", () => {
  assert.equal(pkg.name, "@nitro-forge/react-native");
  assert.equal(pkg.private, true, "Cannot publish before real Apple/Android native linking");
  assert.equal(existsSync(join(root, "packages/ignition-v1-lab")), false,
    "Old experiment must not duplicate the native implementation");
  assert.equal(existsSync(join(pkgRoot, "README.md")), true);
  assert.ok(pkg.files.includes("cpp"));
  assert.ok(pkg.files.includes("nitrogen/generated"));
  assert.ok(pkg.files.includes("nitro.json"));
});

test("Nitro v1 generator and peer runtime versions match exactly", () => {
  assert.equal(pkg.devDependencies.nitrogen, v1);
  assert.equal(pkg.devDependencies["nitro-core"], v1);
  assert.equal(pkg.peerDependencies["react-native-nitro-modules"], v1);
  assert.equal(pkg.peerDependencies["nitro-core"], v1);
  assert.equal(pkg.peerDependencies["react-native"], ">=0.88.0");
  assert.equal(pkg.imports["#nitro/*"], "./nitrogen/generated/shared/javascript/*.cjs");
});

test("direct generated class public API stays app-neutral", () => {
  const source = readFileSync(join(pkgRoot, "src/index.ts"), "utf8");
  assert.match(source, /export \{ ForgeFactory \}/);
  assert.match(source, /export \{ ForgeDocument \}/);
  assert.doesNotMatch(source, /@acme\/|@moyo\/|better-auth|expo-router|nativewind/i);
  const kind = readFileSync(join(pkgRoot, "src/contracts.ts"), "utf8");
  for (const engine of ["prism", "cadence", "splice", "folio", "pitch", "tally", "quill"]) {
    assert.ok(kind.includes('"' + engine + '"'), "Missing engine " + engine);
  }
});

test("platform-neutral engines remain headless", () => {
  for (const engine of ["prism", "cadence", "splice", "folio", "pitch", "tally", "quill"]) {
    const manifest = get(join(root, "packages", engine, "package.json"));
    assert.equal(manifest.name, "@nitro-forge/" + engine);
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      assert.ok(!["react-native", "expo", "@expo/ui", "react-native-skia"].includes(name),
        "Headless engine unexpectedly linked native UI: " + engine + " → " + name);
    }
  }
});

test("native class source, Rust C ABI and generator config remain consistent", () => {
  for (const file of ["ForgeRustSession.hpp","ForgeRustSession.cpp",
    "HybridForgeFactory.hpp","HybridForgeFactory.cpp",
    "HybridForgeDocument.hpp","HybridForgeDocument.cpp"]) {
    assert.ok(existsSync(join(pkgRoot, "cpp", file)), "Missing native file " + file);
  }
  assert.equal(cfg.environment, "react-native");
  assert.equal(cfg.apple.moduleName, "NitroForgeV1");
  assert.equal(cfg.android.cxxLibName, "NitroForgeV1");
  assert.ok(existsSync(join(root, "rust/nf-sys/include/nf_v1.h")));
  assert.ok(!Object.hasOwn(cfg, "autolinking"), "Legacy Nitro v0 config is not supported");
  const example = get(join(root, "apps/example/package.json"));
  assert.ok(!Object.hasOwn(example.dependencies ?? {}, "@nitro-forge/react-native"),
    "Never link v0 and v1 native runtimes in the same example app");
});
