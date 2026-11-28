/**
 * node --test tooling/release/tarball-deps.test.mjs
 *
 * Unit tests for the manifest rewrite, the packed-manifest check and the tar
 * edit, then an end-to-end run: build and pack Ignition, Prism and Cadence
 * into a temp dir, install the three tarballs by local file path into an empty
 * project outside the checkout, and import every Node-resolvable export.
 * GitHub release URLs are only compared as strings; nothing here fetches them.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { packWithTarballDeps, readWorkspaceManifests } from "./pack-tarballs.mjs";
import {
  RELEASE_PACKAGES, checkPackedManifest, readTarEntry, releaseTarballUrl, replaceTarEntry, rewriteForgeDependencies,
  tarMembers, tarballFileName, workspaceIndex,
} from "./tarball-deps.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const IGNITION_URL = "https://github.com/mikevocalz/nitro-forge/releases/download/v0.1.0/nitro-forge-ignition-0.1.0.tgz";
const workspace = workspaceIndex([
  { name: "@nitro-forge/ignition", version: "0.1.0" },
  { name: "@nitro-forge/prism", version: "0.1.0" },
  { name: "@nitro-forge/editor-controls", version: "0.1.0", private: true },
]);

describe("release tarball URLs", () => {
  test("match the NYC-Tron release asset shape and pnpm's file name", () => {
    assert.equal(tarballFileName("@nitro-forge/ignition", "0.1.0"), "nitro-forge-ignition-0.1.0.tgz");
    assert.equal(releaseTarballUrl("@nitro-forge/ignition", "0.1.0"), IGNITION_URL);
    assert.equal(releaseTarballUrl("@nitro-forge/quill", "1.0.0-rc.1"),
      "https://github.com/mikevocalz/nitro-forge/releases/download/v1.0.0-rc.1/nitro-forge-quill-1.0.0-rc.1.tgz");
  });

  test("refuse names outside the scope and versions that are ranges", () => {
    assert.throws(() => tarballFileName("@nyc-tron/ui", "0.1.0"), /Not a @nitro-forge package/);
    assert.throws(() => tarballFileName("@nitro-forge/prism", "^0.1.0"), /Not a release version/);
    assert.throws(() => tarballFileName("@nitro-forge/prism", "workspace:*"), /Not a release version/);
  });
});

describe("rewriteForgeDependencies", () => {
  const source = {
    name: "@nitro-forge/prism",
    version: "0.1.0",
    dependencies: { "left-pad": "1.3.0" },
    peerDependencies: { "@nitro-forge/ignition": "workspace:*", react: "^19.0.0" },
    optionalDependencies: { "@nitro-forge/ignition": "workspace:^" },
    devDependencies: { "@nitro-forge/ignition": "workspace:*", "@nitro-forge/editor-controls": "workspace:*", typescript: "7.0.2" },
  };
  // What pnpm pack writes for that source.
  const packed = {
    ...source,
    peerDependencies: { "@nitro-forge/ignition": "0.1.0", react: "^19.0.0" },
    optionalDependencies: { "@nitro-forge/ignition": "^0.1.0" },
    devDependencies: { "@nitro-forge/ignition": "0.1.0", "@nitro-forge/editor-controls": "0.1.0", typescript: "7.0.2" },
  };

  test("points workspace @nitro-forge specs at release URLs and drops Forge devDependencies", () => {
    const { manifest, errors } = rewriteForgeDependencies(packed, { source, workspace });
    assert.deepEqual(errors, []);
    assert.deepEqual(manifest.peerDependencies, { "@nitro-forge/ignition": IGNITION_URL, react: "^19.0.0" });
    assert.deepEqual(manifest.optionalDependencies, { "@nitro-forge/ignition": IGNITION_URL });
    assert.deepEqual(manifest.dependencies, { "left-pad": "1.3.0" });
    assert.deepEqual(manifest.devDependencies, { typescript: "7.0.2" });
    assert.deepEqual(checkPackedManifest(manifest, { workspace }), []);
    assert.equal(packed.peerDependencies["@nitro-forge/ignition"], "0.1.0", "input manifest is not mutated");
  });

  test("removes devDependencies entirely when only Forge entries were there", () => {
    const src = { name: "@nitro-forge/x", version: "0.1.0", devDependencies: { "@nitro-forge/ignition": "workspace:*" } };
    const { manifest } = rewriteForgeDependencies({ ...src, devDependencies: { "@nitro-forge/ignition": "0.1.0" } }, { source: src, workspace });
    assert.equal(Object.hasOwn(manifest, "devDependencies"), false);
  });

  test("fails on a runtime dependency that has no release tarball", () => {
    const src = { name: "@nitro-forge/x", version: "0.1.0", dependencies: { "@nitro-forge/editor-controls": "workspace:*", "@nitro-forge/gone": "workspace:*" } };
    const { errors } = rewriteForgeDependencies(src, { source: src, workspace });
    assert.equal(errors.length, 2);
    assert.match(errors[0], /editor-controls is private and has no release tarball/);
    assert.match(errors[1], /gone is not a workspace package/);
  });
});

describe("checkPackedManifest", () => {
  const base = { name: "@nitro-forge/prism", version: "0.1.0" };
  const cases = [
    ["a bare registry version", { peerDependencies: { "@nitro-forge/ignition": "0.1.0" } }, /expected the release tarball/],
    ["a registry range", { dependencies: { "@nitro-forge/ignition": "^0.1.0" } }, /expected the release tarball/],
    ["another version's URL", { dependencies: { "@nitro-forge/ignition": IGNITION_URL.replaceAll("0.1.0", "0.0.9") } }, /expected the release tarball/],
    ["another repo's URL", { dependencies: { "@nitro-forge/ignition": IGNITION_URL.replace("mikevocalz", "someone") } }, /expected the release tarball/],
    ["a workspace protocol", { optionalDependencies: { "@nitro-forge/ignition": "workspace:*" } }, /still uses workspace:\*/],
    ["a workspace protocol outside the scope", { dependencies: { other: "workspace:*" } }, /still uses workspace:\*/],
    ["a link protocol", { dependencies: { other: "link:../other" } }, /still uses link:/],
    ["a local file path", { peerDependencies: { other: "file:../other.tgz" } }, /is a local path/],
    ["a Forge devDependency", { devDependencies: { "@nitro-forge/editor-controls": "0.1.0" } }, /must not ship/],
    ["a private Forge package", { dependencies: { "@nitro-forge/editor-controls": "0.1.0" } }, /is private/],
    ["a bundled Forge package", { bundleDependencies: ["@nitro-forge/ignition"] }, /bundles @nitro-forge\/ignition/],
  ];
  for (const [what, fields, pattern] of cases) {
    test(`fails on ${what}`, () => {
      const errors = checkPackedManifest({ ...base, ...fields }, { workspace });
      assert.equal(errors.length >= 1, true, JSON.stringify(errors));
      assert.match(errors.join("\n"), pattern);
    });
  }

  test("passes third-party URLs and ranges", () => {
    const manifest = { ...base, peerDependencies: { "@nitro-forge/ignition": IGNITION_URL, react: "^19.0.0" },
      devDependencies: { "@nyc-tron/ui": "https://github.com/mikevocalz/NYC-Tron-UI/releases/download/v1.0.0-rc.2/nyc-tron-ui-1.0.0-rc.2.tgz" } };
    assert.deepEqual(checkPackedManifest(manifest, { workspace }), []);
  });
});

