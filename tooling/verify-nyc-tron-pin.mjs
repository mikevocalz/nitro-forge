#!/usr/bin/env node
/**
 * Fails when any package.json or committed pnpm-lock.yaml refers to an
 * @nyc-tron/* package by anything other than the tarball URL pinned in
 * tooling/nyc-tron.json, when a pnpm patch of an @nyc-tron package does more
 * than add export-map entries to the pinned version, or when a Forge source
 * file imports the editor controls from their old NYC-Tron location.
 *
 *   node tooling/verify-nyc-tron-pin.mjs            # manifests, lockfiles, patches, imports
 *   node tooling/verify-nyc-tron-pin.mjs --download # also re-hash the release assets
 *
 * Install sections (dependencies, devDependencies, optionalDependencies) must
 * use the exact pinned URL. peerDependencies must be a caret range that the
 * pinned version satisfies, because a consumer resolves the peer from its own
 * tarball dependency.
 *
 * Patches: a lockfile's `patchedDependencies` lists `'@nyc-tron/ui@1.0.0-rc.2':
 * <sha256>`. That is not a registry resolution. It is accepted only when the
 * version is the pinned one, the workspace's pnpm-workspace.yaml names an
 * existing patch file for it, the hash is that file's SHA-256, and the patch
 * only adds export-map entries (see checkTronPatch).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP = new Set(["node_modules", ".git", "target", "dist", "build", "android", "ios", ".expo", ".turbo"]);
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

/** package.json files and JS/TS source files under `dir`, skipping build and install output. */
export function findFiles(dir, found = { manifests: [], sources: [] }) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) findFiles(path, found);
    else if (entry === "package.json") found.manifests.push(path);
    else if (SOURCE.test(entry)) found.sources.push(path);
  }
  return found;
}

const INSTALL_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];

