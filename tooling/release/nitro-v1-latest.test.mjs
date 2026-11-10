import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCoherentNitroV1, assertSourceCompatibilityEvidence, newestV1Release,
} from "./nitro-v1-latest.mjs";

const v115 = "1.0.0-alpha.nightly.115.gcdaf72e60229";
const v120 = "1.0.0-alpha.nightly.120.g33ef045b96c0";
const v105 = "1.0.0-alpha.nightly.105.g69d365fc9b18";
const qtProfile = {
  name: "rnqnx-qt-alpha105",
  manifest: "packages/ignition/package.json",
  packageName: "@nitro-forge/ignition",
  version: v105,
  platforms: ["qnx", "marathon"],
  peerDependencies: ["nitro-core", "react-native-nitro-modules"],
};
function qtPackage() {
  return { path: qtProfile.manifest, pkg: {
    name: qtProfile.packageName,
    devDependencies: { nitrogen: v120, "nitro-core": v120, "react-native-nitro-modules": v120 },
    peerDependencies: { "nitro-core": v105 + " || " + v120,
      "react-native-nitro-modules": v105 + " || " + v120 },
    peerDependenciesMeta: { "react-native-nitro-modules": { optional: true } },
    rnqnxNative: { schemaVersion: 1, platforms: {
      qnx: { nitroCoreVersions: [v105], requiresDispatcher: true },
      marathon: { nitroCoreVersions: [v105], requiresDispatcher: true },
    } },
  } };
}
test("rejects mismatched Nitro v1 generator/core/native runtime versions", () => {
  const good = [{ path:"packages/native/package.json",pkg:{
    devDependencies:{"nitrogen":v120,"nitro-core":v120},
    peerDependencies:{"react-native-nitro-modules":v120},
  }}];
  assert.doesNotThrow(()=>assertCoherentNitroV1(good,v120));
  const bad = structuredClone(good);
  bad[0].pkg.devDependencies.nitrogen = v115;
  assert.throws(()=>assertCoherentNitroV1(bad,v120),/must match/);
});

test("stable Nitro 0.x in isolated legacy package isn't confused with v1", () => {
  const packages = [
    {path:"packages/legacy/package.json",pkg:{dependencies:{"react-native-nitro-modules":"^0.29.8"}}},
    {path:"packages/modern/package.json",pkg:{devDependencies:{"nitro-core":v120}}},
  ];
  assert.doesNotThrow(()=>assertCoherentNitroV1(packages,v120));
});
test("rejects moving version ranges and unpinned baselines", () => {
  assert.throws(()=>assertCoherentNitroV1([], "^"+v120),/Pin an exact/);
  assert.throws(()=>assertCoherentNitroV1([], "latest"),/Pin an exact/);
});

test("identifies latest published v1 alpha independent of stable 0.x releases", () => {
  const released=[
    {tag_name:"v0.37.1",draft:false,published_at:"2026-11-02T21:00:00Z"},
    {tag_name:"v1.0.0-alpha.nightly.115.gcdaf72e60229",draft:false,published_at:"2026-11-01T10:00:00Z"},
    {tag_name:"v1.0.0-alpha.nightly.120.g33ef045b96c0",draft:false,published_at:"2026-11-02T18:00:00Z"},
    {tag_name:"v1.0.0-alpha.nightly.121.gffffffffffff",draft:true,published_at:"2026-11-02T22:00:00Z"},
  ];
  assert.equal(newestV1Release(released),v120);
  assert.throws(()=>newestV1Release([]),/No published/);
});

test("rejects range specifiers that would float to another v1 nightly", () => {
  for (const spec of ["^"+v120, "~"+v120, ">="+v120, "npm:react-native-nitro-modules@^"+v120]) {
    const pkgs=[{path:"packages/native/package.json",pkg:{dependencies:{"react-native-nitro-modules":spec}}}];
    assert.throws(()=>assertCoherentNitroV1(pkgs,v120),/must match/, spec);
  }
});

