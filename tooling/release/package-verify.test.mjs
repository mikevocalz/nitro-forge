import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  RELEASE_PACKAGES, checkTarMembers, classifyWorkspace, formatSha256Sums, moduleSpecifiers,
  parseSha256Sums, verifyPackedPackage,
} from "./package-verify.mjs";

const SOURCE = {
  name: "@nitro-forge/prism",
  version: "0.1.0",
  license: "MIT",
  type: "module",
  main: "./src/index.ts",
  types: "./src/index.ts",
  exports: { ".": "./src/index.ts", "./color": "./src/color.ts" },
  imports: { "#gen/*": "./generated/*.cjs" },
  files: ["src", "generated", "NOTICES.md"],
  dependencies: { "@nitro-forge/ignition": "workspace:*" },
};
const RELEASE = { "@nitro-forge/ignition": "0.1.0", "@nitro-forge/prism": "0.1.0" };

/** Write a fixture tarball tree; `edit` may mutate the manifest or file map. */
function fixture(t, edit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "nf-verify-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pkg = structuredClone({ ...SOURCE, dependencies: { "@nitro-forge/ignition": "0.1.0" } });
  const files = {
    "src/index.ts": 'import { open } from "@nitro-forge/ignition";\nexport * from "./color.js";\nimport gen from "#gen/Factory";\nexport { open, gen };\n',
    "src/color.ts": '// import "./missing" in a comment is ignored\nimport { readFileSync } from "node:fs";\nexport const color = readFileSync;\n',
    "generated/Factory.cjs": "module.exports = {};\n",
    "NOTICES.md": "notices\n",
    "README.md": "readme\n",
    "LICENSE": "MIT License\n",
  };
  edit(pkg, files);
  files["package.json"] = JSON.stringify(pkg, null, 2);
  for (const [path, text] of Object.entries(files)) {
    if (text === undefined) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const verify = (dir, source = SOURCE) => verifyPackedPackage({ packedDir: dir, source, releaseVersions: RELEASE });

test("a complete tarball tree passes", (t) => {
  assert.deepEqual(verify(fixture(t)), []);
});

test("requires the MIT license field and a LICENSE file in every tarball", (t) => {
  const noField = verify(fixture(t, (pkg) => { delete pkg.license; }));
  assert.ok(noField.some((e) => e.includes('license must be "MIT"')), noField.join("\n"));
  const other = verify(fixture(t, (pkg) => { pkg.license = "UNLICENSED"; }));
  assert.ok(other.some((e) => e.includes('license must be "MIT"')), other.join("\n"));
  const noFile = verify(fixture(t, (_pkg, files) => { files.LICENSE = undefined; }));
  assert.ok(noFile.some((e) => e.includes("no LICENSE file")), noFile.join("\n"));
});

test("rejects a workspace: specifier left in any dependency field", (t) => {
  const dir = fixture(t, (pkg) => {
    pkg.dependencies["@nitro-forge/ignition"] = "workspace:*";
    pkg.devDependencies = { vitest: "workspace:^" };
  });
  const errors = verify(dir);
  assert.ok(errors.some((e) => e.includes("dependencies.@nitro-forge/ignition still uses workspace:*")), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("devDependencies.vitest still uses workspace:^")), errors.join("\n"));
});

test("rejects an internal dependency on a version the release set does not pack", (t) => {
  const errors = verify(fixture(t, (pkg) => { pkg.dependencies["@nitro-forge/ignition"] = "0.0.9"; }));
  assert.deepEqual(errors, ["@nitro-forge/prism: depends on @nitro-forge/ignition@0.0.9, but the release set packs 0.1.0"]);
});

test("rejects an internal dependency outside the release set", (t) => {
  const errors = verify(fixture(t, (pkg) => { pkg.dependencies["@nitro-forge/photo"] = "0.1.0"; }));
  assert.ok(errors.includes("@nitro-forge/prism: depends on @nitro-forge/photo, which is not in the release set"), errors.join("\n"));
});

test("rejects members outside the files allowlist and test or native sources", (t) => {
  const errors = verify(fixture(t, (_pkg, files) => {
    files["scripts/gen.mjs"] = "export {};\n";
    files["src/tests/a.ts"] = "export {};\n";
    files["src/color.test.ts"] = "export {};\n";
  }));
  assert.ok(errors.includes("@nitro-forge/prism: scripts/gen.mjs is outside the \"files\" allowlist"), errors.join("\n"));
  assert.ok(errors.includes("@nitro-forge/prism: test/build/native-source member must not ship: src/tests/a.ts"));
  assert.ok(errors.includes("@nitro-forge/prism: test/build/native-source member must not ship: src/color.test.ts"));
});

test("rejects a files entry that packed nothing", (t) => {
  const errors = verify(fixture(t, (_pkg, files) => { files["NOTICES.md"] = undefined; }));
  assert.deepEqual(errors, ["@nitro-forge/prism: \"files\" entry NOTICES.md matched nothing in the tarball"]);
});

test("requires a files allowlist in the source manifest", (t) => {
  const { files: _drop, ...noFiles } = SOURCE;
  const errors = verify(fixture(t), noFiles);
  assert.deepEqual(errors, ["@nitro-forge/prism: source package.json has no \"files\" allowlist"]);
});

test("rejects missing export targets and missing types", (t) => {
  const errors = verify(fixture(t, (pkg) => {
    delete pkg.types;
    pkg.exports["./gone"] = "./src/gone.ts";
    pkg.exports["./js"] = "./src/plain.js";
  }, ));
  assert.ok(errors.includes("@nitro-forge/prism: no \"types\" field"), errors.join("\n"));
  assert.ok(errors.includes("@nitro-forge/prism: exports[\"./gone\"] target ./src/gone.ts is missing"));
  assert.ok(errors.includes("@nitro-forge/prism: exports[\"./js\"] target ./src/plain.js is missing"));
  assert.ok(errors.includes("@nitro-forge/prism: exports[\"./js\"] has no TypeScript types"));
});

test("accepts a conditional export that names its types", (t) => {
  const dir = fixture(t, (pkg, files) => {
    pkg.exports["./plugin"] = { types: "./src/plugin.d.cts", default: "./src/plugin.cjs" };
    files["src/plugin.cjs"] = "module.exports = () => {};\n";
    files["src/plugin.d.cts"] = "export = function (): void;\n";
  });
  assert.deepEqual(verify(dir), []);
});

test("rejects imports that leave the package, are not packed, or are undeclared", (t) => {
  const errors = verify(fixture(t, (_pkg, files) => {
    files["src/index.ts"] += [
      'import "../../rust/lib";',
      'import { x } from "./absent";',
      'import type { Y } from "react-native";',
      'const z = require("#other/thing");',
      'import gen2 from "#gen/Missing";',
    ].join("\n") + "\n";
  }));
  assert.ok(errors.includes("@nitro-forge/prism: src/index.ts imports ../../rust/lib, outside the package"), errors.join("\n"));
  assert.ok(errors.includes("@nitro-forge/prism: src/index.ts imports ./absent, which is not in the tarball"));
  assert.ok(errors.includes("@nitro-forge/prism: src/index.ts imports react-native, which is not a dependency or peer dependency"));
  assert.ok(errors.includes("@nitro-forge/prism: src/index.ts imports #other/thing, which no \"imports\" entry maps"));
  assert.ok(errors.includes("@nitro-forge/prism: src/index.ts imports #gen/Missing -> ./generated/Missing.cjs, which is not in the tarball"));
  assert.equal(errors.length, 5);
});

test("extracts specifiers from import, export, dynamic import and require; skips comments", () => {
  const specs = moduleSpecifiers([
    "/* import x from 'block-comment' */",
    "// import y from 'line-comment'",
    "import type { A } from './a.js';",
    "import {\n  B,\n} from \"@scope/b/sub\";",
    "export * from './c';",
    "import './side-effect';",
    "const d = await import('d');",
    "const e = require(\"e\");",
  ].join("\n"));
  assert.deepEqual(specs.sort(), ["./a.js", "./c", "./side-effect", "@scope/b/sub", "d", "e"].sort());
});

test("classifies workspace packages and fails closed on unknown public ones", () => {
  const manifests = Object.fromEntries(RELEASE_PACKAGES.map((n) => [n, { name: `@nitro-forge/${n}` }]));
  manifests.photo = { name: "@nitro-forge/photo" };
  manifests.icons = { name: "@nitro-forge/icons", private: true };
  manifests.newthing = { name: "@nitro-forge/newthing" };
  const c = classifyWorkspace(manifests);
  assert.deepEqual(c.release, [...RELEASE_PACKAGES]);
  assert.deepEqual(c.deferred, ["photo"]);
  assert.deepEqual(c.unclassified, ["newthing"]);
  assert.deepEqual(c.missing, []);
  manifests.quill.private = true;
  assert.deepEqual(classifyWorkspace(manifests).missing, ["quill"]);
});

test("SHA256SUMS uses sha256sum text format and round-trips", () => {
  const a = "a".repeat(64), b = "b".repeat(64);
  const text = formatSha256Sums([{ file: "z.tgz", sha256: b }, { file: "a.tgz", sha256: a }]);
  assert.equal(text, `${a}  a.tgz\n${b}  z.tgz\n`);
  assert.deepEqual(parseSha256Sums(text), [{ sha256: a, file: "a.tgz" }, { sha256: b, file: "z.tgz" }]);
  assert.throws(() => formatSha256Sums([{ file: "x.tgz", sha256: "abc" }]), /Bad sha256/);
  assert.throws(() => formatSha256Sums([{ file: "../x.tgz", sha256: a }]), /Bad file name/);
  assert.throws(() => parseSha256Sums("nothex  x.tgz\n"), /Malformed/);
});

test("a real gzip tarball is checked member by member and verified after extraction", (t) => {
  const tree = fixture(t);
  const work = mkdtempSync(join(tmpdir(), "nf-tgz-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  // pnpm pack layout: every member under package/.
  execFileSync("tar", ["-czf", join(work, "p.tgz"), "--transform", "s,^\\.,package,", "-C", tree, "."]);
  const names = execFileSync("tar", ["-tzf", join(work, "p.tgz")], { encoding: "utf8" }).split("\n").filter(Boolean);
  assert.deepEqual(checkTarMembers(names), []);
  mkdirSync(join(work, "x"));
  execFileSync("tar", ["-xzf", join(work, "p.tgz"), "-C", join(work, "x")]);
  assert.deepEqual(verify(join(work, "x", "package")), []);
  assert.deepEqual(checkTarMembers(["package/ok", "../evil", "/abs", "other/file"]),
    ["unsafe tar member: ../evil", "unsafe tar member: /abs", "unsafe tar member: other/file"]);
});
