// Radius check for Forge UI sources (design/DIRECTION.md, "Owner brief and
// view radius rule"). Every rounded view is `rounded-sm` (4 px, inner views and
// controls) or `rounded-md` (6 px, outer views), taken from the one token
// definition in packages/studio-workspace/src/theme.ts.
//
//   node tooling/check-radius.mjs            prints file:line:rule, exits 1 on any violation
//   node tooling/check-radius.mjs --json     prints a per-package inventory as JSON (same exit code)
//   node tooling/check-radius.mjs --report   prints violations, exits 0 (prerelease reporting)
//   node tooling/check-radius.mjs --root DIR checks another tree (used by the tests)
//
// It scans the TS, JS, CSS and HTML sources under the roots in
// tooling/source-roots.mjs (apps, examples, packages).
//
// Rules
//   token-definition   theme.ts must define `forgeRadius = { sm: 4, md: 6 }` once,
//                      `workspaceScale.radius.*` must each be `forgeRadius.sm` or `.md`,
//                      every `forgeHairlineRadius` value must be below 4, and each
//                      generated sheet must match a fresh build-theme.mjs run and hold
//                      exactly the expected `--radius-*` names and values
//   rounded-scale      a `rounded-xs`, `rounded-lg` or larger class, any side or corner
//                      variant (rounded-t-xl, rounded-tl-2xl, ...)
//   rounded-arbitrary  an arbitrary `rounded-[...]` class
//   rounded-dynamic    a class built at run time: `rounded-${size}`, 'rounded-' + size
//   rounded-full       `rounded-full` without an exemption marker
//   radius-variable    a `--radius-*` custom property defined with its own number outside
//                      the token files (per-app radius variables), or `var(--radius-*)`
//                      naming a variable the token files do not define
//   raw-radius         a literal radius: `borderRadius: 8`, `'borderTopLeftRadius': '50%'`,
//                      `"border-radius": "8px"`, `el.style.borderRadius = '10px'`,
//                      `cornerRadius={4}`, `cornerRadius="8"`, CSS `border-radius: 4px`
//   radius-arithmetic  a radius computed with a number (`scale.radius.control + 2`,
//                      `size / 2`) or mixing a token with a number in CSS
//   radius-identifier  a radius taken from anything but `forgeRadius.*`,
//                      `forgeHairlineRadius.*`, `scale.radius.*` or `workspaceScale.radius.*`
//
// A literal 0 is square and always passes, as do the CSS-wide keywords and CSS
// shorthand made only of 0 and token var() parts. A ternary passes when every
// branch does.
//
// Exemption marker. DIRECTION.md allows `rounded-full` only for shapes circular
// by nature, and exempts shapes the operating system owns and shapes drawn on a
// document or sample artboard. A call site claims one of those exemptions with
// a comment on the same line or the line above:
//
//   // radius-exempt: knob
//   {/* radius-exempt: colour-well */}
//   /* radius-exempt: system-sheet */      (CSS)
//   <!-- radius-exempt: artwork -->        (HTML)
//
// The marker counts only in comment text, never inside a string. Each marker
// excuses exactly one violation of `rounded-full`, `raw-radius`,
// `radius-arithmetic` or `radius-identifier`, preferring one on its own line,
// then one on the next line. It never excuses lg-or-larger, arbitrary or dynamic
// classes, or radius variables. A marker naming a kind DIRECTION.md does not
// list fails as `exemption-kind`; a marker that excuses nothing fails as
// `exemption-unused`.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SCANNED_ROOTS } from "./source-roots.mjs";

export { SCANNED_ROOTS };

export const EXEMPTION_KINDS = Object.freeze([
  // circular by nature
  "knob", "colour-well", "radio", "avatar", "record-button",
  // owned by the operating system
  "window", "system-sheet", "launcher-icon-mask",
  // shapes drawn on a document or sample artboard (owner decision D6)
  "artwork",
]);

/** The token definition and the files generated from it. Paths are repository-relative. */
export const TOKEN_FILES = Object.freeze([
  "packages/studio-workspace/src/theme.ts",
  "packages/studio-workspace/build-theme.mjs",
  "packages/studio-workspace/src/theme.css",
  "packages/studio-workspace/src/theme.native.css",
  "packages/studio-workspace/src/radius.css",
]);
const [THEME_FILE, BUILD_FILE] = TOKEN_FILES;
const GENERATED_SHEETS = TOKEN_FILES.filter(file => file.endsWith(".css"));

