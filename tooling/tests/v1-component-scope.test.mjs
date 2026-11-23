import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LEDGER_PATH, OUTPUT_PATH, POST_V1_PLATFORMS, deriveScope, parseModule, run, stripComments, usages } from "../derive-v1-component-scope.mjs";
import { TRON_BLOB_PREFIX } from "../verify-component-program.mjs";

const rowAt = (id, name, path) => ({ id, name, sourceCandidates: [TRON_BLOB_PREFIX + path] });
const row = (id, name, path) => rowAt(id, name, "packages/ui/src/components/" + path);
const ledger = {
  components: [
    row("R-01", "LevelMeter", "forge/audio/LevelMeter.tsx"),
    row("R-02", "TrackList", "forge/TrackList.tsx"),
    row("R-03", "Knob", "forge/inputs/Knob.tsx"),
    row("R-04", "Fader", "forge/audio/Fader.tsx"),
    row("R-05", "TabStrip", "shell/TabStrip.tsx"),
    row("R-06", "Popup", "overlays/Popup.native.tsx"),
    row("R-07", "Hidden", "shell/Hidden.tsx"),
    row("R-08", "CliOnly", "shell/CliOnly.tsx"),
    row("R-09", "Sheet", "shell/Sheet.tsx"),
    rowAt("R-10", "FoldLayout", "packages/core/src/folds.ts"),
    rowAt("R-11", "GeometryKit", "packages/core/src/geometry.ts"),
    row("R-12", "DragControl", "gestures/Drag.tsx"),
    rowAt("R-13", "PopSheet", "packages/expo-controls/src/components/NativeSheet.native.tsx"),
  ],
  additions: [row("W-01", "Chrome", "shell/Chrome.tsx")],
};