export function checkManifests(root, pin, manifestPaths) {
  const problems = [];
  let references = 0;
  for (const manifestPath of manifestPaths) {
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
  return { problems, references };
}

/**
 * The entries of a top-level `patchedDependencies:` map in pnpm YAML
 * (pnpm-workspace.yaml or pnpm-lock.yaml), as a Map of key to value, plus the
 * text with that block removed.
 */
export function splitPatchedDependencies(text) {
  const entries = new Map();
  const kept = [];
  let inBlock = false;
  for (const line of text.split("\n")) {
    if (/^patchedDependencies:\s*$/.test(line)) { inBlock = true; continue; }
    if (inBlock && (/^\s/.test(line) || line === "")) {
      const match = line.match(/^\s+(['"]?)(.+?)\1:\s*(?:(['"])(.*?)\3|(\S+))\s*$/);
      if (match && !line.trimStart().startsWith("#")) entries.set(match[2], match[4] ?? match[5]);
      continue;
    }
    inBlock = false;
    kept.push(line);
  }
  return { entries, rest: kept.join("\n") };
}

/** Split `@scope/name@version` into its name and version. */
function splitKey(key) {
  const at = key.lastIndexOf("@");
  return at > 0 ? { name: key.slice(0, at), version: key.slice(at + 1) } : { name: key, version: "" };
}

const CONDITIONS = new Set(["types", "react-native", "browser", "import", "require", "default"]);

/**
 * The subpaths Tron added on 2026-11-28 and the rc.2 dist file each one
 * resolves to. Seven helpers still sit under rc.2's old forge directory,
 * where rc.2's own shell imports them, so the bridge must reuse those files.
 * Delete this table with the patch when the pin moves past rc.2.
 */
const OLD = "forge/";
const RC2_BRIDGE = Object.freeze({
  "./components/feedback/announce": OLD + "announce",
  "./components/forms/toggle-a11y": OLD + "toggle-a11y",
  "./components/forms/SettingSwitch": OLD + "canvas/SettingSwitch",
  "./components/gestures/canvas-gesture-relations": OLD + "canvas/canvas-gesture-relations",
  "./components/shell/precision": OLD + "inputs/precision",
  "./components/shell/precision-scrubber-model": OLD + "inputs/precision-scrubber-model",
  "./components/shell/PrecisionScrubber": OLD + "inputs/PrecisionScrubber",
  ...Object.fromEntries([
    "gestures/adjust-keys", "gestures/canvas-responder", "gestures/coordinate-admission",
    "gestures/editor-interaction-scope", "gestures/local-pointer", "gestures/measured-drop-owner",
    "gestures/useEditorPan", "gestures/useLocalPointer", "gestures/value-gesture",
    "local-store", "shell/useOwnedAction", "styles", "useLocalStore",
  ].map((path) => [`./components/${path}`, path])),
});

/**
 * A NYC-Tron patch may only add entries to package.json's export map that
 * point at files the release already ships under dist/. It may not remove or
 * change a line, and may not touch any other file, so no code changes.
 * With `installedDir` (the installed, patched package), also checks that each
 * added entry is in its export map and that every target file exists there.
 */
export function checkTronPatch(text, where, installedDir) {
  const problems = [];
  const files = [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[1] === m[2] ? m[1] : `${m[1]} -> ${m[2]}`);
  if (files.length !== 1 || files[0] !== "package.json")
    problems.push(`${where} must change only package.json, but changes: ${files.join(", ") || "nothing"}`);
  const runs = [];
  let inHunk = false;
  let run = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) { inHunk = false; run = null; continue; }
    if (line.startsWith("@@")) { inHunk = true; run = null; continue; }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("-")) problems.push(`${where} removes or changes a line: ${line.slice(1).trim()}`);
    if (line.startsWith("+")) {
      if (!run) runs.push(run = []);
      run.push(line.slice(1));
    } else run = null;
  }
  if (!runs.length) problems.push(`${where} adds nothing`);
  const added = {};
  for (const lines of runs) {
    // An insertion between two export entries reads `},  "./x": {...}, ..., "default": "..."`;
    // the closing brace of the last new entry is the context line after it.
    let parsed;
    try { parsed = JSON.parse(`{"(previous entry)": {${lines.join("\n")}}}`); }
    catch { problems.push(`${where} adds lines that are not whole export-map entries:\n      ${lines.join("\n      ")}`); continue; }
    const { "(previous entry)": previous, ...entries } = parsed;
    if (Object.keys(previous).length) problems.push(`${where} changes an existing export entry`);
    for (const [key, entry] of Object.entries(entries)) {
      if (!key.startsWith("./") || typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        problems.push(`${where} adds "${key}", which is not an export-map entry`);
        continue;
      }
      // Only the known rc.2 bridge entries are allowed, each pointing at its
      // fixed dist file, so a patch cannot alias a new key onto one of rc.2's
      // old control copies and bring a stale duplicate back.
      const base = RC2_BRIDGE[key];
      if (!base) { problems.push(`${where} adds "${key}", which is not one of the rc.2 bridge subpaths`); continue; }
      for (const [condition, target] of Object.entries(entry)) {
        const expected = `./dist/components/${base}${condition === "types" ? ".d.ts" : ".js"}`;
        if (!CONDITIONS.has(condition) || target !== expected)
          problems.push(`${where} "${key}" has ${condition}: ${JSON.stringify(target)}; expected ${expected}`);
      }
      added[key] = entry;
    }
  }
  if (installedDir && existsSync(join(installedDir, "package.json"))) {
    const exports = JSON.parse(readFileSync(join(installedDir, "package.json"), "utf8")).exports ?? {};
    for (const [key, entry] of Object.entries(added)) {
      if (JSON.stringify(exports[key]) !== JSON.stringify(entry))
        problems.push(`${where} "${key}" is not in the installed package's export map; reinstall`);
      for (const target of Object.values(entry))
        if (typeof target === "string" && !existsSync(join(installedDir, target)))
          problems.push(`${where} "${key}" points at ${target}, which the pinned release does not ship`);
    }
  }
  return problems;
}

/**
 * Lockfile checks. `workspace` holds the patchedDependencies of the
 * pnpm-workspace.yaml next to the lockfile and that file's directory;
 * `installedDir(name)` returns an installed copy of a package, if any.
 */
export function checkLockfile(lockPath, lock, pin, workspace, installedDir = () => undefined) {
  const problems = [];
  const { entries: lockPatches, rest } = splitPatchedDependencies(lock);
  for (const [key, hash] of lockPatches) {
    const { name, version } = splitKey(key);
    if (!name.startsWith("@nyc-tron/")) continue;
    const pinned = pin.packages[name];
    if (!pinned) { problems.push(`${lockPath} patches ${key}, which is not in tooling/nyc-tron.json`); continue; }
    if (version !== pinned.version) { problems.push(`${lockPath} patches ${key}, but the pinned version is ${pinned.version}`); continue; }
    const patchPath = workspace.patches.get(key);
    if (!patchPath) { problems.push(`${lockPath} patches ${key}, but pnpm-workspace.yaml names no patch file for it`); continue; }
    const file = resolve(workspace.dir, patchPath);
    if (!existsSync(file)) { problems.push(`${lockPath} patches ${key} with ${patchPath}, which does not exist`); continue; }
    const text = readFileSync(file, "utf8");
    const actual = createHash("sha256").update(text).digest("hex");
    if (actual !== hash) problems.push(`${lockPath} records ${hash} for the ${key} patch, but ${patchPath} hashes to ${actual}; reinstall`);
    problems.push(...checkTronPatch(text, patchPath, installedDir(name)));
  }
  for (const [key] of workspace.patches) {
    const { name, version } = splitKey(key);
    if (name.startsWith("@nyc-tron/") && version !== pin.packages[name]?.version)
      problems.push(`the pnpm-workspace.yaml beside ${lockPath} patches ${key}, which is not the pinned version`);
  }
  // Every @nyc-tron tarball any committed lockfile resolves must be a pinned URL.
  // pnpm 12 records SHA-512 integrity for URL tarballs; `--download` independently
  // checks the release's SHA-256 pins and published checksum manifest as well.
  const pinnedUrls = new Set(Object.values(pin.packages).map((p) => p.url));
  for (const match of rest.matchAll(/(@nyc-tron\/[a-z-]+)@(https:\/\/[^\s'(]+?\.tgz)/g)) {
    if (!pinnedUrls.has(match[2]) || pin.packages[match[1]]?.url !== match[2])
      problems.push(`${lockPath} resolves ${match[1]} from ${match[2]}, which is not the pinned URL`);
  }
  for (const match of rest.matchAll(/(@nyc-tron\/[a-z-]+)@(\d[^\s'(:]*)/g)) {
    problems.push(`${lockPath} resolves ${match[1]}@${match[2]} from a registry, not the pinned tarball`);
  }
  return problems;
}

// Built from parts so this file does not match its own check.
const OLD_CONTROLS = new RegExp("[\"'`]@nyc-tron/ui/components/" + "forge/");

/**
 * The editor controls moved from @nyc-tron/ui/components/forge/* to
 * @nitro-forge/editor-controls (2026-11-28). The pinned rc.2 tarball still
 * ships the old copies, so an old import would still build and would bundle a
 * second, stale copy of a control. Fail on any reference in a source file.
 */
export function checkForgeImports(root, sourcePaths) {
  const problems = [];
  for (const path of sourcePaths) {
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (OLD_CONTROLS.test(line))
        problems.push(`${relative(root, path)}:${index + 1} imports the editor controls from NYC-Tron; use @nitro-forge/editor-controls (see packages/editor-controls/README.md)`);
    });
  }
  return problems;
}

function findLockfiles(root, dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
    const candidate = join(dir, entry.name, "pnpm-lock.yaml");
    if (existsSync(candidate)) found.push(relative(root, candidate));
  }
  return found;
}

export function verify(root, pin) {
  const { manifests, sources } = findFiles(root);
  const { problems, references } = checkManifests(root, pin, manifests);
  for (const lockPath of ["pnpm-lock.yaml", ...findLockfiles(root, join(root, "examples"))]) {
    const dir = dirname(join(root, lockPath));
    const workspaceFile = join(dir, "pnpm-workspace.yaml");
    const patches = existsSync(workspaceFile) ? splitPatchedDependencies(readFileSync(workspaceFile, "utf8")).entries : new Map();
    const installedDir = (name) => [join(dir, "node_modules", name), join(root, "packages/editor-controls/node_modules", name)].find((p) => existsSync(p));
    problems.push(...checkLockfile(lockPath, readFileSync(join(root, lockPath), "utf8"), pin, { dir, patches }, installedDir));
  }
  problems.push(...checkForgeImports(root, sources));
  return { problems, references, sources: sources.length };
}

async function checkRelease(pin) {
  const problems = [];
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
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
  const pin = JSON.parse(readFileSync(join(root, "tooling/nyc-tron.json"), "utf8"));
  const download = process.argv.includes("--download");
  const { problems, references, sources } = verify(root, pin);
  if (download) problems.push(...await checkRelease(pin));
  if (problems.length) {
    process.stderr.write("NYC-Tron pin check failed:\n" + problems.map((p) => "  - " + p).join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write(`NYC-Tron pin ${pin.tag}: ${references} manifest references match; ` +
    `patches add export entries only; no old editor-control imports in ${sources} source files` +
    (download ? "; release assets re-hashed" : "") + "\n");
}
