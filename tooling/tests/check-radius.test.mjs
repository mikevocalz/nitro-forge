import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SCANNED_ROOTS, checkRadius, checkSource, checkTokens, classifyCssValue, classifyJsValue, inventory, stripComments } from "../check-radius.mjs";
import { SCANNED_ROOTS as SCOPE_ROOTS } from "../derive-v1-component-scope.mjs";

const fixtures = fileURLToPath(new URL("./fixtures/radius/", import.meta.url));
const script = fileURLToPath(new URL("../check-radius.mjs", import.meta.url));
const pass = join(fixtures, "pass");
const fail = join(fixtures, "fail");
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const keys = result => result.violations.map(v => `${v.file}:${v.line}:${v.rule}`);

test("token file, tokens, square corners and listed exemptions pass", () => {
  const result = checkRadius(pass);
  assert.deepEqual(keys(result), []);
  assert.equal(result.files, 6, "token files are not scanned as call sites");
});

test("every rule fires on the failing fixture", () => {
  const found = keys(checkRadius(fail));
  assert.deepEqual(found.sort(), [
    "apps/lab/global.css:2:radius-variable",
    "apps/lab/global.css:3:radius-variable",
    "apps/lab/global.css:5:raw-radius",
    "apps/lab/global.css:6:radius-variable",
    "apps/lab/global.css:7:radius-arithmetic",
    "examples/demo/App.tsx:1:raw-radius",
    "packages/ui/src/arbitrary.tsx:1:rounded-arbitrary",
    "packages/ui/src/arbitrary.tsx:2:rounded-arbitrary",
    "packages/ui/src/arithmetic.tsx:1:radius-arithmetic",
    "packages/ui/src/arithmetic.tsx:2:radius-arithmetic",
    "packages/ui/src/arithmetic.tsx:3:raw-radius",
    "packages/ui/src/artwork.tsx:2:exemption-unused",
    "packages/ui/src/artwork.tsx:2:rounded-scale",
    "packages/ui/src/artwork.tsx:3:exemption-unused",
    "packages/ui/src/artwork.tsx:3:rounded-arbitrary",
    "packages/ui/src/artwork.tsx:4:exemption-unused",
    "packages/ui/src/artwork.tsx:4:radius-variable",
    "packages/ui/src/config.mjs:1:raw-radius",
    "packages/ui/src/full.tsx:1:rounded-full",
    "packages/ui/src/full.tsx:3:exemption-kind",
    "packages/ui/src/identifiers.tsx:1:radius-identifier",
    "packages/ui/src/identifiers.tsx:2:raw-radius",
    "packages/ui/src/identifiers.tsx:3:raw-radius",
    "packages/ui/src/identifiers.tsx:4:raw-radius",
    "packages/ui/src/identifiers.tsx:5:rounded-dynamic",
    "packages/ui/src/identifiers.tsx:6:rounded-dynamic",
    "packages/ui/src/markers.tsx:1:rounded-full",
    "packages/ui/src/markers.tsx:2:rounded-full",
    "packages/ui/src/markers.tsx:3:exemption-unused",
    "packages/ui/src/page.html:1:raw-radius",
    "packages/ui/src/page.html:1:rounded-scale",
    "packages/ui/src/raw.tsx:1:raw-radius",
    "packages/ui/src/raw.tsx:2:raw-radius",
    "packages/ui/src/raw.tsx:3:raw-radius",
    "packages/ui/src/raw.tsx:5:raw-radius",
    "packages/ui/src/scale.tsx:1:rounded-scale",
    "packages/ui/src/scale.tsx:2:rounded-scale",
    "packages/ui/src/scale.tsx:3:rounded-scale",
    "packages/ui/src/scale.tsx:4:rounded-scale",
    "packages/ui/src/script.cjs:1:raw-radius",
    "packages/ui/src/variables.tsx:1:radius-variable",
  ]);
});

