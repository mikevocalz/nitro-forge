// Derives the v1 component-acceptance scope (owner decision D2, 2026-11-23)
// from source: which component-ledger rows a studio or lab actually renders.
//
//   node tooling/derive-v1-component-scope.mjs          write the output
//   node tooling/derive-v1-component-scope.mjs --check  fail if it is stale
//
// The rule, in order:
// 1. Studios and labs are the workspaces under apps/ and examples/ whose
//    package.json lists `react` in dependencies. They render a UI; a
//    workspace without React (apps/console, the nf-cli demo) does not.
// 2. Entries are the package.json `main` file, `expo-router/entry`'s app/
//    directory, `<script type="module" src>` in index.html, and any top-level
//    script that calls registerRootComponent (alternate acceptance entries).
// 3. A file is reachable when an entry imports it through relative paths or
//    workspace packages, i.e. `@nitro-forge/*` here (static, dynamic, require and
//    re-exports; every .native/.ios/.android/.web variant counts, since the
//    v1 platforms are iOS, Android and web). Tests and node verify scripts
//    are only in scope if an entry imports them.
// 4. A PascalCase binding whose origin is an `@nyc-tron/*` module (directly,
//    under an alias, through a namespace or through workspace re-exports) is
//    used when a reachable file renders it as JSX or passes it as a component
//    value (the Studio UI component table, host parts, props). Renders of a
//    Studio UI slot (`useComponents().Name`) count for the row named Name.
// 5. A used binding maps to the ledger row with the same name; failing that,
//    to the rows whose Tron source file is the imported module. Bindings that
//    match neither are listed under `unmapped`, never dropped.
//
// Source is scanned lexically (comments stripped, no type checker), so the
// output is evidence for reviewers, not a proof of runtime rendering.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_PLATFORMS, tronSourcePath } from "./verify-component-program.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SCANNED_ROOTS = Object.freeze(["apps", "examples", "packages"]);
export const LEDGER_PATH = "docs/completion/library-progress.json";
export const OUTPUT_PATH = "docs/completion/v1-component-scope.json";
export const V1_PLATFORMS = Object.freeze(["ios", "android", "web"]);
export const POST_V1_PLATFORMS = Object.freeze(REQUIRED_PLATFORMS.filter(platform => !V1_PLATFORMS.includes(platform)));
export const RULE = Object.freeze({
  studiosAndLabs: "Workspaces under apps/ and examples/ whose package.json lists react in dependencies.",
  entries: "package.json main (expo-router/entry means every file under app/), index.html module scripts, and top-level scripts that call registerRootComponent.",
  reachability: "Files imported from an entry through relative paths or scanned workspace packages (@nitro-forge/*), following static, dynamic, require and re-export edges and every .native/.ios/.android/.web variant.",
  usage: "A PascalCase binding that originates in an @nyc-tron/* module (alias, namespace or workspace re-export) and is rendered as JSX or passed as a component value in a reachable file; renders of a Studio UI slot (useComponents().Name) count for Name.",
  mapping: "Same-named ledger row first; otherwise the rows whose Tron source file is the imported module. Anything else is listed under unmapped.",
});

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts"];
const PLATFORM_INFIXES = ["", ".native", ".ios", ".android", ".web"];
const JSX_EXTENSIONS = new Set([".tsx", ".jsx", ".js"]);
const PASCAL = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/;
const toPosix = path => path.split(sep).join("/");

/**
 * Blank out comments, keeping every newline so match offsets keep their line.
 * Quote tracking resets per line: JSX text such as `Don't` must not open a
 * string that swallows the rest of the file.
 * @param {string} text
 * @returns {string}
 */
export function stripComments(text) {
  let out = "", block = false;
  for (const line of text.split("\n")) {
    let quote = "", result = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i], next = line[i + 1];
      if (block) {
        if (c === "*" && next === "/") { block = false; result += "  "; i++; } else result += " ";
      } else if (quote) {
        result += c;
        if (c === "\\") { result += next ?? ""; i++; } else if (c === quote) quote = "";
      } else if (c === "/" && next === "*") { block = true; result += "  "; i++; }
      else if (c === "/" && next === "/") { result += " ".repeat(line.length - i); break; }
      else { if (c === "'" || c === "\"" || c === "`") quote = c; result += c; }
    }
    out += result + "\n";
  }
  return out.slice(0, -1);
}

