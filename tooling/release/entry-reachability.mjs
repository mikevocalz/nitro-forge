/**
 * Which modules a package's export entries reach, and whether any of them
 * would break the consumer that resolves that entry.
 *
 * For every subpath in a package's `exports`, the entry is resolved the way
 * two consumers resolve it:
 *   - react-native: Metro, with the `react-native` condition;
 *   - default: any other bundler or runtime that sets no platform condition.
 * Each is resolved twice, once through the repo's `@nitro-forge/source`
 * condition (src/) and once without it (the built lib/ that tarballs ship).
 * From each resolved file, relative imports and the package's own `#imports`
 * are followed. A violation is a reached module that imports a Node builtin
 * (`node:fs`, or a bare `fs`), or an ES module that calls `require()`.
 * CommonJS files (`.cjs`, such as Nitrogen's generated loaders) may call
 * `require()`; they are still checked for Node builtins.
 *
 * Subpaths exported only under the `node` condition resolve to nothing for
 * both consumers, which is how Node-only entries stay out of React Native.
 * Imports of other packages are not followed: each package is checked on
 * its own entries.
 *
 * A source scan, not a bundler: `import()` and `require()` with computed
 * arguments are not followed.
 */
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import * as nodeModule from "node:module";
import { dirname, join, relative, resolve } from "node:path";

export const SOURCE_CONDITION = "@nitro-forge/source";
export const CONSUMERS = {
  "react-native": ["react-native", "import", "require", "default"],
  default: ["import", "default"],
};

const builtins = new Set(builtinModules.flatMap((name) => [name, name.split("/")[0]]));
export const isNodeBuiltin = (spec) => spec.startsWith("node:") || builtins.has(spec) || builtins.has(spec.split("/")[0]);

const NO_MATCH = Symbol("no-match");

/** Node's PACKAGE_TARGET_RESOLVE over conditions, without patterns. */
export function resolveConditional(target, conditions) {
  if (target === null) return null;
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const entry of target) {
      const resolved = resolveConditional(entry, conditions);
      if (resolved !== NO_MATCH) return resolved;
    }
    return NO_MATCH;
  }
  for (const [condition, value] of Object.entries(target)) {
    if (!conditions.includes(condition)) continue;
    const resolved = resolveConditional(value, conditions);
    if (resolved !== NO_MATCH) return resolved;
  }
  return NO_MATCH;
}

const exportsMap = (pkg) => {
  const field = pkg.exports;
  if (field == null) return {};
  if (typeof field === "string" || Array.isArray(field) || !Object.keys(field).some((key) => key.startsWith(".")))
    return { ".": field };
  return field;
};

function resolveImportsField(pkg, spec, conditions) {
  const imports = pkg.imports ?? {};
  if (Object.hasOwn(imports, spec)) return resolveConditional(imports[spec], conditions);
  for (const [key, value] of Object.entries(imports)) {
    const star = key.indexOf("*");
    if (star < 0) continue;
    const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
    if (spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= key.length - 1) {
      const match = spec.slice(prefix.length, spec.length - suffix.length);
      const resolved = resolveConditional(value, conditions);
      return typeof resolved === "string" ? resolved.replaceAll("*", match) : resolved;
    }
  }
  return NO_MATCH;
}

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const isFile = (path) => existsSync(path) && statSync(path).isFile();

function resolveFile(base, consumer) {
  if (isFile(base)) return base;
  // TypeScript sources may name their output: `./math.js` for `./math.ts`.
  const emitted = /\.([cm]?)js(x?)$/.exec(base);
  if (emitted) {
    const stem = base.slice(0, -emitted[0].length);
    for (const ext of [`.${emitted[1]}ts${emitted[2]}`, ".tsx"]) if (isFile(stem + ext)) return stem + ext;
  }
  const exts = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];
  const platform = consumer === "react-native" ? exts.map((ext) => ".native" + ext) : [];
  for (const ext of [...platform, ...exts]) if (isFile(base + ext)) return base + ext;
  if (existsSync(base) && statSync(base).isDirectory())
    for (const ext of [...platform, ...exts]) if (isFile(join(base, "index" + ext))) return join(base, "index" + ext);
  return null;
}