/** A small workspace: one studio, one CLI app without React, one library package. */
function fixture(t) {
  const rootDir = mkdtempSync(join(tmpdir(), "forge-v1-scope-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const files = {
    "apps/studio/package.json": JSON.stringify({ name: "@fx/studio", main: "index.tsx", dependencies: { react: "19.3.1" } }),
    "apps/studio/index.tsx": [
      "import { LevelMeter as Meter } from '@nyc-tron/ui/components/forge/audio/LevelMeter';", // 1
      "import { TrackRow } from '@nyc-tron/ui/components/forge/TrackList';",                  // 2
      "import * as Tabs from '@nyc-tron/ui/components/shell/TabStrip';",                     // 3
      "import { Mystery } from '@nyc-tron/ui';",                                             // 4
      "import type { Hidden } from '@nyc-tron/ui/components/shell/Hidden';",                 // 5
      "import { Fader, Popup } from '@fx/kit';",                                             // 6
      "import { Panel } from './panel';",                                                    // 7
      "// <Hidden /> is documented here but never rendered.",                                // 8
      "export function App() {",                                                             // 9
      "  return <Meter level={1}>",                                                          // 10
      "    <TrackRow />",                                                                    // 11
      "    <Tabs.TabStrip />",                                                               // 12
      "    <Mystery />",                                                                     // 13
      "    <Fader />",                                                                       // 14
      "    <Popup />",                                                                       // 15
      "    <Panel />",                                                                       // 16
      "  </Meter>;",                                                                         // 17
      "}",
    ].join("\n"),
    "apps/studio/panel.native.tsx": "import { Sheet } from '@nyc-tron/ui/components/shell/Sheet';\nexport const Panel = () => <Sheet />;\n",
    "apps/studio/panel.web.tsx": "import './services';\nexport const Panel = () => null;\n",
    "apps/studio/services.ts": [
      "import { resolveRegions } from '@nyc-tron/core/folds';",                       // 1
      "import type { Rect } from '@nyc-tron/core/geometry';",                          // 2
      "import { dragTransport } from '@nyc-tron/ui/components/gestures/Drag';",       // 3
      "import { formatTime } from '@nyc-tron/ui/components/forge/timebase';",         // 4
      "import { NativeSheet } from '@nyc-tron/expo-controls/NativeSheet';",          // 5
      "export const area: Rect = resolveRegions([]);",                                // 6
      "export const options = { transport: dragTransport, parts: [NativeSheet] };",   // 7
      "export const label = formatTime(0);",                                          // 8
      "export type Box = typeof dragTransport;",                                      // 9
    ].join("\n"),
    "apps/studio/tests/knob.test.tsx": "import { Knob } from '@nyc-tron/ui/components/forge/inputs/Knob';\nexport const t = <Knob />;\n",
    "apps/cli/package.json": JSON.stringify({ name: "@fx/cli", main: "index.tsx" }),
    "apps/cli/index.tsx": "import { CliOnly } from '@nyc-tron/ui/components/shell/CliOnly';\nexport const x = <CliOnly />;\n",
    "packages/kit/package.json": JSON.stringify({ name: "@fx/kit", exports: { ".": { types: "./src/index.ts", default: "./src/index.ts" } } }),
    "packages/kit/src/index.ts": "export { LevelFader as Fader } from '@nyc-tron/ui/components/forge/audio/Fader';\nexport * from './ui';\n",
    "packages/kit/src/ui.tsx": "export const Popup = (props: object) => { const C = useComponents().Popup; return <C {...props} />; };\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(rootDir, path)), { recursive: true });
    writeFileSync(join(rootDir, path), text);
  }
  return rootDir;
}

test("maps aliases, namespaces, re-exports, slots and platform variants to ledger rows", t => {
  const rootDir = fixture(t);
  const result = deriveScope({ rootDir, ledger });
  assert.deepEqual(result.studiosAndLabs, [{ name: "@fx/studio", dir: "apps/studio", entries: ["apps/studio/index.tsx"] }],
    "a workspace without react (apps/cli) is not a studio or lab");
  const byId = Object.fromEntries(result.inScope.map(item => [item.id, item.hits]));
  assert.deepEqual(Object.keys(byId), ["R-01", "R-02", "R-04", "R-05", "R-06", "R-09", "R-10", "R-12", "R-13"]);
  assert.ok(result.inScope.every(item => item.basis === "derived: renders or calls"));
  assert.deepEqual(byId["R-01"].map(hit => [hit.at, hit.kind, hit.binding, hit.mappedBy]), [["apps/studio/index.tsx:10", "render", "Meter", "name"]]);
  assert.deepEqual(byId["R-02"].map(hit => [hit.at, hit.mappedBy]), [["apps/studio/index.tsx:11", "module"]],
    "an unlisted export falls back to the row that owns its Tron source file");
  assert.equal(byId["R-04"][0].at, "apps/studio/index.tsx:14", "a renamed workspace re-export keeps its Tron origin");
  assert.equal(byId["R-04"][0].module, "@nyc-tron/ui/components/forge/audio/Fader");
  assert.equal(byId["R-05"][0].at, "apps/studio/index.tsx:12");
  assert.deepEqual(byId["R-06"].map(hit => [hit.at, hit.kind, hit.mappedBy]), [["apps/studio/index.tsx:15", "render", "slot"]]);
  assert.deepEqual(byId["R-09"].map(hit => hit.at), ["apps/studio/panel.native.tsx:2"], "every platform variant is reachable");
  assert.deepEqual(result.postV1Rows, ["R-03", "R-07", "R-08", "R-11", "W-01"],
    "test files, type-only imports, comments and non-UI apps leave rows post-v1");
});

test("a lowercase call into a source module is a call hit, whatever the casing", t => {
  const { inScope } = deriveScope({ rootDir: fixture(t), ledger });
  const hits = inScope.find(item => item.id === "R-10")?.hits;
  assert.deepEqual(hits?.map(hit => [hit.at, hit.kind, hit.binding, hit.mappedBy]), [["apps/studio/services.ts:6", "call", "resolveRegions", "module"]]);
});

test("a type-only import or typeof position is not a hit", t => {
  const { inScope, postV1Rows } = deriveScope({ rootDir: fixture(t), ledger });
  assert.ok(postV1Rows.includes("R-11"));
  assert.ok(!inScope.find(item => item.id === "R-12")?.hits.some(hit => hit.at.endsWith(":9")), "typeof dragTransport is a type position");
});

test("a value passed along is a call hit, and expo-controls subpaths resolve under src/components", t => {
  const { inScope } = deriveScope({ rootDir: fixture(t), ledger });
  const hit = id => inScope.find(item => item.id === id)?.hits.map(item => [item.at, item.kind, item.mappedBy]);
  assert.deepEqual(hit("R-12"), [["apps/studio/services.ts:7", "call", "module"]]);
  assert.deepEqual(hit("R-13"), [["apps/studio/services.ts:7", "call", "module"]]);
});

test("unknown Tron names are reported with their locations, not dropped", t => {
  const rootDir = fixture(t);
  const { unmapped } = deriveScope({ rootDir, ledger });
  assert.deepEqual(unmapped, [
    { module: "@nyc-tron/ui", names: ["Mystery"], uses: ["apps/studio/index.tsx:13"] },
    { module: "@nyc-tron/ui/components/forge/timebase", names: ["formatTime"], uses: ["apps/studio/services.ts:8"] },
  ], "an unknown module is reported with its names and locations, not dropped");
});

test("owner rulings add a basis or a NOT RUN platform, and fail when stale", t => {
  const rootDir = fixture(t);
  const { inScope } = deriveScope({ rootDir, ledger, decisions: {
    "R-03": { decision: "D9", basis: "required by a release gate." },
    "R-10": { decision: "D9", notRun: { web: "NOT RUN: no web transport." }, requiresUnmapped: "formatTime" },
  } });
  const ruled = inScope.find(item => item.id === "R-03"), noted = inScope.find(item => item.id === "R-10");
  assert.deepEqual([ruled?.basis, ruled?.hits], ["D9: required by a release gate.", []]);
  assert.deepEqual(noted?.notRun, { decision: "D9", web: "NOT RUN: no web transport." });
  assert.throws(() => deriveScope({ rootDir, ledger, decisions: { "R-07": { decision: "D9", notRun: { web: "x" } } } }), /stale/);
  assert.throws(() => deriveScope({ rootDir, ledger, decisions: { "R-10": { decision: "D9", requiresUnmapped: "Mapped" } } }), /now maps or is unused/);
  assert.throws(() => deriveScope({ rootDir, ledger, decisions: { "X-99": { decision: "D9", basis: "x" } } }), /unknown row/);
});

test("lexical scan ignores comments, generics and closing tags and survives apostrophes in JSX text", () => {
  const source = [
    "import { Knob } from '@nyc-tron/ui/components/forge/inputs/Knob';",
    "/* <Knob /> */ const a = useState<Knob>(null);",
    "const b = <Text>Don't</Text>;",
    "const c = <Knob>x</Knob>; // <Knob />",
    "const d = { slot: Knob, Knob: 1 };",
  ].join("\n");
  assert.equal(stripComments("a // b\n/* c\nd */ e").split("\n").length, 3);
  const info = parseModule(source);
  assert.deepEqual(info.imports.map(item => [item.spec, item.bindings]), [["@nyc-tron/ui/components/forge/inputs/Knob", [{ imported: "Knob", local: "Knob", typeOnly: false }]]]);
  assert.deepEqual(usages(info, "Knob", true).map(use => [use.line, use.kind]), [[4, "jsx"], [5, "value"]]);
  assert.deepEqual(usages(info, "Knob", false).map(use => use.kind), ["value"], "a .ts file has no JSX");
});

test("--check passes on fresh output and fails when output or source changes", t => {
  const rootDir = fixture(t);
  mkdirSync(join(rootDir, "docs/completion"), { recursive: true });
  writeFileSync(join(rootDir, LEDGER_PATH), JSON.stringify(ledger));
  assert.equal(run({ rootDir, check: true, decisions: {} }).ok, false, "missing output is stale");
  assert.equal(run({ rootDir, decisions: {} }).ok, true);
  assert.equal(run({ rootDir, check: true, decisions: {} }).ok, true);
  const document = JSON.parse(readFileSync(join(rootDir, OUTPUT_PATH), "utf8"));
  assert.deepEqual(document.postV1.platforms, [...POST_V1_PLATFORMS]);
  assert.deepEqual(document.postV1.platforms, ["macos", "windows", "visionos", "quest", "pico"]);
  assert.equal(document.postV1.status, "NOT RUN");
  assert.equal(document.v1.rowCount + document.postV1.rowCount, document.ledgerRowCount);
  writeFileSync(join(rootDir, "apps/studio/tests/knob.test.tsx"), "export {};\n");
  assert.equal(run({ rootDir, check: true, decisions: {} }).ok, true, "files outside the reachable graph do not change the output");
  writeFileSync(join(rootDir, "apps/studio/panel.native.tsx"), "export const Panel = () => null;\n");
  const stale = run({ rootDir, check: true, decisions: {} });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /stale/);
});

test("the committed repository scope is current and partitions the ledger", () => {
  assert.equal(run({ check: true }).ok, true, "run node tooling/derive-v1-component-scope.mjs");
  const document = JSON.parse(readFileSync(new URL("../../" + OUTPUT_PATH, import.meta.url), "utf8"));
  const real = JSON.parse(readFileSync(new URL("../../" + LEDGER_PATH, import.meta.url), "utf8"));
  const all = [...real.components, ...real.additions].map(item => item.id).sort();
  const v1 = document.v1.rows.map(item => item.id);
  assert.deepEqual([...v1, ...document.postV1.rows].sort(), all, "every ledger row is either v1 or post-v1, once");
  assert.ok(document.v1.rows.every(item => item.hits.length > 0 || item.basis.startsWith("D")));
  assert.match(document.v1.rows.find(item => item.id === "A-20").basis, /^D4: F8 item 5/);
  assert.equal(document.v1.rows.find(item => item.id === "N-21").notRun.web.startsWith("NOT RUN"), true);
});
