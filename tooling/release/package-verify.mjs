/**
 * Pure checks for one unpacked `pnpm pack` tarball. No process spawning and no
 * network: callers extract the tarball and pass the directory in. The driver is
 * pack-packages.mjs; the tests are package-verify.test.mjs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";

/** Ignition plus the seven headless engines (RELEASE_TRAIN.md invariants). */
export const RELEASE_PACKAGES = Object.freeze([
  "ignition", "prism", "cadence", "splice", "folio", "pitch", "tally", "quill",
]);

/**
 * Packages that are not `private` but are outside the v1 release set. Every
 * non-private workspace package must appear in exactly one of the two lists.
 */
export const DEFERRED_PACKAGES = Object.freeze({
  photo: "Newer studio adapter; the v1 release train names seven engines only.",
  motion: "Newer studio adapter; the v1 release train names seven engines only.",
  design: "Newer studio adapter; the v1 release train names seven engines only.",
  draft: "Newer studio adapter; the v1 release train names seven engines only.",
  scene: "Newer studio adapter; the v1 release train names seven engines only.",
  telemetry: "Not named in the v1 release train.",
});

const ALWAYS_INCLUDED = /^(package\.json|readme(\.[^/]*)?|licen[cs]e(\.[^/]*)?|changelog(\.[^/]*)?)$/i;
const FORBIDDEN_SEGMENTS = new Set(["node_modules", "tests", "__tests__", ".turbo", "rust", "target"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SCANNED = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TYPES_FILE = /\.(d\.[cm]?ts|[cm]?ts|tsx)$/;
const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"];
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".d.ts", ".js", ".mjs", ".cjs", ".json",
  "/index.ts", "/index.tsx", "/index.d.ts", "/index.js"];
const BUILTINS = new Set(builtinModules);

/** Sorted POSIX paths of every regular file under `dir`. */
export function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else if (entry.isFile()) out.push(rel);
    else throw new Error(`Unexpected non-regular member: ${rel}`);
  }
  return out.sort();
}

/**
 * Names of non-private workspace packages split into release, deferred and
 * unclassified. `manifests` maps directory name to parsed package.json.
 */
export function classifyWorkspace(manifests) {
  const result = { release: [], deferred: [], unclassified: [], missing: [] };
  for (const [dir, pkg] of Object.entries(manifests)) {
    if (pkg.private === true) continue;
    if (RELEASE_PACKAGES.includes(dir)) result.release.push(dir);
    else if (Object.hasOwn(DEFERRED_PACKAGES, dir)) result.deferred.push(dir);
    else result.unclassified.push(dir);
  }
  for (const name of RELEASE_PACKAGES) {
    if (!Object.hasOwn(manifests, name)) result.missing.push(name);
    else if (manifests[name].private === true) result.missing.push(name);
  }
  return result;
}

function coveredByFiles(path, files) {
  if (ALWAYS_INCLUDED.test(path)) return true;
  return files.some((entry) => {
    const e = entry.replace(/^\.\//, "").replace(/\/$/, "");
    return path === e || path.startsWith(e + "/");
  });
}

/** Collect every string target from an `exports`/`imports` value. */
function exportTargets(value, key = ".", condition = null) {
  if (typeof value === "string") return [{ key, target: value, condition }];
  if (Array.isArray(value)) return value.flatMap((v) => exportTargets(v, key, condition));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) =>
    k.startsWith(".") || k.startsWith("#") ? exportTargets(v, k, null) : exportTargets(v, key, k));
}

