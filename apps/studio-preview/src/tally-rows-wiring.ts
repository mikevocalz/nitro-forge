import type { CellValidation, FilterRuleInfo, NamedRangeInfo, TallyDocument } from '../../../packages/tally/src/index';
import { parseTallyCellAddress, tallyCellAddress, tallyColumnName } from '../../../packages/tally/src/grid-adapter.ts';

/*
 * Engine side of four NYC-Tron v1.0.0 spreadsheet rows: I-12 SortFilterHeader,
 * I-04 NameBox, I-11 ValidationDropdown and I-07 FillHandleAndAutoFill.
 * No @nyc-tron import: the shapes below mirror the v1.0.0 props structurally,
 * so this module and its tests run without the UI package. Every function
 * validates before its first engine call; nothing is applied optimistically.
 */

/** v1.0.0 `SheetRange`: inclusive, 0-based. */
export interface SheetRangeShape { readonly startRow: number; readonly endRow: number; readonly startColumn: number; readonly endColumn: number }
/** v1.0.0 `SheetSort`. */
export interface SheetSortShape { readonly columnId: string; readonly direction: 'ascending' | 'descending' }
/** v1.0.0 `SheetFilter`. */
export interface SheetFilterShape {
  readonly columnId: string;
  readonly operator: 'all' | 'equals' | 'contains' | 'greater' | 'less' | 'blank' | 'not-blank';
  readonly operand: string;
}
/** v1.0.0 `FillPlan`. */
export interface FillPlanShape { readonly source: SheetRangeShape; readonly target: SheetRangeShape; readonly direction: 'down' | 'up' | 'right' | 'left' }
/** v1.0.0 `AutoFillMode`. */
export type AutoFillModeShape = 'copy' | 'series' | 'formulas';

type Rect = { from: string; to: string };

export function tallyRect(range: SheetRangeShape): Rect {
  if (range.endRow < range.startRow || range.endColumn < range.startColumn) throw new RangeError('Range must be ordered');
  return { from: tallyCellAddress(range.startRow, range.startColumn), to: tallyCellAddress(range.endRow, range.endColumn) };
}
/** The engine's canonical range text: `"A1"` for one cell, otherwise `"A1:B2"`. */
function canonical(rect: Rect) { return rect.from === rect.to ? rect.from : `${rect.from}:${rect.to}`; }

// ---------------------------------------------------------------- I-12 sort/filter

/** SortFilterHeader rejects more than 512 columns, so wider selections are refused here first. */
export function tallySortFilterColumns(range: SheetRangeShape) {
  tallyRect(range);
  const count = range.endColumn - range.startColumn + 1;
  if (count > 512) throw new RangeError('Select at most 512 columns to sort or filter.');
  return Array.from({ length: count }, (_, i) => {
    const id = tallyColumnName(range.startColumn + i);
    return { id, label: `Column ${id}` };
  });
}

export const TALLY_SORT_IS_DESTRUCTIVE = 'Sorting rewrote these rows in place. Use Undo to restore the earlier order.';
/**
 * `sortRange` permutes rows once; Tally stores no sort state. Removing the last
 * key cannot unsort, so it is refused with the Undo path instead of pretending.
 * Removing one of several keys re-sorts by the remaining keys.
 */
export function commitTallySort(document: Pick<TallyDocument, 'sortRange'>, range: SheetRangeShape, sorts: readonly SheetSortShape[]) {
  const columns = new Set(tallySortFilterColumns(range).map(column => column.id));
  if (!sorts.length) throw new Error(TALLY_SORT_IS_DESTRUCTIVE);
  if (sorts.length > 16) throw new RangeError('Tally sorts by at most 16 columns.');
  if (sorts.some(sort => !columns.has(sort.columnId))) throw new RangeError('Sort columns must lie inside the selection.');
  return document.sortRange(tallyRect(range), sorts.map(sort => ({ column: sort.columnId, ascending: sort.direction === 'ascending' })));
}

/** COUNTIF wildcards `*`, `?` and the escape `~` are literal in a typed operand. */
const escapeCriteria = (text: string) => text.replace(/[~*?]/g, ch => `~${ch}`);
const finiteNumber = (text: string) => text.trim() !== '' && Number.isFinite(Number(text));

