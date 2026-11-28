import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  reanchorSheetScroll, responsiveSheetMetrics, revealCellScroll, frozenSheetWindow, sheetWindow,
} from "../src/sheet-window.ts";

// Pure geometry only. These tests do not rotate a device or fold a hinge; they
// model the viewport sizes a rotation or hinge split hands the grid.
const VIEWPORTS = {
  portrait: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
  hingeLeftHalf: { width: 540, height: 720 },
  hingeRightHalf: { width: 372, height: 720 },
  tablet: { width: 1024, height: 768 },
};
const FORMULA_BAR = 46;

const layout = (viewport, extra = {}) => {
  const m = responsiveSheetMetrics({ width: viewport.width });
  const gridHeight = viewport.height - (m.compact ? m.formulaBarHeight : FORMULA_BAR);
  return {
    m, gridHeight,
    bodyWidth: viewport.width - m.rowHeaderWidth,
    bodyHeight: gridHeight - m.columnHeaderHeight,
    ...extra,
  };
};

// What the grid does on a size change: scale body offsets per axis (inline
// ratio in SpreadsheetGrid), then reveal the focused cell.
function settle(scroll, from, to, cell, frozen = {}) {
  const ratio = {
    x: scroll.x * to.m.columnWidth / from.m.columnWidth,
    y: scroll.y * to.m.rowHeight / from.m.rowHeight,
  };
  return revealCellScroll({
    ...cell, scrollX: ratio.x, scrollY: ratio.y, bodyWidth: to.bodyWidth, bodyHeight: to.bodyHeight,
    rowHeight: to.m.rowHeight, columnWidth: to.m.columnWidth, ...frozen,
  });
}

function assertVisible(cell, scroll, to, frozen = {}) {
  const fr = frozen.frozenRows ?? 0, fc = frozen.frozenColumns ?? 0;
  if (cell.row >= fr) {
    const top = (cell.row - fr) * to.m.rowHeight;
    assert.ok(top >= scroll.y - 1e-9, `row top ${top} above scrollY ${scroll.y}`);
    assert.ok(top + to.m.rowHeight <= scroll.y + to.bodyHeight + 1e-9, "row bottom below viewport");
  }
  if (cell.column >= fc) {
    const left = (cell.column - fc) * to.m.columnWidth;
    assert.ok(left >= scroll.x - 1e-9, "column left of viewport");
    assert.ok(left + to.m.columnWidth <= scroll.x + to.bodyWidth + 1e-9, "column right of viewport");
  }
}

test("selected cell stays visible across every viewport transition", () => {
  const cell = { row: 1200, column: 40 };
  const names = Object.keys(VIEWPORTS);
  for (const from of names) {
    for (const to of names) {
      const a = layout(VIEWPORTS[from]), b = layout(VIEWPORTS[to]);
      const start = revealCellScroll({
        ...cell, scrollX: 0, scrollY: 0, bodyWidth: a.bodyWidth, bodyHeight: a.bodyHeight,
        rowHeight: a.m.rowHeight, columnWidth: a.m.columnWidth,
      });
      assertVisible(cell, start, a);
      const next = settle(start, a, b, cell);
      assertVisible(cell, next, b);
    }
  }
});

test("a cell near the bottom of portrait stays reachable after rotating to the shorter landscape", () => {
  const portrait = layout(VIEWPORTS.portrait), landscape = layout(VIEWPORTS.landscape);
  const cell = { row: 10, column: 2 };
  const scroll = { x: 0, y: 0 };
  assertVisible(cell, scroll, portrait);
  assert.throws(() => assertVisible(cell, scroll, landscape), "unadjusted scroll hides the cell in landscape");
  assertVisible(cell, settle(scroll, portrait, landscape, cell), landscape);
});

test("the top-left logical cell stays anchored when only the viewport size changes", () => {
  const a = layout(VIEWPORTS.tablet), b = layout(VIEWPORTS.hingeLeftHalf);
  assert.equal(a.m.rowHeight, b.m.rowHeight);
  const scroll = { x: 112 * 10, y: 32 * 500 };
  const cell = { row: 500, column: 10 };
  assert.deepEqual(settle(scroll, a, b, cell), scroll);
});

test("a cell already in view does not move the scroll", () => {
  const a = layout(VIEWPORTS.tablet);
  const scroll = { x: 112 * 3, y: 32 * 100 };
  assert.deepEqual(settle(scroll, a, a, { row: 102, column: 4 }), scroll);
});