/** A minimal ustar archive, built by hand so the tar tests need no tools. */
function ustar(entries) {
  const blocks = [];
  for (const [name, content] of entries) {
    const body = Buffer.from(content);
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, "utf8");
    h.write("0000644\0", 100, 8, "ascii");
    h.write("0000000\0", 108, 8, "ascii");
    h.write("0000000\0", 116, 8, "ascii");
    h.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
    h.write("00000000000\0", 136, 12, "ascii");
    h.write("0", 156, 1, "ascii");
    h.write("ustar\0" + "00", 257, 8, "ascii");
    h.fill(0x20, 148, 156);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe("replaceTarEntry", () => {
  const big = "x".repeat(700);
  const tgz = ustar([["package/a.txt", "alpha"], ["package/package.json", "{}"], ["package/b.txt", big]]);

  test("replaces one member and keeps the others byte for byte", () => {
    const next = replaceTarEntry(tgz, "package/package.json", '{"name":"grown"}'.padEnd(600, " "));
    assert.equal(readTarEntry(next, "package/package.json").toString().trim(), '{"name":"grown"}');
    assert.equal(readTarEntry(next, "package/a.txt").toString(), "alpha");
    assert.equal(readTarEntry(next, "package/b.txt").toString(), big);
    assert.deepEqual(tarMembers(gunzipSync(next)).map((m) => m.name), ["package/a.txt", "package/package.json", "package/b.txt"]);
  });

  test("is deterministic", () => {
    assert.deepEqual(replaceTarEntry(tgz, "package/package.json", "{}\n"), replaceTarEntry(tgz, "package/package.json", "{}\n"));
  });

  test("refuses a missing or duplicated member", () => {
    assert.throws(() => replaceTarEntry(tgz, "package/missing.json", "{}"), /not in the tarball/);
    const dup = ustar([["package/package.json", "{}"], ["package/package.json", "{}"]]);
    assert.throws(() => replaceTarEntry(dup, "package/package.json", "{}"), /appears twice/);
    assert.throws(() => readTarEntry(dup, "package/package.json"), /Expected one/);
  });
});


/** Every package.json named @nitro-forge/ignition under a node_modules tree, as real paths. */
function ignitionCopies(dir, found = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // pnpm links point into .pnpm, which the walk reaches directly
    const manifest = join(path, "package.json");
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, "utf8")).name === "@nitro-forge/ignition") found.add(realpathSync(path));
      } catch { /* not a package */ }
    }
    ignitionCopies(path, found);
  }
  return found;
}