/** SheetFilter operator/operand to a Tally COUNTIF-style criteria string; `null` means no rule. */
export function tallyFilterCriteria(filter: SheetFilterShape): string | null {
  const operand = filter.operand;
  switch (filter.operator) {
    case 'all': return null;
    case 'blank': return '';
    case 'not-blank': return '<>';
    case 'equals':
      if (!operand) throw new RangeError('Enter the value rows must equal, or choose "blank".');
      return `=${escapeCriteria(operand)}`;
    case 'contains':
      if (!operand) throw new RangeError('Enter the text rows must contain.');
      return `*${escapeCriteria(operand)}*`;
    case 'greater':
    case 'less':
      // Tally rejects relational criteria on text; say so before the engine does.
      if (!finiteNumber(operand)) throw new RangeError('Greater and less than compare numbers. Enter a number.');
      return `${filter.operator === 'greater' ? '>' : '<'}${operand.trim()}`;
  }
}

/**
 * Inverse of {@link tallyFilterCriteria}. A rule written by another client
 * that does not round-trip exactly (`>=5`, `a*b`) returns undefined: it still
 * filters rows, but SortFilterHeader cannot show its condition.
 */
export function tallyFilterFromRule(rule: Pick<FilterRuleInfo, 'column' | 'criteria'>): SheetFilterShape | undefined {
  if (rule.column === undefined) return undefined;
  const c = rule.criteria, columnId = rule.column;
  const candidate: SheetFilterShape | undefined =
    c === '' ? { columnId, operator: 'blank', operand: '' }
    : c === '<>' ? { columnId, operator: 'not-blank', operand: '' }
    : c[0] === '>' || c[0] === '<' ? { columnId, operator: c[0] === '>' ? 'greater' : 'less', operand: c.slice(1) }
    : c[0] === '=' ? { columnId, operator: 'equals', operand: c.slice(1).replace(/~([~*?])/g, '$1') }
    : c.length > 2 && c[0] === '*' && c.endsWith('*') ? { columnId, operator: 'contains', operand: c.slice(1, -1).replace(/~([~*?])/g, '$1') }
    : undefined;
  try { return candidate && tallyFilterCriteria(candidate) === c ? candidate : undefined; }
  catch { return undefined; }
}

/**
 * Tally has no filter update op ("clear and re-set"). The new rule is set
 * first and the old one cleared second, so a failure in the first call
 * changes nothing and a failure in the second leaves both rules visible in
 * the next read. That is two undo entries, not one.
 */
export async function commitTallyFilter(
  document: Pick<TallyDocument, 'getFilters' | 'setFilter' | 'clearFilter'>,
  range: SheetRangeShape,
  sheetName: string,
  filter: SheetFilterShape,
) {
  if (!tallySortFilterColumns(range).some(column => column.id === filter.columnId)) throw new RangeError('Filter column must lie inside the selection.');
  const criteria = tallyFilterCriteria(filter), rect = tallyRect(range), address = canonical(rect);
  const existing = (await document.getFilters(sheetName)).data.rules
    .filter(rule => rule.sheet === sheetName && rule.range === address && rule.column === filter.columnId);
  let kept: number | undefined;
  if (criteria !== null) {
    const same = existing.find(rule => rule.criteria === criteria);
    kept = same ? same.id : (await document.setFilter(rect, criteria, { sheet: sheetName, column: filter.columnId })).data.rule.id;
  }
  for (const rule of existing) if (rule.id !== kept) await document.clearFilter(rule.id);
}

export interface TallySortFilterRead { readonly filters: readonly SheetFilterShape[]; readonly visibleRows: number; readonly totalRows: number }
/** Current single-column filters on exactly this range, plus the engine's row pass count. */
export async function readTallySortFilter(
  document: Pick<TallyDocument, 'getFilters' | 'evaluateFilters'>,
  range: SheetRangeShape,
  sheetName: string,
): Promise<TallySortFilterRead> {
  tallySortFilterColumns(range);
  const rect = tallyRect(range), address = canonical(rect);
  const rules = (await document.getFilters(sheetName)).data.rules;
  const rows = (await document.evaluateFilters(rect, { sheet: sheetName })).data.rows;
  const byColumn = new Map<string, SheetFilterShape>();
  for (const rule of rules) {
    if (rule.sheet !== sheetName || rule.range !== address) continue;
    const filter = tallyFilterFromRule(rule);
    // SortFilterHeader shows one filter per column; later rules still count in visibleRows.
    if (filter && !byColumn.has(filter.columnId)) byColumn.set(filter.columnId, filter);
  }
  const visibleRows = rows.filter(row => 'visible' in row ? row.visible : row.matched).length;
  return { filters: [...byColumn.values()], visibleRows, totalRows: rows.length };
}

