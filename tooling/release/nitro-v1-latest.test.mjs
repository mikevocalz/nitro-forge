import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCoherentNitroV1, newestV1Release,
} from "./nitro-v1-latest.mjs";

const v115 = "1.0.0-alpha.nightly.115.gcdaf72e60229";
const v120 = "1.0.0-alpha.nightly.120.g33ef045b96c0";
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
