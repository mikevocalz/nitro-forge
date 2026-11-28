import test from "node:test";
import assert from "node:assert/strict";
import { fillTarget, fillFromEdge } from "../src/spreadsheet/fill-handle.ts";
import {
  colorReferences, formulaSegments, referenceEdges, REFERENCE_TONE_CLASSES, REFERENCE_TONE_COUNT,
} from "../src/spreadsheet/reference-colors.ts";
import {
  sheetNameError, nextSheetName, duplicateSheetName, sheetTabKeyTarget, sheetTabMoveIndex, MAX_SHEET_NAME_LENGTH,
} from "../src/spreadsheet/sheet-tabs-model.ts";
import { chartSeriesFromCells, parseA1Range, MAX_CHART_CELLS } from "../src/spreadsheet/chart-model.ts";
import { sparklineGeometry, sparklineSpecProblem } from "../src/spreadsheet/sparkline-model.ts";
import { freezeFor, splitGeometry, dragSplitRatio } from "../src/spreadsheet/freeze-split-model.ts";
import { sheetCards, CARD_PREVIEW_FIELDS } from "../src/spreadsheet/cards-model.ts";

const bounds = { rowCount: 1_048_576, columnCount: 16_384 };
const r = (startRow, endRow, startColumn, endColumn) => ({ startRow, endRow, startColumn, endColumn });

test("I-02 fill handle follows the dominant axis and never returns the source alone", () => {
  const src = r(1, 2, 1, 1); // B2:B3
  assert.equal(fillTarget(src, { rows: 0, columns: 0 }, bounds), undefined);
  assert.deepEqual(fillTarget(src, { rows: 3, columns: 1 }, bounds), { source: src, direction: "down", target: r(1, 5, 1, 1) });
  assert.deepEqual(fillTarget(src, { rows: 1, columns: 4 }, bounds), { source: src, direction: "right", target: r(1, 2, 1, 5) });
  // Up by one lands inside the 2-row block: nothing. Up by two passes its top edge.
  assert.equal(fillTarget(src, { rows: -1, columns: 0 }, bounds), undefined);
  assert.deepEqual(fillTarget(src, { rows: -2, columns: 0 }, bounds), { source: src, direction: "up", target: r(0, 2, 1, 1) });
  assert.deepEqual(fillTarget(src, { rows: 0, columns: -5 }, bounds), { source: src, direction: "left", target: r(1, 2, 0, 1) });
  // Clamped at the sheet edge; at the edge already, nothing to fill.
  const last = r(bounds.rowCount - 1, bounds.rowCount - 1, 0, 0);
  assert.equal(fillTarget(last, { rows: 5, columns: 0 }, bounds), undefined);
  assert.throws(() => fillTarget(r(0, 0, 0, bounds.columnCount), { rows: 1, columns: 0 }, bounds), /outside the sheet/);
  assert.throws(() => fillTarget(src, { rows: NaN, columns: 0 }, bounds), /finite/);
});

test("I-02 Ctrl+D and Ctrl+R fill from the first row or column", () => {
  assert.deepEqual(fillFromEdge(r(0, 4, 0, 1), "down"), { direction: "down", target: r(0, 4, 0, 1), source: r(0, 0, 0, 1) });
  assert.deepEqual(fillFromEdge(r(0, 4, 0, 3), "right"), { direction: "right", target: r(0, 4, 0, 3), source: r(0, 4, 0, 0) });
  assert.equal(fillFromEdge(r(2, 2, 0, 3), "down"), undefined);
  assert.equal(fillFromEdge(r(0, 4, 3, 3), "right"), undefined);
});

