// Usage: node docs/agent-native/contrast.mjs [--json] [--md] [--matrix]
// WCAG 2.1 contrast for the colour pairs Nitro Forge draws, read from source.
// No dependencies. Needs Node 22.18 or newer, which strips TypeScript types
// when it imports theme.ts and forge-directions.ts, so the numbers come from
// the same objects the app ships, not from a copy.
// Thresholds: text 4.5, large text 3.0 (SC 1.4.3), UI component or graphic 3.0 (SC 1.4.11).
// Kinds: text, large, ui (need a threshold); disabled (exempt); decorative (a hairline
// that no control depends on, reported for reference); cond (the other colour belongs
// to a host component this repo does not define, so the verdict is conditional);
// info (distance between two brand colours, no threshold).
// Large text is 24 px, or 18.66 px at weight 700. Disabled controls are exempt
// from 1.4.3 and 1.4.11 and are reported with kind "disabled" for reference only.
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "..", "packages", "studio-workspace", "src");
const theme = await import(pathToFileURL(path.join(src, "theme.ts")).href);
const dirs = await import(pathToFileURL(path.join(src, "forge-directions.ts")).href);
const icons = await import(pathToFileURL(path.join(here, "..", "..", "packages", "icons", "src", "tokens.js")).href);

// ---- colour maths -------------------------------------------------------
const parse = h => {
  const v = h.replace("#", "");
  const n = i => parseInt(v.slice(i, i + 2), 16);
  if (v.length === 3) return {r: parseInt(v[0] + v[0], 16), g: parseInt(v[1] + v[1], 16), b: parseInt(v[2] + v[2], 16), a: 1};
  return {r: n(0), g: n(2), b: n(4), a: v.length === 8 ? n(6) / 255 : 1};
};
const over = (top, under) => { // composite an RGBA colour over an opaque colour
  const t = parse(top), u = parse(under);
  const m = (x, y) => Math.round(x * t.a + y * (1 - t.a));
  const hx = x => x.toString(16).padStart(2, "0");
  return "#" + hx(m(t.r, u.r)) + hx(m(t.g, u.g)) + hx(m(t.b, u.b));
};
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = h => { const p = parse(h); return 0.2126 * lin(p.r) + 0.7152 * lin(p.g) + 0.0722 * lin(p.b); };
export const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// A spec is "#rrggbb", or ["#rrggbbaa", "#under"] composited over an opaque ground.
const flat = (spec, ground) => Array.isArray(spec) ? over(spec[0], spec[1]) : (parse(spec).a < 1 ? over(spec, ground) : spec);

