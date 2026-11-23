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
// Rules
//   token-definition   theme.ts must export `forgeRadius = { sm: 4, md: 6 }` and the
//                      generated sheets must carry --radius-sm: 4px and --radius-md: 6px
//   rounded-scale      a `rounded-xs`, `rounded-lg` or larger class, any side or corner
//                      variant (rounded-t-xl, rounded-tl-2xl, ...)
//   rounded-arbitrary  an arbitrary `rounded-[...]` class
//   rounded-full       `rounded-full` without an exemption marker
//   radius-variable    a `--radius-*` custom property defined outside the token files
//                      (per-app radius variables), or `var(--radius-*)` naming a
//                      variable the token files do not define
//   raw-radius         a literal radius value: `borderRadius: 8`, `borderTopLeftRadius: '50%'`,
//                      `cornerRadius={4}`, CSS `border-radius: 4px`
//   radius-arithmetic  a radius computed with a numeric literal (`scale.radius.control + 2`,
//                      `size / 2`); the result is a third radius the tokens do not name
//
// A literal 0 is square, not rounded, and always passes.
//
// Exemption marker. DIRECTION.md allows `rounded-full` only for shapes circular
// by nature, and exempts shapes the operating system owns. A call site claims
// one of those exemptions with a comment on the same line or the line above:
//
//   // radius-exempt: knob
//   {/* radius-exempt: colour-well */}
//   /* radius-exempt: system-sheet */      (CSS)
//
// The kind must be one DIRECTION.md lists; anything else is itself a violation
// (rule `exemption-kind`). The marker exempts `rounded-full`, `raw-radius` and
// `radius-arithmetic` on its line; it never exempts lg-or-larger or arbitrary
// classes, or per-app radius variables.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const EXEMPTION_KINDS = Object.freeze([
  // circular by nature
  "knob", "colour-well", "radio", "avatar", "record-button",
  // owned by the operating system
  "window", "system-sheet", "launcher-icon-mask",
]);

/** The token definition and the files generated from it. Paths are repository-relative. */
export const TOKEN_FILES = Object.freeze([
  "packages/studio-workspace/src/theme.ts",
  "packages/studio-workspace/build-theme.mjs",
  "packages/studio-workspace/src/theme.css",
  "packages/studio-workspace/src/theme.native.css",
  "packages/studio-workspace/src/radius.css",
]);
const GENERATED_SHEETS = TOKEN_FILES.filter(file => file.endsWith(".css"));

const SOURCE_EXTENSIONS = /\.(?:tsx?|mts|cts|jsx?|css)$/;
// Not product UI: dependencies, build output, generated native projects, and
// tests or fixtures (they assert on radius values and render nothing shipped).
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".expo", ".turbo", "ios", "android", "generated", "tests", "__tests__", "fixtures", "tooling", "rust", "target"]);
const SKIP_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;

const SIDE = "(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee)";
const ROUNDED = new RegExp(`(?<![\\w-])rounded-(?:${SIDE}-)?(xs|lg|xl|[2-9]xl|full|\\[[^\\]\\s]*\\])(?![\\w-])`, "g");
const JS_RADIUS_KEY = /\b(border(?:Top|Bottom|Start|End)?(?:Left|Right|Start|End)?Radius|(?:sheet)?[cC]ornerRadius)\b\s*(:|=)\s*/g;
const CSS_RADIUS_PROP = /(?<![\w-])(border(?:-(?:top|bottom|start|end))?(?:-(?:left|right|start|end))?-radius)\s*:\s*([^;}]+)/g;
const NUMBER = /(?<![\w.$])\d+(?:\.\d+)?|(?<![\w$])\.\d+/;
const MARKER = /radius-exempt:\s*([\w-]+)/;