test("I-06 references keep one tone per distinct reference, ignoring $ and case", () => {
  const refs = colorReferences("=SUM(B2:B9)+b2+$B$2:$B$9+C1+'Other'!A1+Sheet1!D4", "sheet1");
  assert.deepEqual(refs.map(x => [x.text, x.tone, x.onSheet]), [
    ["B2:B9", 0, true], ["b2", 1, true], ["$B$2:$B$9", 0, true], ["C1", 2, true],
    ["'Other'!A1", 3, false], ["Sheet1!D4", 4, true],
  ]);
  // Tones wrap after REFERENCE_TONE_COUNT distinct references.
  const many = colorReferences("=" + Array.from({ length: REFERENCE_TONE_COUNT + 1 }, (_, i) => "A" + (i + 1)).join("+"));
  assert.equal(many.at(-1).tone, 0);
  assert.equal(REFERENCE_TONE_CLASSES.length, REFERENCE_TONE_COUNT);
  for (const tone of REFERENCE_TONE_CLASSES) {
    for (const cls of Object.values(tone)) assert.doesNotMatch(cls, /#|rgb|danger/, "token classes only, never danger");
  }
  assert.deepEqual(colorReferences("plain text"), []);
});

test("I-06 formula segments rebuild the formula and mark reference runs", () => {
  const f = '=IF(A1>0,"B2 in quotes",C3:D4)';
  const segs = formulaSegments(f, colorReferences(f));
  assert.equal(segs.map(s => s.text).join(""), f);
  assert.deepEqual(segs.filter(s => s.tone !== undefined).map(s => s.text), ["A1", "C3:D4"]);
  assert.deepEqual(referenceEdges(r(2, 4, 2, 3), 2, 3), { top: true, bottom: false, start: false, end: true });
});

test("I-08 sheet names follow spreadsheet rules and stay unique", () => {
  const tabs = [{ id: "0", name: "Sheet1" }, { id: "1", name: "Budget" }];
  assert.equal(sheetNameError("Q3", tabs), undefined);
  assert.match(sheetNameError("  ", tabs), /Enter a sheet name/);
  assert.match(sheetNameError("budget", tabs), /already exists/);
  assert.equal(sheetNameError("Budget", tabs, "1"), undefined, "renaming to its own name");
  assert.match(sheetNameError("a/b", tabs), /can't contain/);
  assert.match(sheetNameError("'x", tabs), /apostrophe/);
  assert.match(sheetNameError("x".repeat(MAX_SHEET_NAME_LENGTH + 1), tabs), /31 characters/);
  assert.equal(nextSheetName(tabs), "Sheet3");
  assert.equal(nextSheetName([{ id: "a", name: "Sheet2" }]), "Sheet3");
  assert.equal(duplicateSheetName("Budget", [...tabs, { id: "2", name: "Budget (2)" }]), "Budget (3)");
  assert.equal(duplicateSheetName("x".repeat(31), []).length, 31);
});

test("I-08 tab keyboard follows reading direction", () => {
  const tabs = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  assert.equal(sheetTabKeyTarget(tabs, "a", "ArrowRight"), "b");
  assert.equal(sheetTabKeyTarget(tabs, "a", "ArrowLeft"), "a");
  assert.equal(sheetTabKeyTarget(tabs, "a", "ArrowLeft", true), "b");
  assert.equal(sheetTabKeyTarget(tabs, "b", "End"), "c");
  assert.equal(sheetTabKeyTarget(tabs, "c", "Home"), "a");
  assert.equal(sheetTabKeyTarget(tabs, "a", "x"), undefined);
  assert.equal(sheetTabMoveIndex(tabs, "a", -1), undefined);
  assert.equal(sheetTabMoveIndex(tabs, "b", 1), 2);
});

test("I-13 chart series come from computed numbers; text and blanks are skipped, not zero", () => {
  const cells = {
    A1: { computed: "Month" }, B1: { computed: "Sales" }, C1: { computed: "Costs" },
    A2: { computed: 1 }, B2: { computed: 10 }, C2: { computed: 4 },
    A3: { computed: 2 }, B3: { computed: "n/a" }, C3: { computed: 5 },
    A4: { computed: 3 }, B4: { computed: 30 }, C4: null,
  };
  const spec = { kind: "line", range: "A1:C4", seriesIn: "columns", hasHeader: true, hasXValues: true };
  const data = chartSeriesFromCells(spec, cells);
  assert.deepEqual(data.series.map(s => [s.label, s.points]), [
    ["Sales", [{ x: 1, y: 10 }, { x: 3, y: 30 }]],
    ["Costs", [{ x: 1, y: 4 }, { x: 2, y: 5 }]],
  ]);
  assert.equal(data.skippedCells, 2);
  const byRows = chartSeriesFromCells({ ...spec, range: "B2:C4", seriesIn: "rows", hasHeader: false, hasXValues: false }, cells);
  assert.deepEqual(byRows.series.map(s => s.label), ["Series 1", "Series 2", "Series 3"]);
  assert.deepEqual(byRows.series[0].points, [{ x: 1, y: 10 }, { x: 2, y: 4 }]);
  const named = { ...cells, A2: { computed: "Jan" }, A3: { computed: "Feb" }, A4: { computed: "Mar" } };
  const labelsToo = chartSeriesFromCells({ ...spec, hasXValues: false }, named);
  assert.deepEqual(labelsToo.series.map(s => s.label), ["Sales", "Costs"], "a text-only label column is not a series");
  assert.equal(labelsToo.skippedCells, 5, "3 month labels + n/a + blank");
  const dup = chartSeriesFromCells({ ...spec, range: "B1:B2", hasXValues: false },
    { B1: { computed: "Sales" }, B2: { computed: 1 } });
  assert.equal(dup.series[0].label, "Sales");
  assert.deepEqual(parseA1Range("$c$9:a1"), r(0, 8, 0, 2));
  assert.equal(parseA1Range("A1:B2:C3"), undefined);
  assert.throws(() => chartSeriesFromCells({ ...spec, range: "nope" }, cells), /not a cell range/);
  assert.throws(() => chartSeriesFromCells({ ...spec, range: "A1:Z1000" }, cells), new RegExp(String(MAX_CHART_CELLS)));
});

test("I-14 sparkline geometry: gaps break lines, flat data sits mid-height, win/loss splits at center", () => {
  const line = sparklineGeometry([1, 3, undefined, 2, 5], { kind: "line", width: 100, height: 20, showHigh: true, showLow: true });
  assert.equal(line.segments.length, 2, "the gap at index 2 breaks the line");
  assert.equal(line.highIndex, 4);
  assert.equal(line.lowIndex, 0);
  assert.deepEqual(line.markers.map(m => m.tone), ["low", "high"]);
  const flat = sparklineGeometry([4, 4, 4], { kind: "column", width: 30, height: 10 });
  assert.ok(flat.bars.every(b => Number.isFinite(b.top) && b.height >= 1));
  const zero = sparklineGeometry([2, -2], { kind: "column", width: 20, height: 20, axisMin: "zero" });
  assert.deepEqual(zero.bars.map(b => [b.top, b.height, b.tone]), [[0, 10, "normal"], [10, 10, "negative"]]);
  const wl = sparklineGeometry([3, 0, -1], { kind: "winloss", width: 30, height: 10 });
  assert.deepEqual(wl.bars.map(b => [b.index, b.top]), [[0, 0], [2, 5]]);
  assert.equal(sparklineGeometry([undefined], { kind: "line", width: 10, height: 10 }).valueCount, 0);
  assert.throws(() => sparklineGeometry([1], { kind: "line", width: 0, height: 10 }), /positive/);
  const spec = { kind: "line", dataRange: "B2:M2", location: "N2", showHigh: false, showLow: false, showNegative: true, axisMin: "auto" };
  assert.equal(sparklineSpecProblem(spec, parseA1Range), undefined);
  assert.equal(sparklineSpecProblem({ ...spec, dataRange: "B2:C3" }, parseA1Range)?.field, "dataRange");
  assert.equal(sparklineSpecProblem({ ...spec, location: "N2:N3" }, parseA1Range)?.field, "location");
});

test("I-17 freeze commands and split geometry", () => {
  assert.deepEqual(freezeFor("top-row"), { frozenRows: 1, frozenColumns: 0 });
  assert.deepEqual(freezeFor("at-selection", "C4"), { frozenRows: 3, frozenColumns: 2 });
  assert.deepEqual(freezeFor("none", "C4"), { frozenRows: 0, frozenColumns: 0 });
  assert.throws(() => freezeFor("at-selection", undefined), /Select a cell/);
  const g = splitGeometry(812, 0.5);
  assert.equal(g.first + g.divider + g.second, 812);
  assert.equal(splitGeometry(812, 0.01).first, 136, "a pane never shrinks below the minimum");
  assert.equal(splitGeometry(200, 0.9).ratio, 0.5, "too small for two minimum panes: share evenly");
  assert.ok(dragSplitRatio(812, 0.5, 100) > 0.5);
  assert.equal(dragSplitRatio(812, 0.5, -10_000), 136 / 800);
});

test("I-20 cards: header names fields, first column titles, blanks read (blank)", () => {
  const cells = {
    A1: { raw: "Name", computed: "Name" }, B1: { raw: "Qty", computed: "Qty" }, C1: { raw: "", computed: null },
    A2: { raw: "Pens", computed: "Pens" }, B2: { raw: "=2*3", computed: 6 }, C2: { raw: "x", computed: "x" },
    B3: { raw: "1", computed: 1 },
  };
  const cards = sheetCards(r(0, 2, 0, 2), cells);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].fields.map(f => [f.name, f.address, f.raw, f.display]), [
    ["Name", "A2", "Pens", "Pens"], ["Qty", "B2", "=2*3", "6"], ["C", "C2", "x", "x"],
  ]);
  assert.equal(cards[1].title, "(blank)");
  assert.equal(cards[1].row, 2);
  assert.equal(CARD_PREVIEW_FIELDS, 3);
  assert.throws(() => sheetCards(r(0, 0, 0, 2), cells), /header row/);
});
