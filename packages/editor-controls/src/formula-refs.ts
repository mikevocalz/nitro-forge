import type { SheetRange } from "./sheet-window.ts";

/** One A1-style reference found by {@linkcode formulaReferences}. */
export interface FormulaReference {
  /** The reference exactly as written, including any sheet prefix and `$` markers. */
  readonly text: string;
  /** Offset of the first character in the formula text. */
  readonly start: number;
  /** Offset one past the last character. */
  readonly end: number;
  /** Sheet name for `Sheet2!A1` or `'Q1 Plan'!A1`; `undefined` for the current sheet. */
  readonly sheet?: string;
  readonly range: SheetRange;
}

/** Excel's grid limits, used to reject tokens like `ABCD1` or `A0` that only look like references. */
export const MAX_SHEET_ROWS = 1_048_576;
export const MAX_SHEET_COLUMNS = 16_384;

const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!`;
const CELL = String.raw`\$?([A-Za-z]{1,3})\$?([0-9]{1,7})`;
const REF = new RegExp(String.raw`(?:${SHEET})?${CELL}(?::${CELL})?`, "y");
const SINGLE = new RegExp(String.raw`(?:${SHEET})?${CELL}`, "y");

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const NAME_CHAR = /[A-Za-z0-9_.$]/;

function matchReference(text: string, at: number, pattern: RegExp): FormulaReference | undefined {
  pattern.lastIndex = at;
  const m = pattern.exec(text);
  if (!m) return undefined;
  const end = at + m[0].length;
  const next = text[end];
  if (next !== undefined && (NAME_CHAR.test(next) || next === "(" || next === "!")) return undefined;
  const startColumn = columnIndex(m[3]!);
  const startRow = Number(m[4]) - 1;
  const endColumn = m[5] ? columnIndex(m[5]) : startColumn;
  const endRow = m[6] ? Number(m[6]) - 1 : startRow;
  const inGrid = [startRow, endRow].every(r => r >= 0 && r < MAX_SHEET_ROWS) &&
    [startColumn, endColumn].every(c => c >= 0 && c < MAX_SHEET_COLUMNS);
  if (!inGrid) return undefined;
  const sheet = m[1] !== undefined ? m[1].replaceAll("''", "'") : m[2];
  const range: SheetRange = {
    startRow: Math.min(startRow, endRow), endRow: Math.max(startRow, endRow),
    startColumn: Math.min(startColumn, endColumn), endColumn: Math.max(startColumn, endColumn),
  };
  return sheet === undefined ? { text: m[0], start: at, end, range } : { text: m[0], start: at, end, sheet, range };
}

/**
 * Tokenizes the A1 references in a formula (text starting with `=`). Handles
 * `$` absolute markers, `A1:B9` ranges and sheet-qualified references. Text
 * inside string literals, function names such as `LOG10(`, and out-of-grid
 * tokens are skipped. Returns an empty list for non-formula input.
 */
export function formulaReferences(text: string): FormulaReference[] {
  if (!text.startsWith("=")) return [];
  const out: FormulaReference[] = [];
  let i = 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      // String literal; "" is an escaped quote.
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }
    const startsToken = (ch === "'" || NAME_CHAR.test(ch)) && (i === 0 || !NAME_CHAR.test(text[i - 1]!));
    if (startsToken) {
      // Try the range form first, then a single cell, so "A1:LOG10(B1)" still yields A1.
      const ref = matchReference(text, i, REF) ?? matchReference(text, i, SINGLE);
      if (ref) {
        out.push(ref);
        i = ref.end;
        continue;
      }
      // Skip the rest of this identifier so "SUMA1" never yields "A1".
      if (ch === "'") {
        i++;
        while (i < text.length && text[i] !== "'") i++;
        i++;
      } else {
        while (i < text.length && NAME_CHAR.test(text[i]!)) i++;
      }
      continue;
    }
    i++;
  }
  return out;
}

/** A highlighted rectangle derived from the formula bar; `index` is the reference's order in the formula. */
export interface ReferenceHighlight {
  readonly index: number;
  readonly text: string;
  readonly range: SheetRange;
}
/**
 * References to highlight on the visible sheet. References qualified with
 * another sheet's name are dropped; a reference qualified with `sheetName`
 * (compared case-insensitively, as spreadsheets do) is kept.
 */
export function referenceHighlights(formula: string, sheetName?: string): ReferenceHighlight[] {
  const current = sheetName?.toLowerCase();
  return formulaReferences(formula)
    .filter(ref => ref.sheet === undefined || (current !== undefined && ref.sheet.toLowerCase() === current))
    .map((ref, index) => ({ index, text: ref.text, range: ref.range }));
}
