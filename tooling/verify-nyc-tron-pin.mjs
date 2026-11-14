#!/usr/bin/env node
/**
 * Fails when any package.json or committed pnpm-lock.yaml refers to an
 * @nyc-tron/* package by anything other than the tarball URL pinned in
 * tooling/nyc-tron.json.
 *
 *   node tooling/verify-nyc-tron-pin.mjs            # manifests + lockfile
 *   node tooling/verify-nyc-tron-pin.mjs --download # also re-hash the release assets
 *
 * Install sections (dependencies, devDependencies, optionalDependencies) must
 * use the exact pinned URL. peerDependencies must be a caret range that the
 * pinned version satisfies, because a consumer resolves the peer from its own
 * tarball dependency.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const pin = JSON.parse(readFileSync(join(root, "tooling/nyc-tron.json"), "utf8"));
const download = process.argv.includes("--download");
const problems = [];

const SKIP = new Set(["node_modules", ".git", "target", "dist", "build", "android", "ios", ".expo", ".turbo"]);
function findManifests(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) findManifests(path, found);
    else if (entry === "package.json") found.push(path);
  }
  return found;
}

const INSTALL_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];
let references = 0;
for (const manifestPath of findManifests(root)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const where = relative(root, manifestPath);
  for (const section of [...INSTALL_SECTIONS, "peerDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith("@nyc-tron/")) continue;
      references++;
      const pinned = pin.packages[name];
      if (!pinned) {
        problems.push(`${where} ${section}.${name}: package is not in tooling/nyc-tron.json`);
        continue;
      }
      if (section === "peerDependencies") {
        if (spec !== "^" + pinned.version)
          problems.push(`${where} peerDependencies.${name} is "${spec}", expected "^${pinned.version}"`);
      } else if (spec !== pinned.url) {
        problems.push(`${where} ${section}.${name} is "${spec}", expected the pinned URL ${pinned.url}`);
      }
    }
  }
}

// Every @nyc-tron tarball any committed lockfile resolves must be a pinned URL.
// pnpm 12 records SHA-512 integrity for URL tarballs; `--download` independently
// checks the release's SHA-256 pins and published checksum manifest as well.
const pinnedUrls = new Set(Object.values(pin.packages).map((p) => p.url));
const lockfiles = ["pnpm-lock.yaml", ...findLockfiles(join(root, "examples"))];
for (const lockPath of lockfiles) {
  const lock = readFileSync(join(root, lockPath), "utf8");
  for (const match of lock.matchAll(/(@nyc-tron\/[a-z-]+)@(https:\/\/[^\s'(]+?\.tgz)/g)) {
    if (!pinnedUrls.has(match[2]) || pin.packages[match[1]]?.url !== match[2])
      problems.push(`${lockPath} resolves ${match[1]} from ${match[2]}, which is not the pinned URL`);
  }
  for (const match of lock.matchAll(/(@nyc-tron\/[a-z-]+)@(\d[^\s'(:]*)/g)) {
    problems.push(`${lockPath} resolves ${match[1]}@${match[2]} from a registry, not the pinned tarball`);
  }
}

function findLockfiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
    const candidate = join(dir, entry.name, "pnpm-lock.yaml");
    try { statSync(candidate); found.push(relative(root, candidate)); } catch { /* no lockfile */ }
  }
  return found;
}

if (download) {
  const sumsResponse = await fetch(pin.sha256sumsUrl);
  if (!sumsResponse.ok) throw new Error(`GET ${pin.sha256sumsUrl} failed: ${sumsResponse.status}`);
  const sums = new Map((await sumsResponse.text()).trim().split("\n")
    .map((line) => line.trim().split(/\s+/)).map(([hash, file]) => [file, hash]));
  for (const [name, pinned] of Object.entries(pin.packages)) {
    if (sums.get(pinned.file) !== pinned.sha256)
      problems.push(`${name}: SHA256SUMS lists ${sums.get(pinned.file) ?? "nothing"}, pin has ${pinned.sha256}`);
    const response = await fetch(pinned.url);
    if (!response.ok) {
      problems.push(`${name}: GET ${pinned.url} failed: ${response.status}`);
      continue;
    }
    const actual = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
    if (actual !== pinned.sha256) problems.push(`${name}: downloaded sha256 ${actual}, pin has ${pinned.sha256}`);
  }
}

if (problems.length) {
  process.stderr.write("NYC-Tron pin check failed:\n" + problems.map((p) => "  - " + p).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(`NYC-Tron pin ${pin.tag}: ${references} manifest references match` +
  (download ? "; release assets re-hashed" : "") + "\n");