const KEYWORDS_BEFORE_EXPRESSION = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await", "export", "default"]);

/**
 * Blank out comments and replace every string, template and regex literal
 * with a placeholder, so import syntax inside them is never read as code.
 * Returns the masked code and the literal string values by index.
 */
export function maskSource(code) {
  let out = "";
  const strings = [];
  let previous = ""; // last significant token, to tell a regex from division
  let i = 0;
  const n = code.length;
  const regexAllowed = () => previous === "" || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(previous) || KEYWORDS_BEFORE_EXPRESSION.has(previous);
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      i = end < 0 ? n : end;
    } else if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? n : end + 2;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let value = "";
      while (j < n && code[j] !== c && code[j] !== "\n") {
        if (code[j] === "\\") { value += code[j + 1] ?? ""; j += 2; } else value += code[j++];
      }
      strings.push(value);
      out += `${c}\u0000${strings.length - 1}${c}`;
      i = j + 1;
      previous = "literal";
    } else if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const t = code[j];
        if (t === "\\") { j += 2; continue; }
        if (depth === 0 && t === "`") break;
        if (t === "$" && code[j + 1] === "{") { depth++; j += 2; continue; }
        if (depth > 0 && t === "{") depth++;
        if (depth > 0 && t === "}") depth--;
        j++;
      }
      out += "``";
      i = j + 1;
      previous = "literal";
    } else if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && code[j] !== "\n") {
        const t = code[j];
        if (t === "\\") { j += 2; continue; }
        if (t === "[") inClass = true;
        else if (t === "]") inClass = false;
        else if (t === "/" && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(code[j])) j++;
      out += "/r/";
      i = j;
      previous = "literal";
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      out += word;
      previous = word;
      i = j;
    } else {
      out += c;
      if (!/\s/.test(c)) previous = c;
      i++;
    }
  }
  return { masked: out, strings };
}

function stripTypes(code, file) {
  if (!/\.[cm]?ts$/.test(file) || typeof nodeModule.stripTypeScriptTypes !== "function") return code;
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    for (const mode of ["strip", "transform"]) {
      try {
        return nodeModule.stripTypeScriptTypes(code, { mode });
      } catch {
        // enums or parameter properties need transform; anything else falls back to raw text
      }
    }
    return code;
  } finally {
    process.emitWarning = emit;
  }
}

