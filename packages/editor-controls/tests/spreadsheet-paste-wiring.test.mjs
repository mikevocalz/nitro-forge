import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Source-level contract: the grid is not rendered here. These checks prove the
// props and handlers exist and are gated like copy, not that a clipboard,
// browser or screen reader delivers the text.
const here = dirname(fileURLToPath(import.meta.url));
const grid = readFileSync(resolve(here, "../src/SpreadsheetGrid.tsx"), "utf8");

test("SpreadsheetGrid declares controlled paste props", () => {
  assert.match(grid, /readonly onPasteRange\?:\s*\(anchor:\s*CellPosition,\s*cells:\s*readonly PasteCell\[\]\)/);
  assert.match(grid, /readonly maxPasteCells\?:\s*number/);
  assert.match(grid, /readonly readClipboard\?:/);
  assert.match(grid, /from ["']\.\/range-paste\.ts["']/);
});

test("paste is wired to Ctrl/Cmd+V, the paste event and a screen-reader action", () => {
  assert.match(grid, /key==="v"\|\|key==="V"/);
  assert.match(grid, /name:"paste"/);
  assert.match(grid, /name==="paste"/);
  assert.match(grid, /onPaste:\(e:/);
});

test("paste goes through the owned-action guard and is blocked when read-only or disabled", () => {
  assert.match(grid, /guard\.run\('paste'/);
  assert.match(grid, /onPasteRange=\{props\.onPasteRange&&!props\.readOnly&&props\.disabledReason===undefined/);
});

test("the grid does not write cells itself when pasting", () => {
  const body = grid.slice(grid.indexOf("const paste="), grid.indexOf("// Fill is an engine write"));
  assert.ok(body.length > 0);
  assert.ok(!/onCommitCell/.test(body));
  assert.ok(!/state\.setState\(\{cells/.test(body));
});