// ---- pairs --------------------------------------------------------------
const W = theme.workspaceThemes, P = theme.prismThemes, S = theme.workspaceStatus, C = dirs.workbenchChrome, I = icons.iconColors;
const rows = [];
// kind: text | large | ui | disabled | info. where: where the pair occurs in source.
const add = (group, id, fg, bg, kind, where, mode) => rows.push({group, id, mode, fg, bg, kind, where});
for (const mode of ["dark", "light"]) {
  const w = W[mode], p = P[mode], s = S[mode], c = C[mode];
  // Workspace chrome (index.tsx, text-editor.tsx, persona-composer.tsx)
  add("workspace", "text/base", w.text, w.base, "text", "header title, rail, status", mode);
  add("workspace", "text/raised", w.text, w.raised, "text", "panel body, document row", mode);
  add("workspace", "muted/base", w.muted, w.base, "text", "header caption 11, rail label 9, status 11", mode);
  add("workspace", "muted/raised", w.muted, w.raised, "text", "panel hint 12, inactive tab label", mode);
  add("workspace", "muted/deep", w.muted, w.deep, "text", "QuillTextEditor word count 11 and status, which sit on the stage mat", mode);
  add("workspace", "accent/base", w.accent, w.base, "text", "rail label 9 when active, selected button label", mode);
  add("workspace", "accent/soft", w.accent, w.soft, "text", "arrange banner 11", mode);
  add("workspace", "ink/accent", w.ink, w.accent, "text", "Save button label and icon (on-primary on primary)", mode);
  add("workspace", "error/raised", w.error, w.raised, "text", "ErrorMessage, composer error 12", mode);
  add("workspace", "error/base", w.error, w.base, "text", "ErrorMessage on the status line", mode);
  add("workspace", "paperInk/paper", w.paperInk, w.paper, "text", "essay text", mode);
  add("workspace", "paperMuted/paper", w.paperMuted, w.paper, "text", "essay placeholder (placeholderTextColor)", mode);
  add("workspace", "line/base", w.line, w.base, "decorative", "hairline, panel border", mode);
  add("workspace", "line/raised", w.line, w.raised, "decorative", "panel and card border", mode);
  add("workspace", "accent/raised", w.accent, w.raised, "ui", "floating panel border, selected indicator, focus colour", mode);
  add("workspace", "accent/deep", w.accent, w.deep, "ui", "drag preview border, focus ring on stage", mode);
  add("workspace", "white/accent", "#FFFFFF", w.accent, "cond", "active tab icon is hard-coded #FFFFFF (index.tsx); active tab ground is NYC-Tron's, unknown here", mode);
  add("workspace", "info/raised", s.info, w.raised, "ui", "Banner info mark", mode);
  add("workspace", "success/raised", s.success, w.raised, "ui", "Banner and Badge success mark", mode);
  add("workspace", "onError/error", s.onError, w.error, "text", "danger Button label", mode);
  // Prism palette (prism-editor host palette, canvas studio chrome)
  add("prism", "text/base", p.text, p.base, "text", "prism header, rail", mode);
  add("prism", "muted/base", p.muted, p.base, "text", "prism captions", mode);
  add("prism", "muted/raised", p.muted, p.raised, "text", "prism panel hint", mode);
  add("prism", "accent/base", p.accent, p.base, "text", "prism selected label", mode);
  add("prism", "ink/accent", p.ink, p.accent, "text", "prism Save label (on-primary on primary)", mode);
  add("prism", "accent/deep", p.accent, p.deep, "ui", "prism focus ring, drag preview", mode);
  add("prism", "error/raised", p.error, p.raised, "text", "prism error text", mode);
  add("prism", "line/deep", p.line, p.deep, "ui", "PersonaComposer text field border (name, import, export): the only edge that marks the field", mode);
  add("prism", "line/base", p.line, p.base, "ui", "PersonaComposer field border against the panel around it", mode);
  add("prism", "text/deep", p.text, p.deep, "text", "PersonaComposer field text", mode);
  // Workbench chrome (forge-directions.ts workbenchChrome, used by prism-editor.tsx)
  add("chrome", "text/body", c.text, c.body, "text", "toolbar name, layer names", mode);
  add("chrome", "muted/body", c.muted, c.body, "text", "captions, tool glyphs, Transform label 11", mode);
  add("chrome", "muted/selected", c.muted, c.selected, "text", "caption on the selected row", mode);
  add("chrome", "selectedMuted/selected", c.selectedMuted, c.selected, "text", "secondary text on the selected row", mode);
  add("chrome", "accent/body", c.accent, c.body, "text", "selected tool glyph and label", mode);
  add("chrome", "disabledInk/well", c.disabledInk, c.well, "disabled", "unavailable control glyph (exempt, reference only)", mode);
  add("chrome", "edge/body", c.edge, c.body, "decorative", "panel chamfer line (decorative: controls carry no border)", mode);
  add("chrome", "chipRing/body", c.chipRing, c.body, "ui", "ring around the chosen fill chip", mode);
  add("chrome", "chipEdge/body", [c.chipEdge, c.body], c.body, "ui", "hairline around a fill chip", mode);
  add("chrome", "text/accent15>body", c.text, [c.accent + "26", c.body], "text", "persona trigger label while open (accent at 15% over body)", mode);
  for (const f of dirs.prismFillSwatches) add("chrome", "fill " + f.name + "/body", f.hex, c.body, "ui", "fill chip colour is the only cue besides its name label", mode);
  // Direction materials (turret): text, muted, accent against solid panel, readout against the dial face
  for (const id of dirs.FORGE_DIRECTION_IDS) {
    const m = dirs.forgeDirections[id].materials[mode];
    add("direction:" + id, "text/panelSolid", m.text, m.panelSolid, "text", "stop name, hint", mode);
    add("direction:" + id, "muted/panelSolid", m.muted, m.panelSolid, "text", "inactive stop name, hint", mode);
    add("direction:" + id, "accent/panelSolid", m.accent, m.panelSolid, "ui", "committed stop mark, focus ring", mode);
    add("direction:" + id, "faceText/face[0]", m.faceText, m.face[0], "text", "dial readout, lit edge of the face", mode);
    add("direction:" + id, "faceText/face[1]", m.faceText, m.face[1], "text", "dial readout, shadow edge of the face", mode);
    add("direction:" + id, "faceText@78/face[1]", [m.faceText + "C7", m.face[1]], m.face[1], "text", "dial sub-readout drawn at opacity 0.78 when not peeking", mode);
    add("direction:" + id, "accent/accentHalo", m.accent, m.accentHalo, "ui", "committed slot ring on its halo", mode);
  }
}
// Fixed colours that do not follow a mode
add("fixed", "white/#111827", "#FFFFFF", "#111827", "text", "Prism 'Move preview' caption 11 (prism-canvas.tsx)", "both");
// The Cancel move label is a ghost Button, whose label is text-text (NYC-Tron Button.tsx, variants.ghost),
// drawn on the hard-coded #111827 chip. Under PrismEditor text-text is the Workbench chrome text.
add("fixed", "chrome text dark/#111827", C.dark.text, "#111827", "text", "Cancel move label under PrismEditor, dark", "dark");
add("fixed", "chrome text light/#111827", C.light.text, "#111827", "text", "Cancel move label under PrismEditor, light", "light");
add("fixed", "reference text light/#111827", W.light.text, "#111827", "text", "Cancel move label with the workspace reference tokens, light", "light");
add("fixed", "#111827/artboard", "#111827", "#FFFFFF", "ui", "move preview chip against the artboard checker", "both");
// Icon package defaults against its own surfaces and against workspace surfaces
const iconSurface = {light: "#FFFFFF", dark: "#11131B"};
for (const [name, fgLight, fgDark] of [["ink", I.ink, I.inkInverse], ["accent", I.accent, I.accent], ["positive", I.positive, I.positive], ["negative", I.negative, I.negative]]) {
  add("icon", name + "/icon surface", fgLight, iconSurface.light, "ui", "ForgeIcon default, appearance=light, surface #FFFFFF", "light");
  add("icon", name + "/icon surface", fgDark, iconSurface.dark, "ui", "ForgeIcon default, appearance=dark, surface #11131B", "dark");
}
add("icon", "ink (appearance=light default)/workspace dark base", I.ink, W.dark.base, "ui", "ForgeIcon with no appearance and no color on a dark host: appearance defaults to light", "dark");
add("icon", "muted/icon surface", I.muted, iconSurface.light, "disabled", "disabled glyph (exempt, reference only)", "light");
add("icon", "muted/icon surface", I.muted, iconSurface.dark, "disabled", "disabled glyph (exempt, reference only)", "dark");
for (const mode of ["dark", "light"]) {
  const w = W[mode], s = S[mode];
  const fgInk = mode === "dark" ? I.inkInverse : I.ink;
  add("drift D4", "icon ink/workspace base", fgInk, w.base, "ui", "icon default ink on the workspace base (host passes color today; this is the fallback)", mode);
  add("drift D4", "icon ink/workspace raised", fgInk, w.raised, "ui", "icon default ink on the workspace raised surface", mode);
  add("drift D4", "icon muted/workspace base", I.muted, w.base, "ui", "icon muted #737F91 on workspace base (workspace muted is a different grey)", mode);
  add("drift D1", "icon accent/workspace base", I.accent, w.base, "ui", "icon accent #6859E8 on workspace base", mode);
  add("drift D1", "icon accent/workspace raised", I.accent, w.raised, "ui", "icon accent #6859E8 on workspace raised", mode);
  add("drift D3", "icon positive/workspace raised", I.positive, w.raised, "ui", "icon success #139E75 vs workspace success " + s.success, mode);
  add("drift D3", "workspace success/workspace raised", s.success, w.raised, "ui", "workspace success, for comparison", mode);
  add("drift D3", "icon negative/workspace raised", I.negative, w.raised, "ui", "icon danger #D94462 vs workspace error " + w.error, mode);
  add("drift D3", "workspace error/workspace raised", w.error, w.raised, "ui", "workspace error, for comparison", mode);
}
// Stage paper (stage.tsx) is #f7f5ed, not the workspace paper #FFFEFC (drift D5)
const SP = "#f7f5ed";
const stageMat = {dark: W.dark.deep, light: W.light.deep};
add("stage", "#283329/#f7f5ed", "#283329", SP, "text", "quill page body 15", "both");
add("stage", "#283329/#FFFEFC", "#283329", W.light.paper, "text", "same ink on the workspace paper, for comparison", "both");
add("stage", "#66735f/#f7f5ed", "#66735f", SP, "text", "photo, design and draft captions 12 to 13", "both");
add("stage", "#798373/#f7f5ed", "#798373", SP, "text", "blank slide hint 12", "both");
add("stage", "#26372e/#f7f5ed", "#26372e", SP, "text", "pitch slide text, tally cell text", "both");
add("stage", "#637161/#e5e9dd", "#637161", "#e5e9dd", "text", "tally header cells 12", "both");
add("stage", "#354638/#f7f5ed", "#354638", SP, "text", "photo camera line 15", "both");
add("stage", "#ffffff/#637660", "#ffffff", "#637660", "text", "cadence clip label 10", "both");
add("stage", "#ffffff/#725d7c", "#ffffff", "#725d7c", "text", "splice clip label 10", "both");
add("stage", "#b9c7ba/#222829", "#b9c7ba", "#222829", "text", "track name 11", "both");
add("stage", "#eef0e9/#222829", "#eef0e9", "#222829", "text", "motion layer name 13", "both");
add("stage", "#99a19d/mat dark", "#99a19d", stageMat.dark, "text", "stage caption 11, dark scheme", "dark");
add("stage", "#556359/mat light", "#556359", stageMat.light, "text", "stage caption 11, light scheme", "light");
add("stage", "#eef0e9/mat dark", "#eef0e9", stageMat.dark, "text", "stage heading 22, dark scheme", "dark");
add("stage", "#202923/mat light", "#202923", stageMat.light, "text", "stage heading 22, light scheme", "light");
add("stage", "#f7f5ed/mat dark", SP, stageMat.dark, "decorative", "stage paper edge against the dark mat", "dark");
add("stage", "#f7f5ed/mat light", SP, stageMat.light, "decorative", "stage paper edge against the light mat", "light");
add("stage", "#39423f/#222829", "#39423f", "#222829", "decorative", "track and layer border", "both");
// Prism blue against the launcher purple and the workspace accent (informational)
add("prism blue", "prism accent dark/workspace accent dark", P.dark.accent, W.dark.accent, "info", "how far Prism blue sits from the suite accent (dark)", "dark");
add("prism blue", "prism accent light/workspace accent light", P.light.accent, W.light.accent, "info", "how far Prism blue sits from the suite accent (light)", "light");
add("prism blue", "prism accent dark/launcher purple", P.dark.accent, "#9C5FE6", "info", "launcher accent for prism in icon-family.mjs", "dark");
add("prism blue", "prism accent light/launcher purple", P.light.accent, "#9C5FE6", "info", "launcher accent for prism in icon-family.mjs", "light");

