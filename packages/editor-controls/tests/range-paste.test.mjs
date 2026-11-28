import test from "node:test";
import assert from "node:assert/strict";
import { parseTsv, tsvToRange, PasteTooLargeError } from "../src/range-paste.ts";
import { rangeToTsv } from "../src/range-tsv.ts";

test("parseTsv splits tabs and newlines, accepting LF, CRLF and CR", () => {
  assert.deepEqual(parseTsv("a\tb\nc\td"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseTsv("a\tb\r\nc\td"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseTsv("a\rb"), [["a"], ["b"]]);
});

test("parseTsv drops one trailing newline but keeps interior and extra blank rows", () => {
  assert.deepEqual(parseTsv("a\tb\n"), [["a", "b"]]);
  assert.deepEqual(parseTsv("a\r\n"), [["a"]]);
  assert.deepEqual(parseTsv("a\n\nb"), [["a"], [""], ["b"]]);
  assert.deepEqual(parseTsv("a\n\n"), [["a"], [""]]);
});

test("parseTsv returns no rows for empty input", () => {
  assert.deepEqual(parseTsv(""), []);
  assert.deepEqual(parseTsv("\n"), [[""]]);
});

test("parseTsv keeps empty fields", () => {
  assert.deepEqual(parseTsv("\t\tx\ny\t\t"), [["", "", "x"], ["y", "", ""]]);
});

test("parseTsv unquotes fields with embedded tabs, newlines and quotes", () => {
  assert.deepEqual(parseTsv('"a\tb"\t"line1\nline2"\t"say ""hi"""'), [["a\tb", "line1\nline2", 'say "hi"']]);
  assert.deepEqual(parseTsv('"x\r\ny"\r\nz'), [["x\r\ny"], ["z"]]);
  assert.deepEqual(parseTsv('"trailing\n"\n'), [["trailing\n"]]);
});

test("parseTsv treats a quote in the middle of a field literally and tolerates an unterminated quote", () => {
  assert.deepEqual(parseTsv('5" pipe\tb'), [['5" pipe', "b"]]);
  assert.deepEqual(parseTsv('"open\tstill'), [["open\tstill"]]);
});

test("parseTsv preserves ragged rows", () => {
  assert.deepEqual(parseTsv("a\tb\tc\nd\ne\tf"), [["a", "b", "c"], ["d"], ["e", "f"]]);
});

test("parseTsv keeps unicode and sql-looking text intact", () => {
  assert.deepEqual(parseTsv("日本語\t🙂\t'; DROP TABLE x;--"), [["日本語", "🙂", "'; DROP TABLE x;--"]]);
});

test("parseTsv rejects non-string input", () => {
  assert.throws(() => parseTsv(null), TypeError);
  assert.throws(() => parseTsv(undefined), TypeError);
  assert.throws(() => parseTsv(5), TypeError);
});

test("tsvToRange places cells from the anchor and reports the covered range", () => {
  const result = tsvToRange("a\tb\nc\td", { row: 2, column: 3 });
  assert.deepEqual(result.cells, [
    { row: 2, column: 3, value: "a" }, { row: 2, column: 4, value: "b" },
    { row: 3, column: 3, value: "c" }, { row: 3, column: 4, value: "d" },
  ]);
  assert.deepEqual(result.range, { startRow: 2, endRow: 3, startColumn: 3, endColumn: 4 });
  assert.equal(result.clamped, false);
});

test("tsvToRange leaves cells missing from ragged rows out instead of blanking them", () => {
  const result = tsvToRange("a\tb\tc\nd", { row: 0, column: 0 });
  assert.equal(result.cells.length, 4);
  assert.deepEqual(result.range, { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 });
});

test("tsvToRange returns null range and no cells for empty input", () => {
  assert.deepEqual(tsvToRange("", { row: 0, column: 0 }), { cells: [], range: null, clamped: false });
});

test("tsvToRange clamps to the 1,048,576 x 16,384 sheet bounds", () => {
  const result = tsvToRange("a\tb\tc\nd\te\tf\ng\th\ti", { row: 1_048_574, column: 16_382 });
  assert.equal(result.clamped, true);
  assert.deepEqual(result.range, { startRow: 1_048_574, endRow: 1_048_575, startColumn: 16_382, endColumn: 16_383 });
  assert.deepEqual(result.cells.map(c => c.value), ["a", "b", "d", "e"]);
});

test("tsvToRange honors custom bounds and returns nothing when the anchor is outside them", () => {
  const small = tsvToRange("a\tb\nc\td", { row: 0, column: 0 }, { rowCount: 1, columnCount: 1 });
  assert.deepEqual(small.cells, [{ row: 0, column: 0, value: "a" }]);
  assert.equal(small.clamped, true);
  const outside = tsvToRange("a", { row: 5, column: 0 }, { rowCount: 5, columnCount: 5 });
  assert.deepEqual(outside, { cells: [], range: null, clamped: true });
});

test("tsvToRange rejects invalid anchors", () => {
  for (const anchor of [{ row: -1, column: 0 }, { row: 0, column: 1.5 }, { row: NaN, column: 0 }, null]) {
    assert.throws(() => tsvToRange("a", anchor), RangeError);
  }
});

test("tsvToRange throws PasteTooLargeError above maxCells and passes at the cap", () => {
  const text = "a\tb\nc\td";
  assert.equal(tsvToRange(text, { row: 0, column: 0 }, { maxCells: 4 }).cells.length, 4);
  assert.throws(() => tsvToRange(text, { row: 0, column: 0 }, { maxCells: 3 }), err => {
    assert.ok(err instanceof PasteTooLargeError);
    assert.ok(err instanceof RangeError);
    assert.equal(err.name, "PasteTooLargeError");
    assert.equal(err.cellCount, 4);
    assert.equal(err.maxCells, 3);
    return true;
  });
});

test("tsvToRange counts the clamped rectangle against maxCells", () => {
  const text = "a\tb\nc\td";
  const result = tsvToRange(text, { row: 0, column: 0 }, { maxCells: 1, rowCount: 1, columnCount: 1 });
  assert.equal(result.cells.length, 1);
});

test("tsvToRange default cap is 1,000,000 cells", () => {
  const row = Array.from({ length: 1001 }, () => "x").join("\t");
  const text = Array.from({ length: 1000 }, () => row).join("\n");
  assert.throws(() => tsvToRange(text, { row: 0, column: 0 }), PasteTooLargeError);
});

test("round trip: rangeToTsv then tsvToRange returns the same cells", () => {
  const values = [
    ["plain", 42, true, null],
    ['has\ttab', "multi\nline", 'quote "x"', "crlf\r\nvalue"],
    ["日本語", "🙂", "", "'; DROP--"],
  ];
  const range = { startRow: 4, endRow: 6, startColumn: 2, endColumn: 5 };
  for (const lineEnding of ["\n", "\r\n"]) {
    const tsv = rangeToTsv(range, (r, c) => values[r - 4][c - 2], { lineEnding });
    const result = tsvToRange(tsv, { row: 4, column: 2 });
    assert.deepEqual(result.range, range);
    const expected = [];
    values.forEach((rowValues, r) => rowValues.forEach((v, c) =>
      expected.push({ row: 4 + r, column: 2 + c, value: v === null ? "" : String(v) })));
    assert.deepEqual(result.cells, expected);
  }
});

test("large paste parses 100k cells quickly", () => {
  const row = Array.from({ length: 100 }, (_, i) => `v${i}`).join("\t");
  const text = Array.from({ length: 1000 }, () => row).join("\n");
  const start = performance.now();
  const result = tsvToRange(text, { row: 0, column: 0 });
  assert.equal(result.cells.length, 100_000);
  assert.ok(performance.now() - start < 2000);
});
