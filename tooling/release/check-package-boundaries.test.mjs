import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  checkPackageEntries, listWorkspacePackages, resolveConditional, scanModule, SOURCE_CONDITION,
} from "./entry-reachability.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Write a throwaway package: { "package.json": {...}, "src/a.ts": "..." }. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "nf-boundaries-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

const withFixture = (files, run) => {
  const dir = fixture(files);
  try { return run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const entry = (src, lib) => ({ [SOURCE_CONDITION]: src, types: lib.replace(/\.js$/, ".d.ts"), "react-native": lib, import: lib, default: lib });
const kinds = (result) => result.violations.map((v) => `${v.entry} ${v.kind} ${v.file}`).sort();

test("a clean entry passes through relative .ts imports", () => withFixture({
  "package.json": { name: "clean", type: "module", exports: { ".": entry("./src/index.ts", "./lib/index.js") } },
  "src/index.ts": 'export * from "./a.ts";\nimport type { Stat } from "node:fs";\n',
  "src/a.ts": 'export const a = 1; // require("node:fs") in a comment\nexport const s = "import x from \\"node:fs\\"";\n',
}, (dir) => {
  const result = checkPackageEntries(dir);
  assert.deepEqual(result.violations, []);
  assert.equal(result.checked, 2); // react-native and default, source only
  assert.equal(result.skipped.length, 2); // lib/ not built
}));

test("fails when a react-native entry reaches a node: import, and names the chain", () => withFixture({
  "package.json": { name: "leaky", type: "module", exports: { ".": entry("./src/index.ts", "./lib/index.js") } },
  "src/index.ts": 'export { run } from "./run";\n',
  "src/run.ts": 'import { spawn } from "node:child_process";\nexport const run = () => spawn("x");\n',
}, (dir) => {
  const result = checkPackageEntries(dir);
  assert.deepEqual(kinds(result), [
    "leaky [default, source] node-builtin src/run.ts",
    "leaky [react-native, source] node-builtin src/run.ts",
  ]);
  assert.deepEqual(result.violations[0].chain, ["src/index.ts", "src/run.ts"]);
}));

test("fails on a bare builtin and on require() in an ES module", () => withFixture({
  // The shape of the old Ignition host: a typed require() of a #imports target.
  "package.json": { name: "cjs-in-esm", type: "module", exports: { ".": "./src/index.ts" }, imports: { "#native": "./src/native.cjs" } },
  "src/index.ts": 'import fs from "fs";\nexport function load() { return (require("#native") as { F: 1 }).F; }\n',
  "src/native.cjs": "module.exports = { F: 1 };\n",
}, (dir) => {
  assert.deepEqual(kinds(checkPackageEntries(dir)), [
    "cjs-in-esm [default] node-builtin src/index.ts",
    "cjs-in-esm [default] require src/index.ts",
    "cjs-in-esm [react-native] node-builtin src/index.ts",
    "cjs-in-esm [react-native] require src/index.ts",
  ]);
}));

test("a Node-only subpath behind the node condition is not checked", () => withFixture({
  "package.json": { name: "split", type: "module", exports: {
    ".": entry("./src/index.ts", "./lib/index.js"),
    "./cli": { [SOURCE_CONDITION]: { node: "./src/cli.ts", types: "./src/cli.ts" }, types: "./lib/cli.d.ts", node: "./lib/cli.js" },
  } },
  "src/index.ts": "export const x = 1;\n",
  "src/cli.ts": 'import { spawn } from "node:child_process";\nexport { spawn };\n',
}, (dir) => {
  const result = checkPackageEntries(dir);
  assert.deepEqual(result.violations, []);
  assert.equal(result.checked, 2);
}));

test("follows #imports per consumer; CommonJS may require but not reach builtins", () => withFixture({
  "package.json": {
    name: "nitro-like", type: "module",
    exports: { ".": { [SOURCE_CONDITION]: { "react-native": "./src/index.native.ts", default: "./src/index.ts" } } },
    imports: { "#gen/*": "./gen/*.cjs" },
  },
  "src/index.ts": "export const native = false;\n",
  "src/index.native.ts": 'import gen from "#gen/Factory";\nexport const native = gen;\n',
  "gen/Factory.cjs": 'const { Modules } = require("react-native-nitro-modules");\nconst os = require("node:os");\nmodule.exports = { Modules, os };\n',
}, (dir) => {
  assert.deepEqual(kinds(checkPackageEntries(dir)), ["nitro-like [react-native, source] node-builtin gen/Factory.cjs"]);
}));

test("--built: built lib entries are checked, and missing ones fail only when required", () => withFixture({
  "package.json": { name: "built", type: "module", exports: { ".": entry("./src/index.ts", "./lib/index.js") } },
  "src/index.ts": "export const x = 1;\n",
}, (dir) => {
  assert.deepEqual(checkPackageEntries(dir).violations, []);
  assert.equal(checkPackageEntries(dir, { requireBuilt: true }).violations.filter((v) => v.kind === "missing").length, 2);
  mkdirSync(join(dir, "lib"));
  writeFileSync(join(dir, "lib/index.js"), 'export const x = require("./x.cjs");\n');
  writeFileSync(join(dir, "lib/x.cjs"), "module.exports = 1;\n");
  assert.deepEqual(kinds(checkPackageEntries(dir)), ["built [default] require lib/index.js", "built [react-native] require lib/index.js"]);
}));

test("resolves conditions in key order, with nested fallthrough", () => {
  const target = { [SOURCE_CONDITION]: { node: "src-node" }, types: "d.ts", "react-native": "rn", default: "js" };
  assert.equal(resolveConditional(target, [SOURCE_CONDITION, "react-native", "default"]), "rn");
  assert.equal(resolveConditional(target, [SOURCE_CONDITION, "node", "default"]), "src-node");
  assert.equal(typeof resolveConditional({ types: "d.ts", node: "n" }, ["react-native", "import", "default"]), "symbol");
});

test("scanModule ignores look-alikes in strings, templates, regexes and comments", () => {
  const code = [
    "const re = /require\\(\"x\"\\)/;",
    "const t = `import a from \"node:fs\" ${ { b: 1 }.b }`;",
    "/* import c from 'node:path' */",
    "obj.require('fs');",
    "export { d } from './d.ts';",
    "const e = await import('./e.ts');",
  ].join("\n");
  const { specifiers, requireUses } = scanModule(code);
  assert.deepEqual(specifiers.map((s) => s.spec), ["./d.ts", "./e.ts"]);
  assert.equal(requireUses, 0);
});

test("every workspace package passes the entry check from source", () => {
  const results = listWorkspacePackages(root).map((dir) => checkPackageEntries(dir));
  assert.deepEqual(results.flatMap((r) => r.violations), []);
  assert.ok(results.reduce((sum, r) => sum + r.checked, 0) > 0);
});

test("the CLI passes on this repo", () => {
  const ok = spawnSync(process.execPath, [join(root, "tooling/release/check-package-boundaries.mjs")], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /reach no Node builtin and no ES-module require\(\)/);
});