const SOURCE_EXTENSIONS = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs|css|html)$/;
// Not product UI: dependencies, build output, generated native projects, and
// tests or fixtures (they assert on radius values and render nothing shipped).
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".expo", ".turbo", "ios", "android", "generated", "tests", "__tests__", "fixtures", "tooling", "rust", "target"]);
const SKIP_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;

const SIDE = "(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee)";
const ROUNDED = new RegExp(`(?<![\\w-])rounded-(?:${SIDE}-)?(xs|lg|xl|[2-9]xl|full|\\[[^\\]\\s]*\\])(?![\\w-])`, "g");
const ROUNDED_DYNAMIC = /(?<![\w-])rounded-(?:\$\{|['"`]\s*\+)/g;
const RADIUS_NAME = "border(?:Top|Bottom|Start|End)?(?:Left|Right|Start|End)?Radius|(?:sheet)?[cC]ornerRadius";
const KEBAB_RADIUS = "border(?:-(?:top|bottom|start|end))?(?:-(?:left|right|start|end))?-radius";
const JS_RADIUS_KEY = new RegExp(`(['"]?)(?<![\\w$-])(${RADIUS_NAME}|${KEBAB_RADIUS})\\1\\s*(:|=(?![=>]))\\s*`, "g");
const CSS_RADIUS_PROP = new RegExp(`(?<![\\w-])(${KEBAB_RADIUS})\\s*:\\s*([^;}"']+)`, "g");
const NUMBER = /(?<![\w.$])\d+(?:\.\d+)?|(?<![\w$])\.\d+/;
const MARKER = /radius-exempt:\s*([\w-]+)/g;
const ALLOWED_REF = /^(?:forgeRadius\.(?:sm|md)|forgeHairlineRadius\.\w+|(?:workspaceScale|scale)\.radius\.\w+)$/;
const TYPE_WORDS = new Set(["number", "string", "undefined", "null", "DimensionValue", "AnimatableNumericValue"]);
const CSS_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/**
 * Splits source into code and comments, keeping line breaks and columns. `code`
 * has comments blanked; `comments` has everything but comment text blanked.
 * `mode` is "js", "css" or "html".
 */
export function splitComments(source, mode = "js") {
  let code = "", comments = "";
  const keep = text => { code += text; comments += text.replace(/[^\n]/g, " "); };
  const drop = text => { code += text.replace(/[^\n]/g, " "); comments += text; };
  let i = 0;
  const stack = [];
  const n = source.length;
  while (i < n) {
    const c = source[i], d = source[i + 1];
    const top = stack[stack.length - 1];
    if (top === "'" || top === '"') {
      if (c === "\\") { keep(source.slice(i, i + 2)); i += 2; continue; }
      if (c === top || c === "\n") stack.pop();
      keep(c); i++; continue;
    }
    if (top === "`") {
      if (c === "\\") { keep(source.slice(i, i + 2)); i += 2; continue; }
      if (c === "`") stack.pop();
      else if (c === "$" && d === "{") { keep("${"); stack.push("${"); i += 2; continue; }
      keep(c); i++; continue;
    }
    if (mode === "html" && source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      const stop = end === -1 ? n : end + 3;
      drop(source.slice(i, stop)); i = stop; continue;
    }
    if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      drop(source.slice(i, stop)); i = stop; continue;
    }
    if (mode === "js" && c === "/" && d === "/") {
      let stop = source.indexOf("\n", i);
      if (stop === -1) stop = n;
      drop(source.slice(i, stop)); i = stop; continue;
    }
    if (mode === "js" && (c === "'" || c === '"' || c === "`")) { stack.push(c); keep(c); i++; continue; }
    if (top === "${" || top === "{") {
      if (c === "{") stack.push("{");
      else if (c === "}") stack.pop();
    }
    keep(c); i++;
  }
  return { code, comments };
}

/** Code with comments blanked. */
export function stripComments(source, css = false) {
  return splitComments(source, css ? "css" : "js").code;
}

/** Reads one JS value expression starting at `start`: up to a depth-0 `,` `;` `}` `)` or newline. */
function readValue(code, start, braced) {
  const q = code[start];
  if (!braced && (q === "'" || q === '"')) {
    let i = start + 1;
    while (i < code.length && code[i] !== q && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
    return code.slice(start, i + 1);
  }
  let depth = 0, i = start, quote = null;
  for (; i < code.length; i++) {
    const c = code[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && !braced && (c === "," || c === ";" || c === "\n")) break;
  }
  return code.slice(start, i).trim();
}

/** Splits `cond ? a : b` at depth 0. Returns null when the value is not a ternary. */
function ternary(v) {
  let depth = 0, question = -1, nested = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && c === "?" && v[i + 1] !== "." && v[i + 1] !== "?" && v[i - 1] !== "?") {
      if (question === -1) question = i; else nested++;
    } else if (depth === 0 && c === ":" && question !== -1) {
      if (nested) nested--;
      else return [v.slice(question + 1, i).trim(), v.slice(i + 1).trim()];
    }
  }
  return null;
}

/** Classifies a CSS radius value: null when it passes, otherwise the rule it breaks. */
export function classifyCssValue(value) {
  const v = value.replace(/!important/, "").trim();
  if (CSS_KEYWORDS.has(v)) return null;
  const parts = v.split(/\s+|\s*\/\s*/).filter(Boolean);
  if (parts.every(part => /^0(?:px|%|rem|em)?$/.test(part) || /^var\(--radius-[\w-]+\)$/.test(part))) return null;
  return /var\(--radius-/.test(v) ? "radius-arithmetic" : "raw-radius";
}

/** Classifies a JS radius value: null when it passes, otherwise the rule it breaks. */
export function classifyJsValue(value) {
  let v = value.trim();
  while (/^\(.*\)$/s.test(v)) v = v.slice(1, -1).trim();
  v = v.replace(/\s+as\s+[\w.]+$/, "").replace(/\s*\/\*.*\*\/\s*$/, "").trim();
  if (v === "" || /^0(?:\.0+)?$/.test(v) || TYPE_WORDS.has(v)) return null;
  const branches = ternary(v);
  if (branches) {
    for (const branch of branches) {
      const rule = classifyJsValue(branch);
      if (rule) return rule;
    }
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(v) || /^-?\.\d+$/.test(v)) return "raw-radius";
  const string = /^(['"])(.*)\1$/s.exec(v);
  if (string) return classifyCssValue(string[2]);
  if (/^`[^`]*`$/s.test(v)) {
    const parts = [...v.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1].trim());
    const text = v.slice(1, -1).replace(/\$\{[^}]*\}/g, "");
    if (NUMBER.test(text)) return "radius-arithmetic";
    return parts.every(part => ALLOWED_REF.test(part)) ? null : "radius-identifier";
  }
  if (/^\{[\s\S]*\}$/.test(v)) return NUMBER.test(v) ? "raw-radius" : "radius-identifier"; // a config object
  if (NUMBER.test(v.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''"))) return "radius-arithmetic";
  return ALLOWED_REF.test(v) ? null : "radius-identifier";
}

/** Radius variable names the token files define, e.g. `radius-sm`. */
export function definedRadiusVariables(rootDir) {
  const names = new Set();
  for (const file of GENERATED_SHEETS) {
    const path = join(rootDir, file);
    if (!existsSync(path)) continue;
    for (const match of readFileSync(path, "utf8").matchAll(/--(radius-[\w-]+)\s*:/g)) names.add(match[1]);
  }
  return names;
}

function modeFor(file) {
  if (file.endsWith(".css")) return "css";
  if (file.endsWith(".html")) return "html";
  return "js";
}

/** Checks one file's text. `file` is repository-relative with `/` separators. */
export function checkSource(file, text, { radiusVariables = new Set() } = {}) {
  const mode = modeFor(file);
  const { code, comments } = splitComments(text, mode);
  const offsets = [];
  let offset = 0;
  for (const line of code.split("\n")) { offsets.push(offset); offset += line.length + 1; }
  const lineAt = index => {
    let lo = 0, hi = offsets.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= index) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const candidates = [];
  const add = (index, rule, detail, exemptable) => candidates.push({ line: lineAt(index), rule, detail, exemptable });

  for (const match of code.matchAll(ROUNDED)) {
    const scale = match[1];
    if (scale === "full") add(match.index, "rounded-full", match[0], true);
    else if (scale.startsWith("[")) add(match.index, "rounded-arbitrary", match[0], false);
    else add(match.index, "rounded-scale", match[0], false);
  }
  for (const match of code.matchAll(ROUNDED_DYNAMIC)) add(match.index, "rounded-dynamic", `${match[0]}...`, false);

  // Radius variables: definitions with their own numbers outside the token files, and references to undefined ones.
  for (const match of code.matchAll(/(?<![\w-])--(radius-[\w-]+)(['"`]?)\s*:\s*([^;\n]*)/g)) {
    const value = match[3].replace(/\s*[,;}]*\s*$/, "");
    if (NUMBER.test(value.replace(/var\(--radius-[\w-]+\)/g, ""))) add(match.index, "radius-variable", `--${match[1]}: ${value}`, false);
  }
  for (const match of code.matchAll(/var\(--(radius-[\w-]+)/g)) {
    if (!radiusVariables.has(match[1])) add(match.index, "radius-variable", `var(--${match[1]}) is not a Forge radius token`, false);
  }

  if (mode !== "js") {
    for (const match of code.matchAll(CSS_RADIUS_PROP)) {
      const rule = classifyCssValue(match[2]);
      if (rule) add(match.index, rule, `${match[1]}: ${match[2].trim()}`, true);
    }
  } else {
    for (const match of code.matchAll(JS_RADIUS_KEY)) {
      let start = match.index + match[0].length;
      const braced = match[3] === "=" && code[start] === "{";
      if (braced) start++;
      const value = readValue(code, start, braced);
      const rule = classifyJsValue(value);
      if (rule) add(match.index, rule, `${match[2]}: ${value}`, true);
    }
  }

  // Markers: comment text only, one violation each.
  const markers = [];
  comments.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(MARKER)) markers.push({ line: index + 1, kind: match[1], used: false });
  });
  const found = [];
  candidates.sort((a, b) => a.line - b.line);
  for (const c of candidates) {
    const marker = c.exemptable
      && (markers.find(m => !m.used && m.line === c.line) ?? markers.find(m => !m.used && m.line === c.line - 1));
    if (!marker) { found.push({ file, line: c.line, rule: c.rule, detail: c.detail }); continue; }
    marker.used = true;
    if (!EXEMPTION_KINDS.includes(marker.kind)) {
      found.push({ file, line: c.line, rule: "exemption-kind", detail: `"${marker.kind}" is not an exemption DIRECTION.md lists` });
    }
  }
  for (const m of markers.filter(m => !m.used)) {
    found.push({ file, line: m.line, rule: "exemption-unused", detail: `radius-exempt: ${m.kind} excuses nothing` });
  }
  return found.sort((a, b) => a.line - b.line);
}