/**
 * @typedef {{ local: string, imported: string, typeOnly: boolean }} Binding
 * @typedef {{ spec: string, line: number, bindings: Binding[] }} ImportRecord
 * @typedef {{ spec: string, star: boolean, names: { imported: string, exported: string }[] }} ReExport
 * @typedef {{ imports: ImportRecord[], reexports: ReExport[], localExports: { local: string, exported: string }[],
 *   declaredExports: Map<string, string>, edges: string[], skip: [number, number][], text: string, lineStarts: number[] }} ModuleInfo
 */

/** @param {string} list @param {boolean} typeOnly @returns {Binding[]} */
function namedList(list, typeOnly) {
  return list.split(",").map(part => part.trim()).filter(Boolean).map(part => {
    const itemType = /^type\s+/.test(part);
    const [imported, local = imported] = part.replace(/^type\s+/, "").split(/\s+as\s+/).map(value => value.trim());
    return { imported, local, typeOnly: typeOnly || itemType };
  });
}

/**
 * Parse the import/export surface of one module from comment-stripped text.
 * @param {string} source
 * @returns {ModuleInfo}
 */
export function parseModule(source) {
  const text = stripComments(source);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  /** @type {ModuleInfo} */
  const info = { imports: [], reexports: [], localExports: [], declaredExports: new Map(), edges: [], skip: [], text, lineStarts };
  const lineAt = index => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1; } return lo + 1; };
  for (const m of text.matchAll(/\bimport\s+(type\s+)?([\w$*{}\s,]+?)\s+from\s*(['"])([^'"\n]+)\3/g)) {
    const typeOnly = Boolean(m[1]), clause = m[2].trim(), bindings = [];
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) bindings.push(...namedList(named[1], typeOnly));
    const head = clause.replace(/\{[^}]*\}/, "").split(",").map(part => part.trim()).filter(Boolean);
    for (const part of head) {
      const ns = /^\*\s+as\s+([\w$]+)$/.exec(part);
      if (ns) bindings.push({ imported: "*", local: ns[1], typeOnly });
      else if (/^[\w$]+$/.test(part)) bindings.push({ imported: "default", local: part, typeOnly });
    }
    info.imports.push({ spec: m[4], line: lineAt(m.index), bindings });
    info.edges.push(m[4]);
    info.skip.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/\bimport\s*(['"])([^'"\n]+)\1/g)) info.edges.push(m[2]);
  for (const m of text.matchAll(/\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)) info.edges.push(m[2]);
  for (const m of text.matchAll(/\bexport\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\3/g)) {
    const star = m[2].startsWith("*"), alias = /\*\s+as\s+([\w$]+)/.exec(m[2]);
    const names = star ? (alias ? [{ imported: "*", exported: alias[1] }] : [])
      : namedList(m[2].slice(1, -1), Boolean(m[1])).filter(item => !item.typeOnly).map(item => ({ imported: item.imported, exported: item.local }));
    info.reexports.push({ spec: m[4], star: star && !alias, names });
    info.edges.push(m[4]);
    info.skip.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/\bexport\s+(type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    if (!m[1]) for (const item of namedList(m[2], false)) if (!item.typeOnly) info.localExports.push({ local: item.imported, exported: item.local });
    info.skip.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/\bexport\s+(?:default\s+)?(?:const|let|var|function|class)\s+([\w$]+)/g)) {
    const end = text.indexOf("\nexport ", m.index + 1);
    const body = text.slice(m.index, end < 0 ? text.length : end);
    const slot = /useComponents\(\)\.([\w$]+)/.exec(body);
    info.declaredExports.set(m[1], slot && slot[1] === m[1] ? m[1] : "");
  }
  return info;
}

/**
 * Locations where `local` is used in a module: JSX renders, or component
 * values (not types, closing tags, import/export lists or object keys).
 * @param {ModuleInfo} info @param {string} local @param {boolean} jsxAllowed
 * @returns {{ line: number, kind: "jsx" | "value", member: string }[]}
 */
export function usages(info, local, jsxAllowed) {
  const found = [], { text, skip, lineStarts } = info;
  const lineAt = index => { let line = 0; while (line + 1 < lineStarts.length && lineStarts[line + 1] <= index) line++; return line + 1; };
  const skipped = index => skip.some(([start, end]) => index >= start && index < end);
  const name = local.replace(/\$/g, "\\$");
  for (const m of text.matchAll(new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, "g"))) {
    if (skipped(m.index)) continue;
    const before = text.slice(Math.max(0, m.index - 8), m.index), after = text.slice(m.index + local.length);
    const member = /^\.([\w$]+)/.exec(after)?.[1] ?? "";
    if (/<\s*$/.test(before) && !/<\/\s*$/.test(before)) {
      // `<` after an identifier or bracket is a generic argument, not JSX.
      const lead = text.slice(0, m.index).replace(/<\s*$/, "").slice(-1);
      if (jsxAllowed && !/[\w$)\]]/.test(lead)) found.push({ line: lineAt(m.index), kind: "jsx", member });
      continue;
    }
    if (/<\/\s*$/.test(before) || /(?:typeof|const|let|var|function|class)\s+$/.test(before)) continue;
    if (/^\s*:(?!:)/.test(after) && /[{,]\s*$/.test(text.slice(0, m.index))) continue;
    if (/^\s*[<]/.test(after) && /(?:type|interface)\s+$/.test(before)) continue;
    found.push({ line: lineAt(m.index), kind: "value", member });
  }
  return found;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : SOURCE_EXTENSIONS.some(ext => entry.name.endsWith(ext)) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** Every existing platform variant of a module path, or its index. */
function variants(base) {
  const hits = [];
  if (existsSync(base) && statSync(base).isFile()) hits.push(base);
  const stem = base.replace(/\.(?:[cm]?[jt]sx?)$/, "");
  for (const candidate of [stem, join(stem, "index")]) {
    for (const infix of PLATFORM_INFIXES) for (const ext of SOURCE_EXTENSIONS) {
      const path = candidate + infix + ext;
      if (existsSync(path) && statSync(path).isFile() && !hits.includes(path)) hits.push(path);
    }
    if (hits.length) break;
  }
  return hits;
}

/** @param {unknown} value @returns {string[]} */
function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  const entries = Object.entries(value), runtime = entries.filter(([key]) => key !== "types");
  return (runtime.length ? runtime : entries).flatMap(([, target]) => exportTargets(target));
}

/**
 * Discover workspaces, studios/labs, reachable files and Tron component use.
 * @param {{ rootDir?: string, ledger: { components: { id: string, name: string, sourceCandidates: string[] }[], additions: { id: string, name: string, sourceCandidates: string[] }[] } }} options
 */
export function deriveScope({ rootDir = repoRoot, ledger }) {
  /** @type {Map<string, { dir: string, manifest: Record<string, unknown> }>} */
  const workspaces = new Map();
  for (const scanRoot of SCANNED_ROOTS) {
    const base = join(rootDir, scanRoot);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true }).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = join(base, entry.name), manifestPath = join(dir, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name === "string") workspaces.set(manifest.name, { dir, manifest });
    }
  }
  const rel = path => toPosix(relative(rootDir, path));
  /** @type {Map<string, ModuleInfo>} */
  const modules = new Map();
  const moduleOf = file => {
    let info = modules.get(file);
    if (!info) { info = parseModule(readFileSync(file, "utf8")); modules.set(file, info); }
    return info;
  };
  /** @returns {string[] | null} files, or null for a module outside the workspace graph */
  const resolveSpec = (from, spec) => {
    if (spec.startsWith(".")) return variants(resolve(dirname(from), spec));
    const m = /^((?:@[^/]+\/)?[^/.][^/]*)(?:\/(.+))?$/.exec(spec);
    const workspace = m && workspaces.get(m[1]);
    if (!workspace) return null;
    const key = m[2] ? "./" + m[2] : ".";
    const exportsMap = workspace.manifest.exports;
    let targets = [];
    if (typeof exportsMap === "string" || Array.isArray(exportsMap)) targets = key === "." ? exportTargets(exportsMap) : [];
    else if (exportsMap && typeof exportsMap === "object") targets = exportTargets(/** @type {Record<string, unknown>} */ (exportsMap)[key]);
    if (!targets.length && key === "." && typeof workspace.manifest.main === "string") targets = [workspace.manifest.main];
    if (!targets.length && m[2]) targets = [m[2]];
    return [...new Set(targets.flatMap(target => variants(resolve(workspace.dir, target))))];
  };

  const studios = [];
  for (const [name, { dir, manifest }] of workspaces) {
    const dependencies = /** @type {Record<string, string>} */ (manifest.dependencies ?? {});
    const top = rel(dir).split("/")[0];
    if (!["apps", "examples"].includes(top) || !dependencies.react) continue;
    const entries = new Set();
    if (manifest.main === "expo-router/entry") walk(join(dir, "app")).forEach(file => entries.add(file));
    else if (typeof manifest.main === "string") variants(resolve(dir, manifest.main)).forEach(file => entries.add(file));
    const html = join(dir, "index.html");
    if (existsSync(html)) {
      for (const m of readFileSync(html, "utf8").matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) variants(join(dir, m[1].replace(/^\//, ""))).forEach(file => entries.add(file));
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isFile() && SOURCE_EXTENSIONS.some(ext => entry.name.endsWith(ext)) && /\bregisterRootComponent\s*\(/.test(stripComments(readFileSync(file, "utf8")))) entries.add(file);
    }
    studios.push({ name, dir, entries: [...entries].sort() });
  }

  const reachable = new Set();
  const queue = studios.flatMap(studio => studio.entries);
  while (queue.length) {
    const file = queue.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const spec of moduleOf(file).edges) for (const next of resolveSpec(file, spec) ?? []) if (!reachable.has(next)) queue.push(next);
  }

  /**
   * Origin of an exported name: a Tron module binding, a Studio UI slot, or null.
   * @returns {{ tron: { spec: string, name: string } } | { slot: string } | null}
   */
  const exportOrigin = (file, name, seen = new Set()) => {
    const key = file + "#" + name;
    if (seen.has(key)) return null;
    seen.add(key);
    const info = moduleOf(file);
    for (const reexport of info.reexports) {
      const hit = reexport.names.find(item => item.exported === name);
      const imported = hit ? hit.imported : reexport.star && name !== "default" ? name : null;
      if (imported === null) continue;
      if (reexport.spec.startsWith("@nyc-tron/")) return { tron: { spec: reexport.spec, name: imported } };
      for (const next of resolveSpec(file, reexport.spec) ?? []) {
        const origin = exportOrigin(next, imported, seen);
        if (origin) return origin;
      }
    }
    const local = info.localExports.find(item => item.exported === name);
    if (local) return bindingOrigin(file, local.local, seen);
    const slot = info.declaredExports.get(name);
    return slot ? { slot } : null;
  };
  const bindingOrigin = (file, local, seen = new Set()) => {
    for (const record of moduleOf(file).imports) {
      const binding = record.bindings.find(item => item.local === local && !item.typeOnly);
      if (!binding) continue;
      if (record.spec.startsWith("@nyc-tron/")) return { tron: { spec: record.spec, name: binding.imported } };
      for (const next of resolveSpec(file, record.spec) ?? []) {
        const origin = exportOrigin(next, binding.imported, seen);
        if (origin) return origin;
      }
    }
    return null;
  };

  // Ledger lookups: by row name, and by Tron source module (extension and
  // platform suffix removed, so `NativeSeekBar.native.tsx` matches the import).
  const rows = [...ledger.components, ...ledger.additions];
  const byName = new Map(rows.map(row => [row.name, row]));
  /** @type {Map<string, Set<string>>} */
  const byModule = new Map();
  const moduleKey = path => path.replace(/\.(?:[cm]?[jt]sx?)$/, "").replace(/\.(?:native|ios|android|web|shared|unsupported)$/, "").replace(/\/index$/, "");
  for (const row of rows) for (const url of row.sourceCandidates) {
    const key = moduleKey(tronSourcePath(url, "packages"));
    if (!byModule.has(key)) byModule.set(key, new Set());
    byModule.get(key)?.add(row.id);
  }
  const specModule = spec => {
    const m = /^@nyc-tron\/([^/]+)(?:\/(.+))?$/.exec(spec);
    return m ? moduleKey(`packages/${m[1]}/src${m[2] ? "/" + m[2] : ""}`) : "";
  };

  /** @type {Map<string, { id: string, name: string, uses: Map<string, { at: string, kind: string, binding: string, module: string, via: string }> }>} */
  const inScope = new Map();
  /** @type {Map<string, { name: string, module: string, uses: Set<string> }>} */
  const unmapped = new Map();
  const record = (name, spec, use) => {
    const ids = byName.has(name) ? [/** @type {{ id: string }} */ (byName.get(name)).id] : [...(byModule.get(specModule(spec)) ?? [])].sort();
    const via = byName.has(name) ? "name" : "module";
    if (!ids.length) {
      const key = spec + "#" + name;
      if (!unmapped.has(key)) unmapped.set(key, { name, module: spec, uses: new Set() });
      unmapped.get(key)?.uses.add(use.at);
      return;
    }
    for (const id of ids) {
      const row = /** @type {{ id: string, name: string }} */ (rows.find(item => item.id === id));
      if (!inScope.has(id)) inScope.set(id, { id, name: row.name, uses: new Map() });
      inScope.get(id)?.uses.set(use.at + " " + use.kind + " " + use.binding, { ...use, module: spec, via });
    }
  };

  for (const file of [...reachable].sort()) {
    const info = moduleOf(file);
    const jsx = JSX_EXTENSIONS.has(file.slice(file.lastIndexOf(".")));
    const locals = new Set(info.imports.flatMap(item => item.bindings.filter(binding => !binding.typeOnly).map(binding => binding.local)));
    /** @type {{ local: string, origin: ReturnType<typeof bindingOrigin> }[]} */
    const work = [...locals].sort().map(local => ({ local, origin: bindingOrigin(file, local) }));
    const seen = new Set(locals);
    while (work.length) {
      const { local, origin } = /** @type {{ local: string, origin: ReturnType<typeof bindingOrigin> }} */ (work.shift());
      if (!origin) continue;
      for (const use of usages(info, local, jsx)) {
        const at = `${rel(file)}:${use.line}`;
        if ("slot" in origin) {
          if (use.kind === "jsx" && byName.has(origin.slot)) record(origin.slot, "", { at, kind: "slot", binding: local });
          continue;
        }
        const name = origin.tron.name === "*" ? use.member : origin.tron.name === "default" ? local : origin.tron.name;
        if (!PASCAL.test(name)) continue;
        record(name, origin.tron.spec, { at, kind: use.kind, binding: local });
      }
      // Same-file aliases (`const Scoped = Tron.PenNodeEditor as ...`) render the same component.
      if ("slot" in origin) continue;
      const escaped = local.replace(/\$/g, "\\$");
      for (const m of info.text.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([\\w$]+)\\s*(?::[^=\\n]+)?=\\s*${escaped}(?:\\.([\\w$]+))?(?![\\w$.(])`, "g"))) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const name = origin.tron.name === "*" ? m[2] ?? "*" : m[2] ? "" : origin.tron.name;
        if (name) work.push({ local: m[1], origin: { tron: { spec: origin.tron.spec, name } } });
      }
    }
  }

  const sortAt = (a, b) => {
    const [fa, la] = a.split(/:(?=\d+$)/), [fb, lb] = b.split(/:(?=\d+$)/);
    return fa === fb ? Number(la) - Number(lb) : fa < fb ? -1 : 1;
  };
  const scope = [...inScope.values()].sort((a, b) => a.id.localeCompare(b.id)).map(row => ({
    id: row.id, name: row.name,
    renders: [...row.uses.values()].sort((a, b) => sortAt(a.at, b.at) || a.kind.localeCompare(b.kind) || a.binding.localeCompare(b.binding))
      .map(use => ({ at: use.at, kind: use.kind, binding: use.binding, ...(use.module ? { module: use.module } : {}), mappedBy: use.via })),
  }));
  const scopeIds = new Set(scope.map(row => row.id));
  return {
    studiosAndLabs: studios.sort((a, b) => a.name.localeCompare(b.name)).map(studio => ({ name: studio.name, dir: rel(studio.dir), entries: studio.entries.map(rel) })),
    reachableFiles: reachable.size,
    inScope: scope,
    unmapped: [...unmapped.values()].sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name))
      .map(item => ({ name: item.name, module: item.module, uses: [...item.uses].sort(sortAt) })),
    postV1Rows: rows.map(row => row.id).filter(id => !scopeIds.has(id)).sort(),
    rowCount: rows.length,
  };
}

/** The committed document: inputs, rule, in-scope rows and post-v1 labels. */
export function buildDocument({ rootDir = repoRoot, ledgerPath = LEDGER_PATH } = {}) {
  const ledger = JSON.parse(readFileSync(join(rootDir, ledgerPath), "utf8"));
  const derived = deriveScope({ rootDir, ledger });
  return {
    schemaVersion: 1,
    decision: "D2, 2026-11-23: F7 component acceptance for v1 covers iOS, Android and web for every ledger row a studio or lab renders. Every other row, and the macOS, Windows, visionOS, Quest and PICO columns of every row, stay in the ledger as NOT RUN, post-v1.",
    generator: "tooling/derive-v1-component-scope.mjs",
    inputs: { ledger: ledgerPath, scannedRoots: [...SCANNED_ROOTS] },
    rule: RULE,
    studiosAndLabs: derived.studiosAndLabs,
    reachableFiles: derived.reachableFiles,
    v1: { platforms: [...V1_PLATFORMS], rowCount: derived.inScope.length, rows: derived.inScope },
    unmapped: derived.unmapped,
    postV1: {
      label: "post-v1",
      status: "NOT RUN",
      platforms: [...POST_V1_PLATFORMS],
      platformsApplyTo: "every ledger row, including the v1 rows above",
      rowCount: derived.postV1Rows.length,
      rows: derived.postV1Rows,
    },
    ledgerRowCount: derived.rowCount,
  };
}

/** @param {{ rootDir?: string, check?: boolean }} [options] @returns {{ ok: boolean, message: string }} */
export function run({ rootDir = repoRoot, check = false } = {}) {
  const document = buildDocument({ rootDir });
  const bytes = JSON.stringify(document, null, 2) + "\n";
  const target = join(rootDir, OUTPUT_PATH);
  const summary = `${document.v1.rowCount} v1 rows from ${document.studiosAndLabs.length} studios/labs (${document.reachableFiles} reachable files); ${document.postV1.rowCount} post-v1 rows; ${document.unmapped.length} unmapped Tron names.`;
  if (check) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    return current === bytes ? { ok: true, message: `${OUTPUT_PATH} is current: ${summary}` }
      : { ok: false, message: `${OUTPUT_PATH} is stale; run node tooling/derive-v1-component-scope.mjs and commit the result.` };
  }
  writeFileSync(target, bytes);
  return { ok: true, message: `Wrote ${OUTPUT_PATH}: ${summary}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--check")) {
    console.error("usage: node tooling/derive-v1-component-scope.mjs [--check]");
    process.exitCode = 2;
  } else {
    const result = run({ check: args.includes("--check") });
    (result.ok ? console.log : console.error)(result.message);
    if (!result.ok) process.exitCode = 1;
  }
}
