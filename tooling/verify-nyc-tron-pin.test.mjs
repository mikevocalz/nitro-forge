import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkForgeImports, checkLockfile, checkTronPatch, splitPatchedDependencies, verify } from "./verify-nyc-tron-pin.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pin = JSON.parse(readFileSync(join(root, "tooling/nyc-tron.json"), "utf8"));
const realPatch = readFileSync(join(root, "patches/@nyc-tron__ui@1.0.0-rc.2.patch"), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const url = pin.packages["@nyc-tron/ui"].url;

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "forge-pin-test-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** A lockfile that patches @nyc-tron/ui and resolves it from the pinned URL. */
function lockfile(key, hash, extra = "") {
  return `lockfileVersion: '9.0'

patchedDependencies:
  '@expo/ui@58.0.28': cbc7
  '${key}': ${hash}

importers:
  .:
    dependencies:
      '@nyc-tron/ui':
        specifier: ${url}
        version: ${url}(patch_hash=${hash})
${extra}`;
}

function workspace(dir, patchText, key = "@nyc-tron/ui@1.0.0-rc.2") {
  mkdirSync(join(dir, "patches"), { recursive: true });
  writeFileSync(join(dir, "patches/tron.patch"), patchText);
  return { dir, patches: new Map([[key, "patches/tron.patch"]]) };
}

test("patchedDependencies parsing handles both quote styles and comments, and removes the block", () => {
  const { entries, rest } = splitPatchedDependencies(`packages:\n  - "."\npatchedDependencies:\n  "@expo/ui@58.0.28": patches/a.patch\n  # a comment\n  '@nyc-tron/ui@1.0.0-rc.2': ../../patches/b.patch\nminimumReleaseAge: 0\n`);
  assert.deepEqual([...entries], [["@expo/ui@58.0.28", "patches/a.patch"], ["@nyc-tron/ui@1.0.0-rc.2", "../../patches/b.patch"]]);
  assert.ok(!rest.includes("@nyc-tron/ui@1.0.0-rc.2"));
  assert.ok(rest.includes("minimumReleaseAge: 0"));
});

test("a patch entry for the pinned version with a matching file and hash is accepted", () => withDir((dir) => {
  const ws = workspace(dir, realPatch);
  assert.deepEqual(checkLockfile("pnpm-lock.yaml", lockfile("@nyc-tron/ui@1.0.0-rc.2", sha(realPatch)), pin, ws), []);
}));

test("a patch entry is rejected for another version, a missing file, an unnamed patch or a stale hash", () => withDir((dir) => {
  const ws = workspace(dir, realPatch);
  const hash = sha(realPatch);
  assert.match(checkLockfile("l", lockfile("@nyc-tron/ui@1.0.0-rc.1", hash), pin, ws).join("\n"), /pinned version is 1\.0\.0-rc\.2/);
  assert.match(checkLockfile("l", lockfile("@nyc-tron/ui@1.0.0-rc.2", hash), pin, { dir, patches: new Map() }).join("\n"), /names no patch file/);
  assert.match(checkLockfile("l", lockfile("@nyc-tron/ui@1.0.0-rc.2", hash), pin, { dir, patches: new Map([["@nyc-tron/ui@1.0.0-rc.2", "patches/gone.patch"]]) }).join("\n"), /does not exist/);
  assert.match(checkLockfile("l", lockfile("@nyc-tron/ui@1.0.0-rc.2", "0".repeat(64)), pin, ws).join("\n"), /hashes to/);
  assert.match(checkLockfile("l", lockfile("@nyc-tron/ui@1.0.0-rc.2", hash), pin, workspace(dir, realPatch, "@nyc-tron/ui@1.0.0-rc.1")).join("\n"), /names no patch file|not the pinned version/);
}));

test("registry resolutions and unpinned tarballs still fail next to an accepted patch", () => withDir((dir) => {
  const ws = workspace(dir, realPatch);
  const hash = sha(realPatch);
  const registry = checkLockfile("l", lockfile("@nyc-tron/ui@1.0.0-rc.2", hash, "\npackages:\n\n  '@nyc-tron/ui@1.0.0-rc.2':\n    resolution: {integrity: sha512-x}\n"), pin, ws);
  assert.equal(registry.length, 1);
  assert.match(registry[0], /resolves @nyc-tron\/ui@1\.0\.0-rc\.2 from a registry/);
  const other = url.replace("v1.0.0-rc.2", "v1.0.0-rc.1").replace("1.0.0-rc.2.tgz", "1.0.0-rc.1.tgz");
  const snapshot = `\npackages:\n\n  '@nyc-tron/ui@${url}':\n    resolution: {tarball: ${url}}\n`;
  assert.deepEqual(checkLockfile("l", lockfile("@nyc-tron/ui@1.0.0-rc.2", hash, snapshot), pin, ws), []);
  assert.match(checkLockfile("l", lockfile("@nyc-tron/ui@1.0.0-rc.2", hash, snapshot.replaceAll(url, other)), pin, ws).join("\n"), /not the pinned URL/);
}));

test("the committed rc.2 patch only adds export entries that the installed release ships", () => {
  assert.deepEqual(checkTronPatch(realPatch, "patch", join(root, "packages/editor-controls/node_modules/@nyc-tron/ui")), []);
});

test("a patch that removes a line, touches another file, adds code or points outside dist fails", () => {
  const removes = realPatch.replace('     }\n   },\n   "peerDependencies"', '-    }\n   },\n   "peerDependencies"');
  assert.match(checkTronPatch(removes, "p").join("\n"), /removes or changes a line/);
  const code = `${realPatch}diff --git a/dist/components/Button.js b/dist/components/Button.js\n--- a/dist/components/Button.js\n+++ b/dist/components/Button.js\n@@ -1 +1,2 @@\n export {};\n+globalThis.x = 1;\n`;
  const codeProblems = checkTronPatch(code, "p").join("\n");
  assert.match(codeProblems, /must change only package\.json/);
  assert.match(codeProblems, /not whole export-map entries/);
  const outside = realPatch.replace('"default": "./dist/components/styles.js"', '"default": "./src/components/styles.ts"');
  assert.match(checkTronPatch(outside, "p").join("\n"), /expected \.\/dist\/components\/styles\.js/);
  // A new key aliased onto one of rc.2's old control copies would bring a stale duplicate back.
  const aliased = realPatch.replace('"default": "./dist/components/styles.js"', '"default": "./dist/components/' + 'forge/audio/LevelFader.js"');
  assert.match(checkTronPatch(aliased, "p").join("\n"), /expected \.\/dist\/components\/styles\.js/);
  const unknownKey = realPatch.replaceAll('"./components/styles"', '"./components/' + 'forge/styles"');
  assert.match(checkTronPatch(unknownKey, "p").join("\n"), /not one of the rc\.2 bridge subpaths/);
  const field = realPatch.replace('+    "./components/styles": {', '+    "main": "./dist/evil.js",\n+    "./components/styles": {');
  assert.match(checkTronPatch(field, "p").join("\n"), /not an export-map entry/);
});

test("with an installed package, a target the release does not ship fails", () => withDir((dir) => {
  const patch = realPatch.replaceAll("./dist/components/styles.", "./dist/components/not-shipped.");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ exports: { "./components/styles": {
    types: "./dist/components/not-shipped.d.ts", "react-native": "./dist/components/not-shipped.js", default: "./dist/components/not-shipped.js" } } }));
  const problems = checkTronPatch(patch, "p", dir).join("\n");
  assert.match(problems, /not-shipped\.js, which the pinned release does not ship/);
  assert.match(problems, /"\.\/components\/feedback\/announce" is not in the installed package's export map/);
}));

test("old editor-control imports are reported by file and line; the new paths pass", () => withDir((dir) => {
  const old = "@nyc-tron/ui/components/" + "forge/audio/LevelFader";
  writeFileSync(join(dir, "a.tsx"), `import { X } from "@nitro-forge/editor-controls/audio/LevelFader";\nimport { Y } from "${old}";\n`);
  writeFileSync(join(dir, "b.ts"), `export const entries = ['${old}'];\nimport("@nyc-tron/ui/components/shell/PrecisionScrubber");\n`);
  const problems = checkForgeImports(dir, [join(dir, "a.tsx"), join(dir, "b.ts")]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^a\.tsx:2 /);
  assert.match(problems[1], /^b\.ts:1 /);
}));

test("the repository passes every check", () => {
  assert.deepEqual(verify(root, pin).problems, []);
});