/** Static, side-effect, re-export, dynamic and require specifiers, plus bare require use. */
export function scanModule(code, file = "module.js") {
  const { masked, strings } = maskSource(stripTypes(code, file));
  const literal = (index) => strings[Number(index)];
  const specifiers = [];
  // An import/export clause never holds `=` or parentheses, which keeps a
  // match from running on from an unrelated `export type X = ...`.
  for (const m of masked.matchAll(/\b(import|export)\b([^;"'`=()]*?)\bfrom\s*(["'])\u0000(\d+)\3/g)) {
    if (/^\s*type\s/.test(m[2])) continue;
    specifiers.push({ kind: m[1], spec: literal(m[4]) });
  }
  for (const m of masked.matchAll(/\bimport\s*(["'])\u0000(\d+)\1/g)) specifiers.push({ kind: "import", spec: literal(m[2]) });
  for (const m of masked.matchAll(/\bimport\s*\(\s*(["'])\u0000(\d+)\1\s*[,)]/g)) specifiers.push({ kind: "dynamic", spec: literal(m[2]) });
  for (const m of masked.matchAll(/(?<![.\w$])require\s*\(\s*(["'])\u0000(\d+)\1\s*\)/g)) specifiers.push({ kind: "require", spec: literal(m[2]) });
  const requireUses = [...masked.matchAll(/(?<![.\w$])require\s*[(.]/g)].length;
  return { specifiers, requireUses };
}

function isEsm(file, pkg) {
  if (/\.m[jt]s$/.test(file)) return true;
  if (/\.c[jt]s$/.test(file)) return false;
  return pkg.type === "module" || /\.tsx?$/.test(file);
}

/** Walk one resolved entry. Returns violations with the import chain that reached them. */
export function walkEntry(packageDir, pkg, entryFile, consumer, conditions) {
  const violations = [];
  const seen = new Set();
  const rel = (path) => relative(packageDir, path);
  const queue = [[entryFile, [rel(entryFile)]]];
  while (queue.length > 0) {
    const [file, chain] = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!SCRIPT.test(file) || file.endsWith(".d.ts") || file.endsWith(".d.mts") || file.endsWith(".d.cts")) continue;
    const { specifiers, requireUses } = scanModule(readFileSync(file, "utf8"), file);
    if (requireUses > 0 && isEsm(file, pkg))
      violations.push({ kind: "require", file: rel(file), chain, detail: "ES module calls require()" });
    for (const { spec } of specifiers) {
      if (isNodeBuiltin(spec)) {
        violations.push({ kind: "node-builtin", file: rel(file), chain, detail: `imports ${spec}` });
        continue;
      }
      let target = null;
      if (spec.startsWith(".")) {
        target = resolveFile(resolve(dirname(file), spec), consumer);
      } else if (spec.startsWith("#")) {
        const mapped = resolveImportsField(pkg, spec, conditions);
        if (typeof mapped === "string") target = resolveFile(resolve(packageDir, mapped), consumer);
        else if (mapped === NO_MATCH) {
          violations.push({ kind: "unresolved", file: rel(file), chain, detail: `${spec} has no target for ${consumer}` });
          continue;
        }
      } else {
        continue; // another package: checked on its own entries
      }
      if (target == null) {
        if (spec.startsWith(".") || spec.startsWith("#"))
          violations.push({ kind: "unresolved", file: rel(file), chain, detail: `cannot resolve ${spec}` });
        continue;
      }
      queue.push([target, [...chain, rel(target)]]);
    }
  }
  return violations;
}

/**
 * Check every export entry of one package. `requireBuilt` turns a missing
 * built target into a violation instead of a skipped pass.
 */
export function checkPackageEntries(packageDir, { requireBuilt = false } = {}) {
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const violations = [];
  const skipped = [];
  let checked = 0;
  for (const [subpath, target] of Object.entries(exportsMap(pkg))) {
    if (subpath.includes("*") || subpath === "./package.json") continue;
    for (const [consumer, base] of Object.entries(CONSUMERS)) {
      const sourceConditions = [SOURCE_CONDITION, ...base];
      const built = resolveConditional(target, base);
      const source = resolveConditional(target, sourceConditions);
      const passes = [];
      if (typeof source === "string" && source !== built) passes.push({ resolved: source, conditions: sourceConditions, fromSource: true });
      if (typeof built === "string") passes.push({ resolved: built, conditions: base, fromSource: built === source });
      for (const { resolved, conditions, fromSource } of passes) {
        const label = `${pkg.name}${subpath === "." ? "" : subpath.slice(1)} [${consumer}${fromSource && source !== built ? ", source" : ""}]`;
        const file = resolve(packageDir, resolved);
        if (!isFile(file)) {
          // A source file must exist; a built one only after a build.
          if (requireBuilt || fromSource) violations.push({ entry: label, kind: "missing", file: resolved, chain: [], detail: "export target does not exist" });
          else skipped.push(`${label} -> ${resolved}`);
          continue;
        }
        checked++;
        for (const violation of walkEntry(packageDir, pkg, file, consumer, conditions)) violations.push({ entry: label, ...violation });
      }
    }
  }
  return { name: pkg.name, checked, violations, skipped };
}

export function listWorkspacePackages(root) {
  const dir = join(root, "packages");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isFile(join(dir, entry.name, "package.json")))
    .map((entry) => join(dir, entry.name));
}

export function formatViolation(v) {
  return `${v.entry}: ${v.file} ${v.detail}${v.chain.length > 1 ? `\n    via ${v.chain.join(" -> ")}` : ""}`;
}