const need = {text: 4.5, large: 3, ui: 3, disabled: 0, decorative: 0, cond: 3, info: 0};
export const results = rows.map(r => {
  const fg = flat(r.fg, r.bg), bg = flat(r.bg, "#000000");
  const v = ratio(fg, bg);
  const min = need[r.kind];
  const verdict = r.kind === "disabled" ? "exempt" : r.kind === "decorative" ? "decorative" : r.kind === "info" ? "info" : r.kind === "cond" ? (v >= min ? "COND-PASS" : "COND-FAIL") : v >= min ? "PASS" : "FAIL";
  return {...r, fg: Array.isArray(r.fg) ? fg : r.fg, bg: Array.isArray(r.bg) ? bg : r.bg, ratio: Math.round(v * 100) / 100, min, verdict};
});

// ---- density: colour invariance and target sizes -------------------------
const densities = {};
for (const d of theme.WORKSPACE_DENSITIES) {
  const s = theme.resolveWorkspaceScale(d);
  densities[d] = {target: s.size.target, rail: s.size.rail, header: s.size.header, toolbar: s.size.toolbar, status: s.size.status,
    colourKeys: Object.keys(s).filter(k => /colou?r|theme|palette/i.test(k)).length,
    iosTarget44: s.size.target >= 44, androidTarget48: s.size.target >= 48};
}
const colourInvariant = Object.values(densities).every(d => d.colourKeys === 0);

