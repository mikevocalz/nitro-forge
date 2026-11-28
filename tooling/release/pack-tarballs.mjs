/**
 * `pnpm pack` release packages and point their `@nitro-forge/*` dependencies
 * at GitHub Release tarball URLs (see tarball-deps.mjs). Local files only: it
 * never publishes, tags or uploads. Run `turbo run build` first; a package
 * with a build script and no lib/ fails instead of packing without its build.
 *
 *   node tooling/release/pack-tarballs.mjs [--out dist/release] [--package prism ...]
 *
 * `packWithTarballDeps` is the one step a pack driver needs: PR #94's
 * pack-packages.mjs can call it in place of its bare `pnpm pack`, before it
 * hashes the tarball into SHA256SUMS.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { RELEASE_PACKAGES, rewritePackedTarball, tarballFileName, workspaceIndex } from "./tarball-deps.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Parsed package.json of every directory under packages/, keyed by directory name. */
export function readWorkspaceManifests(repoRoot = root) {
  const manifests = {};
  for (const dir of readdirSync(join(repoRoot, "packages"))) {
    const path = join(repoRoot, "packages", dir, "package.json");
    if (existsSync(path)) manifests[dir] = readJson(path);
  }
  return manifests;
}

/**
 * Pack one workspace package into `out` and rewrite its packed manifest.
 * On any error the tarball is deleted, so `out` never holds an unrewritten one.
 * @returns {{ name: string, file: string, path: string, sha256: string, manifest: object, errors: string[] }}
 */
export function packWithTarballDeps(packageDir, out, workspace) {
  const source = readJson(join(packageDir, "package.json"));
  const label = source.name ?? packageDir;
  const result = { name: label, file: null, path: null, sha256: null, manifest: null, errors: [] };
  if (source.private === true) {
    result.errors.push(`${label}: private packages are not released`);
    return result;
  }
  if (source.scripts?.build && !existsSync(join(packageDir, "lib"))) {
    result.errors.push(`${label}: lib/ is not built; run turbo run build before packing`);
    return result;
  }
  const packed = JSON.parse(execFileSync("pnpm", ["pack", "--pack-destination", out, "--json"],
    { cwd: packageDir, encoding: "utf8" }));
  result.path = packed.filename;
  result.file = basename(packed.filename);
  try {
    const expected = tarballFileName(source.name, source.version);
    if (result.file !== expected) {
      // The release URLs are built from this name, so a drift would point them at a missing asset.
      result.errors.push(`${label}: pnpm pack wrote ${result.file}, but release URLs name ${expected}`);
    } else {
      const { manifest, errors } = rewritePackedTarball(result.path, { source, workspace });
      result.manifest = manifest;
      result.errors.push(...errors);
    }
  } catch (error) {
    result.errors.push(`${label}: ${error.message}`);
  }
  if (result.errors.length) rmSync(result.path, { force: true });
  else result.sha256 = createHash("sha256").update(readFileSync(result.path)).digest("hex");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    out: { type: "string", default: "dist/release" },
    package: { type: "string", multiple: true, default: [...RELEASE_PACKAGES] },
  } });
  const manifests = readWorkspaceManifests();
  const workspace = workspaceIndex(Object.values(manifests));
  const out = resolve(root, values.out);
  mkdirSync(out, { recursive: true });
  const results = [];
  for (const dir of values.package) {
    if (!manifests[dir]) {
      results.push({ name: dir, errors: [`packages/${dir} has no package.json`] });
      continue;
    }
    const r = packWithTarballDeps(join(root, "packages", dir), out, workspace);
    results.push(r);
    console.log(`${r.errors.length ? "FAIL" : "ok  "} ${r.file ?? dir}${r.sha256 ? `  sha256 ${r.sha256}` : ""}`);
    for (const e of r.errors) console.log(`     ${e}`);
  }
  const failed = results.filter((r) => r.errors.length);
  if (failed.length) {
    console.error(`\npack-tarballs FAILED for ${failed.map((r) => r.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${results.length} tarballs in ${values.out}; every @nitro-forge dependency points at a release tarball URL.`);
}