function targetExists(target, members) {
  const t = posix.normalize(target.replace(/^\.\//, ""));
  if (!t.includes("*")) return members.has(t);
  const [head, tail] = t.split("*");
  for (const m of members) if (m.startsWith(head) && m.endsWith(tail)) return true;
  return false;
}

function resolveRelative(fromFile, spec, members) {
  const base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  if (base === ".." || base.startsWith("../") || posix.isAbsolute(base)) return { escapes: true };
  const candidates = [base];
  // TypeScript ESM sources import "./x.js" for "./x.ts".
  if (/\.[cm]?js$/.test(base)) candidates.push(base.replace(/\.([cm]?)js$/, ".$1ts"), base.replace(/\.js$/, ".tsx"));
  for (const c of candidates) for (const s of RESOLVE_SUFFIXES) if (members.has(c + s)) return { file: c + s };
  return {};
}

function mapImport(spec, imports) {
  for (const [pattern, target] of Object.entries(imports ?? {})) {
    const t = typeof target === "string" ? target : exportTargets(target)[0]?.target;
    if (!t) continue;
    if (pattern === spec) return t;
    if (pattern.includes("*")) {
      const [head, tail] = pattern.split("*");
      if (spec.startsWith(head) && spec.endsWith(tail)) {
        return t.replace("*", spec.slice(head.length, spec.length - tail.length));
      }
    }
  }
  return null;
}

/** Module specifiers referenced by a JS/TS source, comments removed. */
export function moduleSpecifiers(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const specs = new Set();
  const patterns = [
    /\b(?:import|export)\s[^'";]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) specs.add(m[1]);
  return [...specs];
}

function packageNameOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Verify one unpacked tarball.
 * @param {object} args
 * @param {string} args.packedDir directory holding the tarball's `package/` contents
 * @param {object} args.source the workspace package.json the tarball was packed from
 * @param {Record<string,string>} [args.releaseVersions] package name -> version for the whole release set
 * @returns {string[]} human-readable errors; empty means the tarball passed
 */
export function verifyPackedPackage({ packedDir, source, releaseVersions = {} }) {
  const errors = [];
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(packedDir, "package.json"), "utf8"));
  } catch (error) {
    return [`package.json missing or unreadable in tarball: ${error.message}`];
  }
  const memberList = listFiles(packedDir);
  const members = new Set(memberList);
  const label = pkg.name ?? "(unnamed)";

  if (pkg.name !== source.name) errors.push(`${label}: name ${pkg.name} differs from source ${source.name}`);
  // Owner decision D8 (2026-11-23): every release package ships under MIT with its license text.
  if (pkg.license !== "MIT") errors.push(`${label}: license must be "MIT", found ${JSON.stringify(pkg.license)}`);
  if (!members.has("LICENSE")) errors.push(`${label}: no LICENSE file in the tarball`);
  if (pkg.version !== source.version) errors.push(`${label}: version ${pkg.version} differs from source ${source.version}`);

  // Contents match `files`.
  const files = Array.isArray(source.files) ? source.files : null;
  if (!files || files.length === 0) {
    errors.push(`${label}: source package.json has no "files" allowlist`);
  } else {
    for (const m of memberList) {
      if (!coveredByFiles(m, files)) errors.push(`${label}: ${m} is outside the "files" allowlist`);
    }
    for (const entry of files) {
      const e = entry.replace(/^\.\//, "").replace(/\/$/, "");
      if (!memberList.some((m) => m === e || m.startsWith(e + "/"))) {
        errors.push(`${label}: "files" entry ${entry} matched nothing in the tarball`);
      }
    }
  }
  for (const m of memberList) {
    if (m.split("/").some((s) => FORBIDDEN_SEGMENTS.has(s)) || TEST_FILE.test(m) || m.endsWith(".tsbuildinfo")) {
      errors.push(`${label}: test/build/native-source member must not ship: ${m}`);
    }
  }

  // Dependency specifiers consumable outside the workspace.
  for (const field of DEP_FIELDS) {
    for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
      if (/^(workspace|link|portal):/.test(String(spec))) {
        errors.push(`${label}: ${field}.${dep} still uses ${spec}`);
      }
    }
  }
  for (const [dep, spec] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    if (!dep.startsWith("@nitro-forge/")) continue;
    if (!Object.hasOwn(releaseVersions, dep)) {
      errors.push(`${label}: depends on ${dep}, which is not in the release set`);
    } else if (spec !== releaseVersions[dep]) {
      errors.push(`${label}: depends on ${dep}@${spec}, but the release set packs ${releaseVersions[dep]}`);
    }
  }

  // Entry points and types.
  for (const field of ["main", "module", "react-native", "types", "typings"]) {
    if (typeof pkg[field] === "string" && !targetExists(pkg[field], members)) {
      errors.push(`${label}: ${field} target ${pkg[field]} is missing`);
    }
  }
  const typesField = pkg.types ?? pkg.typings;
  if (typeof typesField !== "string") errors.push(`${label}: no "types" field`);
  else if (!TYPES_FILE.test(typesField)) errors.push(`${label}: "types" target ${typesField} is not a TypeScript file`);
  const byKey = new Map();
  for (const t of exportTargets(pkg.exports ?? {})) {
    if (!targetExists(t.target, members)) errors.push(`${label}: exports["${t.key}"] target ${t.target} is missing`);
    if (!byKey.has(t.key)) byKey.set(t.key, []);
    byKey.get(t.key).push(t);
  }
  for (const [key, targets] of byKey) {
    const typed = targets.some((t) => t.condition === "types" || TYPES_FILE.test(t.target));
    if (!typed) errors.push(`${label}: exports["${key}"] has no TypeScript types`);
  }
  for (const t of exportTargets(pkg.imports ?? {})) {
    if (!targetExists(t.target, members)) errors.push(`${label}: imports["${t.key}"] target ${t.target} is missing`);
  }

  // Every import in shipped sources resolves inside the tarball or to a declared dependency.
  const declared = new Set([pkg.name, ...["dependencies", "peerDependencies", "optionalDependencies"]
    .flatMap((f) => Object.keys(pkg[f] ?? {}))]);
  for (const file of memberList) {
    if (!SCANNED.test(file)) continue;
    const text = readFileSync(join(packedDir, file), "utf8");
    for (const spec of moduleSpecifiers(text)) {
      if (spec.startsWith(".")) {
        const r = resolveRelative(file, spec, members);
        if (r.escapes) errors.push(`${label}: ${file} imports ${spec}, outside the package`);
        else if (!r.file) errors.push(`${label}: ${file} imports ${spec}, which is not in the tarball`);
      } else if (spec.startsWith("#")) {
        const mapped = mapImport(spec, pkg.imports);
        if (!mapped) errors.push(`${label}: ${file} imports ${spec}, which no "imports" entry maps`);
        else if (!resolveRelative("x", mapped, members).file) {
          errors.push(`${label}: ${file} imports ${spec} -> ${mapped}, which is not in the tarball`);
        }
      } else if (spec.startsWith("node:") || BUILTINS.has(spec)) {
        continue;
      } else if (!declared.has(packageNameOf(spec))) {
        errors.push(`${label}: ${file} imports ${spec}, which is not a dependency or peer dependency`);
      }
    }
  }
  return errors;
}

/** `sha256sum` text format: "<64 hex>  <file>" per line, sorted by file. */
export function formatSha256Sums(entries) {
  return [...entries].sort((a, b) => a.file.localeCompare(b.file))
    .map(({ sha256, file }) => {
      if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Bad sha256 for ${file}`);
      if (/[\n/\\]/.test(file)) throw new Error(`Bad file name ${file}`);
      return `${sha256}  ${file}`;
    }).join("\n") + "\n";
}

export function parseSha256Sums(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) throw new Error(`Malformed SHA256SUMS line: ${line}`);
    return { sha256: m[1], file: m[2] };
  });
}

/** Tar member names must stay under `package/` with no absolute or parent paths. */
export function checkTarMembers(names) {
  const errors = [];
  for (const n of names) {
    const clean = n.replace(/\/$/, "");
    if (!clean) continue;
    if (posix.isAbsolute(clean) || clean.split("/").includes("..") || !(clean === "package" || clean.startsWith("package/"))) {
      errors.push(`unsafe tar member: ${n}`);
    }
  }
  return errors;
}