test("the token definition must be exactly sm 4 and md 6, and the sheets must carry it", () => {
  const dir = mkdtempSync(join(tmpdir(), "radius-tokens-"));
  try {
    cpSync(pass, dir, { recursive: true });
    const theme = join(dir, "packages/studio-workspace/src/theme.ts");
    writeFileSync(theme, readFileSync(theme, "utf8").replace("md: 6", "md: 8"));
    const sheet = join(dir, "packages/studio-workspace/src/radius.css");
    writeFileSync(sheet, readFileSync(sheet, "utf8").replace("--radius-md: 6px;", ""));
    const found = keys(checkRadius(dir));
    assert.ok(found.every(key => key.endsWith(":1:token-definition")), JSON.stringify(found));
    assert.ok(found.includes("packages/studio-workspace/src/theme.ts:1:token-definition"));
    assert.ok(found.includes("packages/studio-workspace/src/radius.css:1:token-definition"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rounded-lg and larger, side and corner variants included", () => {
  for (const cls of ["rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-t-xl", "rounded-br-lg", "rounded-ss-2xl", "hover:rounded-lg"]) {
    assert.deepEqual(checkSource("a.tsx", `<View className="${cls}" />`).map(v => v.rule), ["rounded-scale"], cls);
  }
  for (const cls of ["rounded-sm", "rounded-md", "rounded-none", "rounded-control", "rounded-card", "rounded-rectangle"]) {
    assert.deepEqual(checkSource("a.tsx", `<View className="${cls}" />`), [], cls);
  }
});

test("rounded-full needs a marker naming a DIRECTION.md exemption", () => {
  assert.deepEqual(checkSource("a.tsx", '<View className="rounded-full" />').map(v => v.rule), ["rounded-full"]);
  for (const kind of ["knob", "colour-well", "radio", "avatar", "record-button", "window", "system-sheet", "launcher-icon-mask", "artwork"]) {
    assert.deepEqual(checkSource("a.tsx", `// radius-exempt: ${kind}\n<View className="rounded-full" />`), [], kind);
  }
  assert.deepEqual(checkSource("a.tsx", '// radius-exempt: badge\n<View className="rounded-full" />').map(v => v.rule), ["exemption-kind"]);
  // A marker two lines up does not reach, and is then reported as unused.
  assert.deepEqual(checkSource("a.tsx", '// radius-exempt: knob\n\n<View className="rounded-full" />').map(v => v.rule), ["exemption-unused", "rounded-full"]);
  // Markers never excuse lg-or-larger or arbitrary classes.
  assert.deepEqual(checkSource("a.tsx", '<View className="rounded-xl" /> {/* radius-exempt: knob */}').map(v => v.rule).sort(), ["exemption-unused", "rounded-scale"]);
});

test("artwork excuses raw and computed radii but not lg classes, arbitrary classes or variables", () => {
  for (const line of ["borderRadius: 13", "borderRadius: '50%'", "borderRadius: kind === 'ellipse' ? 9999 : 0"]) {
    assert.deepEqual(checkSource("a.tsx", `// radius-exempt: artwork\nconst s = { ${line} };`), [], line);
    assert.equal(checkSource("a.tsx", `const s = { ${line} };`).length, 1, `${line} fails unmarked`);
  }
  assert.deepEqual(checkSource("a.css", ".blob { border-radius: 50%; } /* radius-exempt: artwork */"), []);
  for (const [source, rule] of [
    ['<View className="rounded-xl" /> {/* radius-exempt: artwork */}', "rounded-scale"],
    ['<View className="rounded-[50%]" /> {/* radius-exempt: artwork */}', "rounded-arbitrary"],
    ["const v = { '--radius-art': '9px' }; // radius-exempt: artwork", "radius-variable"],
  ]) assert.deepEqual(checkSource("a.tsx", source).map(v => v.rule).sort(), ["exemption-unused", rule].sort(), source);
});

test("value classifiers", () => {
  assert.equal(classifyJsValue("0"), null);
  assert.equal(classifyJsValue("scale.radius.panel"), null);
  assert.equal(classifyJsValue("forgeRadius.sm"), null);
  assert.equal(classifyJsValue("R"), "radius-identifier");
  assert.equal(classifyJsValue("8"), "raw-radius");
  assert.equal(classifyJsValue("0.75"), "raw-radius");
  assert.equal(classifyJsValue("'50%'"), "raw-radius");
  assert.equal(classifyJsValue("scale.radius.control + 2"), "radius-arithmetic");
  assert.equal(classifyJsValue("x2.radius"), "radius-identifier");
  assert.equal(classifyCssValue("var(--radius-md)"), null);
  assert.equal(classifyCssValue("0"), null);
  assert.equal(classifyCssValue("4px"), "raw-radius");
  assert.equal(classifyCssValue("calc(var(--radius-sm) * 2)"), "radius-arithmetic");
});

test("comments are ignored, strings are not", () => {
  assert.equal(stripComments("a // rounded-lg\nb").includes("rounded-lg"), false);
  assert.equal(stripComments("'https://x/rounded-lg'").includes("rounded-lg"), true);
  assert.equal(stripComments("`a ${b /* c */} d` // e").trimEnd(), "`a ${b        } d`");
});

test("dependencies, build output and tests are not scanned", () => {
  const dir = mkdtempSync(join(tmpdir(), "radius-skip-"));
  try {
    cpSync(pass, dir, { recursive: true });
    for (const skipped of ["packages/ui/node_modules/kit", "packages/ui/dist", "packages/ui/tests", "apps/lab/ios"]) {
      mkdirSync(join(dir, skipped), { recursive: true });
      writeFileSync(join(dir, skipped, "x.tsx"), '<View className="rounded-3xl" />');
    }
    writeFileSync(join(dir, "packages/ui/src/views.test.tsx"), "const s = { borderRadius: 12 };");
    assert.deepEqual(keys(checkRadius(dir)), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI prints file:line:rule, exits 1, and --json gives per-package counts", () => {
  const run = spawnSync(process.execPath, [script, "--root", fail], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^packages\/ui\/src\/raw\.tsx:1:raw-radius {2}borderRadius: 8$/m);
  assert.match(run.stdout, /check-radius: 41 violation\(s\) in 14 files/);

  const report = spawnSync(process.execPath, [script, "--root", fail, "--report"], { encoding: "utf8" });
  assert.equal(report.status, 0, "--report lists violations without failing");

  const json = JSON.parse(spawnSync(process.execPath, [script, "--root", fail, "--json"], { encoding: "utf8" }).stdout);
  assert.equal(json.total, 41);
  assert.equal(json.packages["apps/lab"].count, 5);
  assert.equal(json.packages["packages/ui"].count, 35);
  assert.equal(json.packages["examples/demo"].count, 1);
  assert.equal(json.packages["packages/ui"].rules["rounded-scale"], 6);
  assert.ok(json.packages["packages/ui"].violations.includes("packages/ui/src/full.tsx:3:exemption-kind"));

  assert.equal(execFileSync(process.execPath, [script, "--root", pass], { encoding: "utf8" }).trim(), "check-radius: 0 violation(s) in 6 files");
  assert.deepEqual(inventory({ files: 0, violations: [] }), { filesChecked: 0, total: 0, packages: {} });
});

test("scans the same roots as the v1 component scope", () => {
  assert.deepEqual([...SCANNED_ROOTS], [...SCOPE_ROOTS]);
  assert.ok(SCANNED_ROOTS.includes("examples"));
});

test("token-definition checks values, references and the generated sheets", () => {
  assert.deepEqual(checkTokens(repoRoot), [], "the committed theme and sheets are current");
  const cases = [
    ["panel is a literal", "packages/studio-workspace/src/theme.ts", t => t.replace("panel: forgeRadius.md", "panel: 6")],
    ["paper is a third value", "packages/studio-workspace/src/theme.ts", t => t.replace("paper: forgeRadius.md", "paper: 2")],
    ["hairline is not below 4", "packages/studio-workspace/src/theme.ts", t => t.replace("needle: 0.75", "needle: 4")],
    ["a sheet has an extra radius", "packages/studio-workspace/src/radius.css", t => t.replace("}", "  --radius-lg: 8px;\n}")],
    ["a sheet is stale", "packages/studio-workspace/src/theme.native.css", t => t.replace("--radius-card: 6px;", "--radius-card: 4px;")],
  ];
  for (const [name, file, change] of cases) {
    const dir = mkdtempSync(join(tmpdir(), "radius-token-value-"));
    try {
      cpSync(pass, dir, { recursive: true });
      writeFileSync(join(dir, file), change(readFileSync(join(dir, file), "utf8")));
      const rules = checkTokens(dir).map(v => v.rule);
      assert.ok(rules.length > 0 && rules.every(rule => rule === "token-definition"), `${name}: ${JSON.stringify(rules)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("identifiers, quoted keys, assignments, string props and config objects", () => {
  const rules = source => checkSource("a.tsx", source).map(v => v.rule);
  assert.deepEqual(rules("const s = { borderRadius: R };"), ["radius-identifier"]);
  assert.deepEqual(rules("const s = { borderRadius: R }; // radius-exempt: knob"), []);
  for (const ok of ["forgeRadius.sm", "forgeHairlineRadius.tick", "scale.radius.panel", "workspaceScale.radius.control", "on ? scale.radius.panel : 0", "0"]) {
    assert.deepEqual(rules(`const s = { borderRadius: ${ok} };`), [], ok);
  }
  assert.deepEqual(rules("const s = { 'borderTopLeftRadius': 8 };"), ["raw-radius"]);
  assert.deepEqual(rules('const s = { "border-radius": "8px" };'), ["raw-radius"]);
  assert.deepEqual(rules("el.style.borderRadius = '10px';"), ["raw-radius"]);
  assert.deepEqual(rules("el.style.borderRadius = scale.radius.control;"), []);
  assert.deepEqual(rules('<Button cornerRadius="8" />'), ["raw-radius"]);
  assert.deepEqual(rules("export default { theme: { borderRadius: { lg: '12px' } } };"), ["raw-radius"]);
  assert.deepEqual(rules("const c = `rounded-${size}`;"), ["rounded-dynamic"]);
  assert.deepEqual(rules("const c = 'rounded-' + size;"), ["rounded-dynamic"]);
  assert.deepEqual(checkSource("a.html", '<div class="rounded-2xl" style="border-radius: 8px"></div>').map(v => v.rule).sort(), ["raw-radius", "rounded-scale"]);
  assert.deepEqual(checkSource("a.html", '<!-- rounded-2xl --><div class="rounded-sm"></div>'), []);
});

test("a marker counts only in comment text and excuses exactly one violation", () => {
  const rules = source => checkSource("a.tsx", source).map(v => v.rule);
  assert.deepEqual(rules('const a = <View className="rounded-full" title="radius-exempt: knob" />;'), ["rounded-full"]);
  assert.deepEqual(rules("const s = 'radius-exempt: artwork'; const t = { borderRadius: 9 };"), ["raw-radius"]);
  assert.deepEqual(rules('<><View className="rounded-full" /><View className="rounded-full" /></> // radius-exempt: knob'), ["rounded-full"]);
  assert.deepEqual(rules("// radius-exempt: artwork\nconst s = { borderRadius: 9, borderTopLeftRadius: 9 };"), ["raw-radius"]);
  assert.deepEqual(rules("// radius-exempt: knob\nconst s = { borderRadius: 0 };"), ["exemption-unused"]);
  // A same-line marker is used before the one above, so each covers its own line.
  assert.deepEqual(rules("// radius-exempt: knob\nconst a = { borderRadius: R };\nconst b = { borderRadius: Q }; // radius-exempt: knob"), []);
});

test("CSS shorthand of 0 and token parts, and CSS-wide keywords, pass", () => {
  for (const ok of ["0 var(--radius-sm)", "var(--radius-sm) 0 0 var(--radius-md)", "var(--radius-md) / var(--radius-sm)", "inherit", "initial", "unset", "revert"]) {
    assert.equal(classifyCssValue(ok), null, ok);
  }
  assert.equal(classifyCssValue("4px 0"), "raw-radius");
  assert.equal(classifyCssValue("var(--radius-sm) 8px"), "radius-arithmetic");
});
