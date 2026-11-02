import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspace, dockPanel, collapsePanel, floatPanel, resizeDock,
  parsePreset, serializePreset, stageFits, type Layout,
} from "./index.ts";

const known = new Set(["tools", "layers", "assets", "inspector", "timeline"]);
const wide = { width: 1300, height: 800, minStageWidth: 500, minStageHeight: 330 };
function withLayers(): Layout {
  const result = dockPanel(createWorkspace("prism"), "layers", "left", 0, known, wide);
  assert.equal(result.ok, true);
  return result.layout;
}

test("persist and restore a versioned panel configuration safely", () => {
  const l = withLayers();
  assert.deepEqual(parsePreset(serializePreset(l, known), known), l);
  assert.equal(parsePreset("{", known), null);
  const copy = JSON.parse(JSON.stringify(l));
  copy.docks.right = ["layers"];
  assert.equal(parsePreset(JSON.stringify(copy), known), null);
  copy.docks.right = ["unknown"];
  assert.equal(parsePreset(JSON.stringify(copy), known), null);
  copy.docks.right = [];
  copy.activeTabs = { right: "layers" };
  assert.equal(parsePreset(JSON.stringify(copy), known), null);
});
test("move a panel exactly once without mutating its previous layout", () => {
  const l = withLayers();
  const result = dockPanel(l, "layers", "right", 0, known, wide);
  assert.equal(result.ok, true);
  assert.deepEqual(result.layout.docks.left, []);
  assert.deepEqual(result.layout.docks.right, ["layers"]);
  assert.deepEqual(l.docks.left, ["layers"]);
  assert.equal(dockPanel(l, "unknown", "left", 0, known, wide).ok, false);
  assert.equal(dockPanel(l, "layers", "left", 5, known, wide).ok, false);
});
test("keep stage minimum space when docking or resizing panels", () => {
  const first = withLayers();
  const right = dockPanel(first, "inspector", "right", 0, known, wide);
  assert.equal(right.ok, true);
  const narrow = { width: 700, height: 800, minStageWidth: 450, minStageHeight: 300 };
  assert.equal(stageFits(right.layout, narrow), false);
  const denied = resizeDock(right.layout, "right", 0.45, narrow);
  assert.equal(denied.ok, false);
  assert.equal(denied.layout.sizes.rightFraction, 0.24);
});
test("collapse and reopen keep a panel and select a live tab", () => {
  const l = withLayers();
  const added = dockPanel(l, "assets", "left", 1, known);
  assert.equal(added.ok, true);
  const closed = collapsePanel(added.layout, "assets", true);
  assert.equal(closed.ok, true);
  assert.deepEqual(closed.layout.docks.left, ["layers", "assets"]);
  assert.equal(closed.layout.activeTabs.left, "layers");
  assert.deepEqual(closed.layout.collapsed, ["assets"]);
  const reopened = collapsePanel(closed.layout, "assets", false);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.layout.activeTabs.left, "assets");
});
test("floating panels require valid normalized host-relative rectangles", () => {
  const l = withLayers();
  const f = floatPanel(l, "layers", { x: 0.5, y: 0.3, width: 0.4, height: 0.3 }, known);
  assert.equal(f.ok, true);
  assert.deepEqual(f.layout.docks.left, []);
  assert.deepEqual(parsePreset(JSON.stringify(f.layout), known), f.layout);
  assert.equal(floatPanel(l, "layers", { x: 0.8, y: 0.3, width: 0.4, height: 0.3 }, known).ok, false);
});
test("reject bad viewport measurements and untenable bottom dock sizes", () => {
  let l = withLayers();
  assert.equal(stageFits(l, { width: 0, height: 800, minStageWidth: 400, minStageHeight: 300 }), false);
  const added = dockPanel(l, "timeline", "bottom", 0, known, wide);
  assert.equal(added.ok, true);
  l = added.layout;
  const denied = resizeDock(l, "bottom", 0.5, {
    width: 1300, height: 500, minStageWidth: 500, minStageHeight: 330,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.layout.sizes.bottomFraction, 0.27);
});