/** Export subpaths that Node's ESM loader can resolve: a node/import/default condition, ignoring the source condition. */
function nodeSubpaths(exportsField) {
  const reachable = (value) => {
    if (typeof value === "string") return true;
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([k, v]) =>
      k !== "@nitro-forge/source" && ["node", "import", "default"].includes(k) && reachable(v));
  };
  return Object.entries(exportsField ?? {}).filter(([, v]) => reachable(v)).map(([k]) => k);
}

describe("packed tarballs in a clean consumer", { timeout: 300_000 }, () => {
  const dirs = ["ignition", "prism", "cadence"];
  let scratch;
  let out;
  let consumer;
  const packed = {};

  before(() => {
    scratch = mkdtempSync(join(tmpdir(), "nf-tarball-deps-"));
    const rel = relative(root, scratch);
    assert.ok(rel === ".." || rel.startsWith(".." + sep), `temp dir ${scratch} must be outside the checkout`);
    out = join(scratch, "release");
    consumer = join(scratch, "consumer");
    mkdirSync(out);
    mkdirSync(consumer);
    if (dirs.some((d) => !existsSync(join(root, "packages", d, "lib")))) {
      execFileSync("pnpm", [...dirs.flatMap((d) => ["--filter", `@nitro-forge/${d}`]), "run", "build"], { cwd: root, stdio: "inherit" });
    }
    const workspaceManifests = workspaceIndex(Object.values(readWorkspaceManifests(root)));
    for (const d of dirs) packed[d] = packWithTarballDeps(join(root, "packages", d), out, workspaceManifests);
  });

  after(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test("each tarball packs with no errors under pnpm's file name", () => {
    for (const d of dirs) {
      assert.deepEqual(packed[d].errors, [], `${d}: ${packed[d].errors.join("; ")}`);
      assert.equal(packed[d].file, `nitro-forge-${d}-0.1.0.tgz`);
      assert.match(packed[d].sha256, /^[0-9a-f]{64}$/);
    }
  });

  test("engines peer on Ignition by its release URL; no workspace spec survives", () => {
    for (const d of ["prism", "cadence"]) {
      const m = packed[d].manifest;
      assert.equal(m.peerDependencies["@nitro-forge/ignition"], IGNITION_URL);
      assert.equal(Object.hasOwn(m.dependencies ?? {}, "@nitro-forge/ignition"), false);
      assert.deepEqual(Object.keys(m.devDependencies ?? {}).filter((n) => n.startsWith("@nitro-forge/")), []);
    }
    for (const d of dirs) {
      const text = readTarEntry(readFileSync(packed[d].path), "package/package.json").toString();
      assert.doesNotMatch(text, /workspace:/, `${d} packed manifest`);
      for (const [name, spec] of ["dependencies", "peerDependencies", "optionalDependencies"]
        .flatMap((f) => Object.entries(JSON.parse(text)[f] ?? {}))) {
        if (name.startsWith("@nitro-forge/")) assert.match(spec, /^https:\/\/github\.com\/mikevocalz\/nitro-forge\/releases\/download\//);
      }
    }
  });

  test("the RELEASE_PACKAGES set has a tarball for every Forge peer it names", () => {
    const manifests = readWorkspaceManifests(root);
    for (const d of RELEASE_PACKAGES) {
      for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
        for (const dep of Object.keys(manifests[d][field] ?? {})) {
          if (dep.startsWith("@nitro-forge/")) assert.ok(RELEASE_PACKAGES.includes(dep.slice("@nitro-forge/".length)), `${d} -> ${dep}`);
        }
      }
    }
  });

  test("installs by file path with one Ignition copy and every Node export importable", () => {
    const deps = Object.fromEntries(dirs.map((d) => [`@nitro-forge/${d}`, `file:${packed[d].path}`]));
    writeFileSync(join(consumer, "package.json"), JSON.stringify({
      name: "nf-tarball-consumer", private: true, type: "module", packageManager: "pnpm@12.18.0", dependencies: deps,
    }, null, 2));
    // A standalone project: no parent workspace, and Ignition's Nitro peers are
    // not auto-installed, so the install needs no registry or network.
    writeFileSync(join(consumer, "pnpm-workspace.yaml"), ["packages:", '  - "."', "autoInstallPeers: false",
      "strictPeerDependencies: false", "enableGlobalVirtualStore: false", "minimumReleaseAge: 0", ""].join("\n"));
    execFileSync("pnpm", ["install", "--offline"], { cwd: consumer, stdio: "inherit", env: { ...process.env, NODE_PATH: "" } });

    const consumerReal = realpathSync(consumer);
    const copies = [...ignitionCopies(join(consumer, "node_modules"))];
    assert.equal(copies.length, 1, `Ignition copies: ${copies.join(", ")}`);
    assert.ok(copies[0].startsWith(consumerReal + sep), `Ignition resolved outside the consumer: ${copies[0]}`);
    for (const d of ["prism", "cadence"]) {
      const engine = realpathSync(join(consumer, "node_modules", "@nitro-forge", d));
      assert.ok(engine.startsWith(consumerReal + sep) && !engine.startsWith(root + sep), `${d} at ${engine}`);
      const fromEngine = createRequire(join(engine, "package.json")).resolve("@nitro-forge/ignition/package.json");
      assert.equal(realpathSync(join(fromEngine, "..")), copies[0], `${d} resolves its own Ignition`);
    }

    // pnpm accepts the URL peer as met by the installed Ignition. The only
    // reported peers are Ignition's own Nitro runtime, left out on purpose.
    let peers = "";
    try {
      peers = execFileSync("pnpm", ["peers", "check"], { cwd: consumer, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      peers = String(error.stdout ?? "") + String(error.stderr ?? "");
    }
    assert.doesNotMatch(peers, /peer @nitro-forge\//, peers);
    const reported = [...peers.matchAll(/\b(?:missing|unmet|invalid|bad) peer (\S+)/gi)].map((m) => m[1]).sort();
    assert.deepEqual([...new Set(reported)], ["nitro-core", "react-native-nitro-modules"], peers);

    const specs = dirs.flatMap((d) => {
      const manifest = JSON.parse(readFileSync(join(consumer, "node_modules", "@nitro-forge", d, "package.json"), "utf8"));
      return nodeSubpaths(manifest.exports).map((sub) => `@nitro-forge/${d}${sub === "." ? "" : sub.slice(1)}`);
    });
    assert.ok(specs.length > 10, `only ${specs.length} Node exports found`);
    writeFileSync(join(consumer, "smoke.mjs"), [
      `const specs = ${JSON.stringify(specs)};`,
      "const failures = [];",
      "for (const spec of specs) {",
      "  try {",
      "    const url = import.meta.resolve(spec);",
      "    if (!url.startsWith(new URL('./node_modules/', import.meta.url).href)) throw new Error(`resolved outside the consumer: ${url}`);",
      "    if (spec.endsWith('/package.json')) await import(spec, { with: { type: 'json' } });",
      "    else await import(spec);",
      "  } catch (error) { failures.push(`${spec}: ${error.message}`); }",
      "}",
      "console.log(JSON.stringify({ imported: specs.length - failures.length, failures }));",
    ].join("\n"));
    const report = JSON.parse(execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } }).trim().split("\n").pop());
    assert.deepEqual(report.failures, []);
    assert.equal(report.imported, specs.length);
  });
});