test("accepts only explicitly reviewed source peers, not another package or dependency section", () => {
  const approved = qtPackage();
  assert.throws(() => assertCoherentNitroV1([approved], v120), /must match/);
  assert.doesNotThrow(() => assertCoherentNitroV1([approved], v120, [qtProfile]));
  const other = qtPackage();
  other.path = "packages/other/package.json";
  assert.throws(() => assertCoherentNitroV1([approved, other], v120, [qtProfile]), /must match/);
  other.path = qtProfile.manifest;
  other.pkg.name = "@nitro-forge/other";
  assert.throws(() => assertCoherentNitroV1([other], v120, [qtProfile]), /identity/);
  const runtime = qtPackage();
  runtime.pkg.dependencies = { "nitro-core": v105 + " || " + v120 };
  assert.throws(() => assertCoherentNitroV1([runtime], v120, [qtProfile]), /must match/);
});

test("source profiles reject floating peers, extra versions and mobile generator/runtime drift", () => {
  for (const name of qtProfile.peerDependencies) {
    for (const spec of ["^" + v105 + " || " + v120, v105 + " || ~" + v120,
      v105 + " || " + v120 + " || " + v115, ">=" + v105, "*", v105, v120]) {
      const changed = qtPackage();
      changed.pkg.peerDependencies[name] = spec;
      assert.throws(() => assertCoherentNitroV1([changed], v120, [qtProfile]), /exact reviewed/, spec);
    }
  }
  for (const name of ["nitrogen", "nitro-core", "react-native-nitro-modules"]) {
    const changed = qtPackage();
    changed.pkg.devDependencies[name] = v105;
    assert.throws(() => assertCoherentNitroV1([changed], v120, [qtProfile]), /mobile runtime and generator/);
  }
  assert.throws(() => assertCoherentNitroV1([qtPackage()], v120,
    [{ ...qtProfile, version: "^" + v105 }]), /exact published nightly/);
});

test("source profiles require matching metadata and a real dispatcher on each selected platform", () => {
  for (const platform of qtProfile.platforms) {
    for (const change of [
      native => { native.nitroCoreVersions = [v120]; },
      native => { native.nitroCoreVersions = [v105, v120]; },
      native => { native.requiresDispatcher = false; },
      native => { delete native.requiresDispatcher; },
    ]) {
      const changed = qtPackage();
      change(changed.pkg.rnqnxNative.platforms[platform]);
      assert.throws(() => assertCoherentNitroV1([changed], v120, [qtProfile]), /Source compatibility/);
    }
    const missing = qtPackage();
    delete missing.pkg.rnqnxNative.platforms[platform];
    assert.throws(() => assertCoherentNitroV1([missing], v120, [qtProfile]), /Source compatibility/);
  }
  const requiredMobile = qtPackage();
  requiredMobile.pkg.peerDependenciesMeta["react-native-nitro-modules"].optional = false;
  assert.throws(() => assertCoherentNitroV1([requiredMobile], v120, [qtProfile]), /mobile installer/);
});

test("source profile evidence binds the exact manifest, source core and mobile generator", () => {
  const hash = "a".repeat(64);
  const evidence = {
    profiles: { qtNitroCore: v105, qtSourceCompatibility: qtProfile.name, mobileGenerator: v120 },
    package: { name: qtProfile.packageName, manifestSha256: hash },
  };
  assert.doesNotThrow(() => assertSourceCompatibilityEvidence(qtProfile, v120, hash, evidence));
  for (const change of [
    value => { value.profiles.qtNitroCore = v115; },
    value => { value.profiles.qtSourceCompatibility = "unreviewed"; },
    value => { value.profiles.mobileGenerator = v115; },
    value => { value.package.name = "other"; },
    value => { value.package.manifestSha256 = "b".repeat(64); },
  ]) {
    const changed = structuredClone(evidence);
    change(changed);
    assert.throws(() => assertSourceCompatibilityEvidence(qtProfile, v120, hash, changed), /Source compatibility/);
  }
});