function* walk(dir, rootDir) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full, rootDir);
    } else if (SOURCE_EXTENSIONS.test(name) && !SKIP_FILE.test(name)) {
      yield relative(rootDir, full).split(sep).join("/");
    }
  }
}

/** `name: value` pairs inside the first `{ ... }` after `head`, or null when `head` is absent. */
function objectEntries(text, head) {
  const at = text.indexOf(head);
  if (at === -1) return null;
  const body = /\{([^{}]*)\}/.exec(text.slice(at + head.length));
  if (!body) return null;
  return body[1].split(",").map(part => part.trim()).filter(Boolean).map(part => part.split(":").map(s => s.trim()));
}

/** `--radius-*` declarations in a sheet, as `name: value` strings. */
function sheetRadii(text) {
  return [...text.matchAll(/--(radius-[\w-]+)\s*:\s*([^;]+);/g)].map(m => `${m[1]}: ${m[2].trim()}`);
}

/** Checks the token definition, the role names over it and the generated sheets. */
export function checkTokens(rootDir) {
  const found = [];
  const fail = (file, detail) => found.push({ file, line: 1, rule: "token-definition", detail });
  const themePath = join(rootDir, THEME_FILE);
  if (!existsSync(themePath)) { fail(THEME_FILE, "missing token file"); return found; }
  const theme = readFileSync(themePath, "utf8");

  const definitions = [...theme.matchAll(/export const forgeRadius\s*=\s*\{([^}]*)\}/g)];
  if (definitions.length !== 1 || !/^\s*sm:\s*4,\s*md:\s*6\s*$/.test(definitions[0][1])) {
    fail(THEME_FILE, "expected exactly one `export const forgeRadius = { sm: 4, md: 6 }`");
  }
  const hairlines = objectEntries(theme, "export const forgeHairlineRadius") ?? [];
  for (const [name, value] of hairlines) {
    const number = Number(value);
    if (!(number > 0 && number < 4)) fail(THEME_FILE, `forgeHairlineRadius.${name} is ${value}; hairline radii must be above 0 and below 4`);
  }
  const roles = objectEntries(theme.slice(Math.max(0, theme.indexOf("export const workspaceScale"))), "radius:");
  if (!roles || !roles.length) fail(THEME_FILE, "workspaceScale.radius is missing");
  for (const [name, value] of roles ?? []) {
    if (!/^forgeRadius\.(?:sm|md)$/.test(value)) fail(THEME_FILE, `workspaceScale.radius.${name} is ${value}; it must reference forgeRadius.sm or forgeRadius.md`);
  }

  // The sheets must hold exactly the expected radii and match a fresh generator run.
  const expected = ["radius-sm: 4px", "radius-md: 6px", "radius-forge-control: 4px", "radius-control: 4px", "radius-card: 6px"].sort();
  for (const sheet of GENERATED_SHEETS) {
    const path = join(rootDir, sheet);
    if (!existsSync(path)) { fail(sheet, "missing generated sheet; run build-theme.mjs"); continue; }
    const actual = sheetRadii(readFileSync(path, "utf8")).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(sheet, `radius declarations are [${actual.join("; ")}], expected [${expected.join("; ")}]`);
    }
  }
  const buildPath = join(rootDir, BUILD_FILE);
  if (!existsSync(buildPath)) { fail(BUILD_FILE, "missing generator"); return found; }
  const temp = mkdtempSync(join(tmpdir(), "forge-radius-"));
  try {
    const out = join(temp, dirname(BUILD_FILE));
    mkdirSync(join(out, "src"), { recursive: true });
    cpSync(buildPath, join(temp, BUILD_FILE));
    cpSync(themePath, join(temp, THEME_FILE));
    execFileSync(process.execPath, [join(temp, BUILD_FILE)], { cwd: temp, stdio: "pipe" });
    for (const sheet of GENERATED_SHEETS) {
      const fresh = join(temp, sheet);
      const committed = join(rootDir, sheet);
      if (!existsSync(fresh) || !existsSync(committed)) continue;
      if (readFileSync(fresh, "utf8") !== readFileSync(committed, "utf8")) fail(sheet, "differs from a fresh build-theme.mjs run; regenerate it");
    }
  } catch (error) {
    fail(BUILD_FILE, `build-theme.mjs failed: ${String(error.stderr ?? error.message).trim().split("\n")[0]}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return found;
}

/** Runs every rule over the scanned roots under rootDir. */
export function checkRadius(rootDir) {
  const radiusVariables = definedRadiusVariables(rootDir);
  const violations = checkTokens(rootDir);
  const tokenFiles = new Set(TOKEN_FILES);
  const files = [];
  for (const top of SCANNED_ROOTS) {
    const dir = join(rootDir, top);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir, rootDir)) {
      if (tokenFiles.has(file)) continue;
      files.push(file);
      violations.push(...checkSource(file, readFileSync(join(rootDir, file), "utf8"), { radiusVariables }));
    }
  }
  return { files: files.length, violations };
}

/** Per-package counts: `packages/<name>`, `apps/<name>` or `examples/<name>`. */
export function inventory(result) {
  const packages = {};
  for (const v of result.violations) {
    const key = v.file.split("/").slice(0, 2).join("/");
    const entry = packages[key] ??= { count: 0, rules: {}, violations: [] };
    entry.count++;
    entry.rules[v.rule] = (entry.rules[v.rule] ?? 0) + 1;
    entry.violations.push(`${v.file}:${v.line}:${v.rule}`);
  }
  return { filesChecked: result.files, total: result.violations.length, packages };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  let rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let json = false, reportOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--report") reportOnly = true;
    else if (args[i] === "--root" && args[i + 1]) rootDir = resolve(args[++i]);
    else { console.error("usage: node tooling/check-radius.mjs [--json] [--report] [--root <dir>]"); process.exit(2); }
  }
  const result = checkRadius(rootDir);
  if (json) console.log(JSON.stringify(inventory(result), null, 2));
  else {
    for (const v of result.violations) console.log(`${v.file}:${v.line}:${v.rule}  ${v.detail}`);
    console.log(`check-radius: ${result.violations.length} violation(s) in ${result.files} files`);
  }
  if (result.violations.length && !reportOnly) process.exitCode = 1;
}
