import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSpec, compareTriplet, collectExternal, summarizeDependency } from "./audit.mjs";

test("handles pinned exact and semver ranges without guessing exotic specs", () => {
  assert.deepEqual(normalizeSpec("~58.0.26"), { major: 58, minor: 0, patch: 26, raw: "~58.0.26" });
  assert.deepEqual(normalizeSpec("^0.19.2"), { major: 0, minor: 19, patch: 2, raw: "^0.19.2" });
  assert.equal(normalizeSpec("workspace:*"), null);
  assert.equal(normalizeSpec("file:foo"), null);
});

test("separates a newer npm tag from compatible deployment approval", () => {
  assert.equal(summarizeDependency("expo", "~58.0.19", "58.0.20").status, "review-newer");
  assert.equal(summarizeDependency("react-native-skia", "3.8.1", "3.8.1").status, "up-to-date");
  assert.equal(summarizeDependency("react-native-skia", "3.9.0", "3.8.1").status, "pinned-ahead-of-latest");
});

test("detects version order numerically", () => {
  assert.equal(compareTriplet(normalizeSpec("1.10.0"), normalizeSpec("1.9.99")), 1);
});

test("excludes workspace packages but includes external platform dependencies", () => {
  const map = collectExternal([{
    path: "apps/example/package.json",
    pkg: { dependencies: {
      "@nitro-forge/ignition": "workspace:*",
      "react-native-skia": "3.8.1",
      "expo": "~58.0.19",
    } },
  }]);
  assert.equal(map.has("@nitro-forge/ignition"), false);
  assert.equal(map.has("react-native-skia"), true);
  assert.equal(map.get("expo")[0].spec, "~58.0.19");
});