// ---------------------------------------------------------------- I-04 name box

/** Parses Tally's canonical `"A1"` / `"A1:B2"` (tolerating `$`) into a SheetRange. */
export function tallyRangeFromRef(ref: string): SheetRangeShape {
  const [a, b = a] = ref.replaceAll('$', '').split(':');
  const start = parseTallyCellAddress(a!), end = parseTallyCellAddress(b!);
  return { startRow: Math.min(start.row, end.row), endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column), endColumn: Math.max(start.column, end.column) };
}

/** `listNames` entries bound to this sheet. Names on other sheets resolve to #NAME? here, so they are left out. */
export async function readTallyNames(document: Pick<TallyDocument, 'listNames'>, sheetName: string) {
  const names = (await document.listNames()).data.names.filter((name: NamedRangeInfo) => name.sheet === sheetName);
  if (names.length > 1024) throw new RangeError('This sheet has more than 1024 names. The name box lists at most 1024.');
  return names.map(name => ({ id: name.name, label: name.name, range: tallyRangeFromRef(name.refers_to) }));
}

/** NameBox `onNavigate` is view state: it moves the grid selection and calls no engine op. */
export function tallySelectionForRange(range: SheetRangeShape) {
  const rect = tallyRect(range);
  return { anchor: rect.from, focus: rect.to };
}

// ---------------------------------------------------------------- I-11 validation dropdown

export interface TallyValidationRead {
  readonly addr: string;
  readonly kind: 'none' | 'list' | 'number' | 'text';
  /** The cell's stored source, which is what the dropdown writes back. */
  readonly value: string;
  readonly choices: readonly { value: string; label: string }[];
  readonly validation: { status: 'valid' | 'invalid'; message?: string };
}
export async function readTallyValidation(document: Pick<TallyDocument, 'validateCell' | 'getCell'>, addr: string): Promise<TallyValidationRead> {
  parseTallyCellAddress(addr);
  const check: CellValidation = (await document.validateCell(addr)).data;
  const cell = (await document.getCell(addr)).data;
  const criteria = check.rule?.criteria;
  // A blank entry is the dropdown's own "Clear validated cell" action; labels must be unique and non-blank.
  const values = criteria?.kind === 'list' ? [...new Set(criteria.values.filter(value => value !== ''))] : [];
  return {
    addr, kind: criteria?.kind ?? 'none', value: cell.raw,
    choices: values.map(value => ({ value, label: value })),
    validation: check.valid ? { status: 'valid' } : { status: 'invalid', ...(check.expected ? { message: `Expected ${check.expected}` } : {}) },
  };
}
/** ValidationDropdown `onCommit`: one `setCell` (an empty string clears the cell). */
export function commitTallyValidatedCell(document: Pick<TallyDocument, 'setCell'>, addr: string, value: string) {
  parseTallyCellAddress(addr);
  if (value.startsWith('=')) throw new RangeError('A list value starting with = would be stored as a formula. Type it in the grid instead.');
  return document.setCell(addr, value);
}

// ---------------------------------------------------------------- I-07 auto fill

/**
 * `fillRange` repeats the source and shifts relative references, which is
 * both "copy" and "formulas" in NYC-Tron's terms, so only `copy` is offered.
 * `series` is `fillSeries` with the engine inferring the step.
 */
export const TALLY_AUTO_FILL_MODES: readonly AutoFillModeShape[] = ['copy', 'series'];
export function commitTallyAutoFill(document: Pick<TallyDocument, 'fillRange' | 'fillSeries'>, plan: FillPlanShape, mode: AutoFillModeShape) {
  const source = tallyRect(plan.source), target = tallyRect(plan.target);
  if (mode === 'copy') return document.fillRange(source, target);
  if (mode === 'series') return document.fillSeries(source, target);
  throw new RangeError('Tally has no separate formula fill. Choose copy or series.');
}