test("frozen rows and columns never scroll the focused cell out of place", () => {
  const frozen = { frozenRows: 2, frozenColumns: 1 };
  const a = layout(VIEWPORTS.tablet), b = layout(VIEWPORTS.hingeRightHalf);
  for (const cell of [{ row: 0, column: 0 }, { row: 1, column: 5 }, { row: 3000, column: 1 }, { row: 3000, column: 80 }]) {
    const next = settle({ x: 0, y: 0 }, a, b, cell, frozen);
    assertVisible(cell, next, b, frozen);
  }
  const fz = settle({ x: 500, y: 700 }, a, b, { row: 0, column: 0 }, frozen);
  assert.equal(fz.x, 500 * b.m.columnWidth / a.m.columnWidth);
});

test("reanchorSheetScroll round-trips through every pair of responsive metrics", () => {
  const names = Object.keys(VIEWPORTS);
  const pos = { x: 52 + 112 * 17.25, y: 32 * 9000.5 };
  for (const from of names) for (const to of names) {
    const a = responsiveSheetMetrics({ width: VIEWPORTS[from].width });
    const b = responsiveSheetMetrics({ width: VIEWPORTS[to].width });
    const there = reanchorSheetScroll(pos, a, b);
    const back = reanchorSheetScroll(there, b, a);
    assert.ok(Math.abs(back.x - pos.x) < 1e-6 && Math.abs(back.y - pos.y) < 1e-6, `${from} -> ${to}`);
  }
});

test("reanchorSheetScroll keeps the same row index at the top edge", () => {
  const a = responsiveSheetMetrics({ width: 844 }), b = responsiveSheetMetrics({ width: 390 });
  const topRow = 4321;
  const after = reanchorSheetScroll({ x: 0, y: a.rowHeight * topRow }, a, b);
  assert.equal(after.y / b.rowHeight, topRow);
});

test("reanchorSheetScroll treats the row-header strip separately from the body", () => {
  const a = { rowHeight: 32, columnWidth: 100, rowHeaderWidth: 52 };
  const b = { rowHeight: 32, columnWidth: 200, rowHeaderWidth: 48 };
  assert.deepEqual(reanchorSheetScroll({ x: 26, y: 0 }, a, b), { x: 24, y: 0 });
  assert.deepEqual(reanchorSheetScroll({ x: 52, y: 0 }, a, b), { x: 48, y: 0 });
  assert.deepEqual(reanchorSheetScroll({ x: 152, y: 0 }, a, b), { x: 248, y: 0 });
});

test("reanchorSheetScroll rejects non-finite, negative and zero anchors", () => {
  const m = { rowHeight: 32, columnWidth: 100, rowHeaderWidth: 52 };
  assert.throws(() => reanchorSheetScroll({ x: NaN, y: 0 }, m, m), RangeError);
  assert.throws(() => reanchorSheetScroll({ x: 0, y: -1 }, m, m), RangeError);
  assert.throws(() => reanchorSheetScroll({ x: 0, y: 0 }, m, { ...m, rowHeaderWidth: 0 }), RangeError);
  assert.throws(() => reanchorSheetScroll({ x: 0, y: 0 }, { ...m, columnWidth: Infinity }, m), RangeError);
});

test("the render window always includes the revealed cell at every viewport", () => {
  const cell = { row: 99_999, column: 300 };
  for (const viewport of Object.values(VIEWPORTS)) {
    const l = layout(viewport);
    const s = revealCellScroll({
      ...cell, scrollX: 0, scrollY: 0, bodyWidth: l.bodyWidth, bodyHeight: l.bodyHeight,
      rowHeight: l.m.rowHeight, columnWidth: l.m.columnWidth,
    });
    const win = frozenSheetWindow({
      rowCount: 1_048_576, columnCount: 16_384, scrollX: s.x, scrollY: s.y,
      viewportWidth: viewport.width, viewportHeight: l.gridHeight, rowHeight: l.m.rowHeight,
      columnWidth: l.m.columnWidth, rowHeaderWidth: l.m.rowHeaderWidth, columnHeaderHeight: l.m.columnHeaderHeight,
    }).body;
    assert.ok(cell.row >= win.rows.start && cell.row < win.rows.end, "row in window");
    assert.ok(cell.column >= win.columns.start && cell.column < win.columns.end, "column in window");
  }
});

const grid = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/SpreadsheetGrid.tsx"), "utf8");

test("SpreadsheetGrid reveals the focused cell when the body viewport changes size", () => {
  // Source check: the grid must run a reveal effect keyed on the body size,
  // not only on keyboard moves.
  assert.match(grid, /useEffect\(\(\)=>\{[^]*?revealFocusRef\.current\(\);\},\[[^\]]*bodyHeight[^\]]*bodyWidth/);
});