/** Blanks comments while keeping strings, line breaks and columns intact. */
export function stripComments(source, css = false) {
  let out = "";
  let i = 0;
  const stack = []; // string / template / ${ } nesting for JS
  const n = source.length;
  while (i < n) {
    const c = source[i], d = source[i + 1];
    const top = stack[stack.length - 1];
    if (top === "'" || top === '"') {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === top || c === "\n") stack.pop();
      i++; continue;
    }
    if (top === "`") {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === "`") stack.pop();
      else if (c === "$" && d === "{") { out += d; stack.push("${"); i += 2; continue; }
      i++; continue;
    }
    if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop; continue;
    }
    if (!css && c === "/" && d === "/") {
      while (i < n && source[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (!css && (c === "'" || c === '"' || c === "`")) { stack.push(c); out += c; i++; continue; }
    if (top === "${") {
      if (c === "{") stack.push("{");
      else if (c === "}") stack.pop();
    } else if (top === "{" ) {
      if (c === "{") stack.push("{");
      else if (c === "}") stack.pop();
    }
    out += c; i++;
  }
  return out;
}

/** Reads one JS value expression starting at `start`: up to a depth-0 `,` `;` `}` `)` or newline. */
function readValue(code, start, braced) {
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

/** Classifies a JS radius value: null when it passes, otherwise the rule it breaks. */
export function classifyJsValue(value) {
  const v = value.replace(/\s+as\s+const$/, "").trim();
  if (v === "" || /^0(?:\.0+)?$/.test(v) || /^(['"`])0(?:px)?\1$/.test(v)) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(v) || /^-?\.\d+$/.test(v)) return "raw-radius";
  if (/^(['"`])[^'"`]*\d[^'"`]*\1$/.test(v)) return "raw-radius";
  const code = v.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''");
  return NUMBER.test(code) ? "radius-arithmetic" : null;
}

/** Classifies a CSS radius value. */
export function classifyCssValue(value) {
  const v = value.replace(/!important/, "").trim();
  if (/^0(?:px|%)?$/.test(v)) return null;
  const withoutVars = v.replace(/var\(--radius-[\w-]+\)/g, "");
  if (withoutVars !== v && !NUMBER.test(withoutVars.replace(/calc|\(|\)/g, ""))) return null;
  return withoutVars === v ? "raw-radius" : "radius-arithmetic";
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

function markerOn(rawLines, index) {
  for (const line of [rawLines[index], rawLines[index - 1]]) {
    const match = line && MARKER.exec(line);
    if (match) return match[1];
  }
  return null;
}

/** Checks one file's text. `file` is repository-relative with `/` separators. */
export function checkSource(file, text, { radiusVariables = new Set() } = {}) {
  const css = file.endsWith(".css");
  const raw = text.split("\n");
  const code = stripComments(text, css);
  const lines = code.split("\n");
  const offsets = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const lineAt = index => {
    let lo = 0, hi = offsets.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= index) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const found = [];
  const report = (lineIndex, rule, detail, exemptable) => {
    const kind = exemptable ? markerOn(raw, lineIndex) : null;
    if (kind && EXEMPTION_KINDS.includes(kind)) return;
    if (kind) found.push({ file, line: lineIndex + 1, rule: "exemption-kind", detail: `"${kind}" is not an exemption DIRECTION.md lists` });
    else found.push({ file, line: lineIndex + 1, rule, detail });
  };

  for (const match of code.matchAll(ROUNDED)) {
    const scale = match[1];
    const line = lineAt(match.index);
    if (scale === "full") report(line, "rounded-full", match[0], true);
    else if (scale.startsWith("[")) report(line, "rounded-arbitrary", match[0], false);
    else report(line, "rounded-scale", match[0], false);
  }

  // Radius variables: definitions outside the token files, and references to undefined ones.
  for (const match of code.matchAll(/(?<![\w-])--(radius-[\w-]+)(['"`]?)\s*:\s*([^;\n]*)/g)) {
    // Token-derived when it carries no number of its own: `${scale.radius.control}px`, var(--radius-sm).
    const value = match[3].replace(/\s*[,;}]*\s*$/, "");
    if (NUMBER.test(value.replace(/var\(--radius-[\w-]+\)/g, ""))) report(lineAt(match.index), "radius-variable", `--${match[1]}: ${value}`, false);
  }
  for (const match of code.matchAll(/var\(--(radius-[\w-]+)/g)) {
    if (!radiusVariables.has(match[1])) report(lineAt(match.index), "radius-variable", `var(--${match[1]}) is not a Forge radius token`, false);
  }

  if (css) {
    for (const match of code.matchAll(CSS_RADIUS_PROP)) {
      const rule = classifyCssValue(match[2]);
      if (rule) report(lineAt(match.index), rule, `${match[1]}: ${match[2].trim()}`, true);
    }
  } else {
    for (const match of code.matchAll(JS_RADIUS_KEY)) {
      let start = match.index + match[0].length;
      let braced = false;
      if (match[2] === "=") {
        if (code[start] !== "{") continue; // a string prop such as cornerRadius="4" is caught below
        braced = true; start++;
      }
      const value = readValue(code, start, braced);
      const rule = classifyJsValue(value);
      if (rule) report(lineAt(match.index), rule, `${match[1]}: ${value}`, true);
    }
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

/** Checks the token definition itself. */
export function checkTokens(rootDir) {
  const found = [];
  const themePath = join(rootDir, TOKEN_FILES[0]);
  if (!existsSync(themePath)) return [{ file: TOKEN_FILES[0], line: 1, rule: "token-definition", detail: "missing token file" }];
  const theme = readFileSync(themePath, "utf8");
  const definitions = [...theme.matchAll(/export const forgeRadius\s*=\s*\{([^}]*)\}/g)];
  const ok = definitions.length === 1 && /^\s*sm:\s*4,\s*md:\s*6\s*$/.test(definitions[0][1]);
  if (!ok) found.push({ file: TOKEN_FILES[0], line: 1, rule: "token-definition", detail: "expected exactly one `export const forgeRadius = { sm: 4, md: 6 }`" });
  for (const sheet of GENERATED_SHEETS) {
    const path = join(rootDir, sheet);
    if (!existsSync(path)) { found.push({ file: sheet, line: 1, rule: "token-definition", detail: "missing generated sheet; run build-theme.mjs" }); continue; }
    const text = readFileSync(path, "utf8");
    if (!text.includes("--radius-sm: 4px;") || !text.includes("--radius-md: 6px;")) {
      found.push({ file: sheet, line: 1, rule: "token-definition", detail: "generated sheet lacks --radius-sm: 4px or --radius-md: 6px; run build-theme.mjs" });
    }
  }
  return found;
}

/** Runs every rule over packages/* and apps/* under rootDir. */
export function checkRadius(rootDir) {
  const radiusVariables = definedRadiusVariables(rootDir);
  const violations = checkTokens(rootDir);
  const tokenFiles = new Set(TOKEN_FILES);
  const files = [];
  for (const top of ["packages", "apps"]) {
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

/** Per-package counts: `packages/<name>` or `apps/<name>`. */
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