const main = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (!main) { /* imported as a module: export ratio and results only */ } else if (process.argv.includes("--matrix")) {
  // One matrix: scheme x density. Density changes space and size only (theme.ts resolveWorkspaceScale),
  // so each colour pair has the same ratio in the three densities; the script checks that with colourInvariant.
  const ds = theme.WORKSPACE_DENSITIES, ms = ["dark", "light"];
  const head = ms.flatMap(m => ds.map(d => m + " " + d));
  console.log("| Pair | " + head.join(" | ") + " |\n|---|" + head.map(() => "---:").join("|") + "|");
  const keys = [...new Set(results.filter(r => ["workspace", "prism", "chrome"].includes(r.group) && r.mode !== "both").map(r => r.group + " " + r.id))];
  for (const k of keys) {
    const cells = ms.flatMap(m => { const r = results.find(x => x.group + " " + x.id === k && x.mode === m);
      return ds.map(() => r ? r.ratio + (r.verdict === "FAIL" || r.verdict === "COND-FAIL" ? " FAIL" : r.verdict === "decorative" ? " deco" : r.verdict === "exempt" ? " ex" : "") : "n/a"); });
    console.log("| " + k + " | " + cells.join(" | ") + " |");
  }
  const t = d => densities[d];
  console.log("| **target (pt)** | " + ms.flatMap(() => ds.map(d => t(d).target)).join(" | ") + " |");
  console.log("| **meets iOS 44** | " + ms.flatMap(() => ds.map(d => t(d).iosTarget44 ? "yes" : "NO")).join(" | ") + " |");
  console.log("| **meets Android 48** | " + ms.flatMap(() => ds.map(d => t(d).androidTarget48 ? "yes" : "NO")).join(" | ") + " |");
  console.log("\ncolour is density-invariant: " + colourInvariant);
} else if (process.argv.includes("--json")) {
  console.log(JSON.stringify({results, densities, colourInvariant}, null, 2));
} else {
  const md = process.argv.includes("--md");
  console.log(md ? "| Group | Pair | Mode | Foreground | Ground | Ratio | Needs | Verdict | Where |\n|---|---|---|---|---|---|---|---|---|" : "group\tpair\tmode\tfg\tbg\tratio\tneeds\tverdict");
  for (const r of results) console.log(md
    ? `| ${r.group} | ${r.id} | ${r.mode} | ${r.fg} | ${r.bg} | ${r.ratio} | ${r.min || "n/a"} | ${r.verdict} | ${r.where} |`
    : [r.group, r.id, r.mode, r.fg, r.bg, r.ratio, r.min, r.verdict].join("\t"));
  console.log("\ndensity\ttarget\trail\theader\ttoolbar\tstatus\tios44\tandroid48");
  for (const [d, v] of Object.entries(densities)) console.log([d, v.target, v.rail, v.header, v.toolbar, v.status, v.iosTarget44, v.androidTarget48].join("\t"));
  console.log("\ncolour is density-invariant:", colourInvariant);
  const fails = results.filter(r => r.verdict === "FAIL");
  console.log(`pairs ${results.length}, FAIL ${fails.length}`);
  process.exitCode = 0;
}
