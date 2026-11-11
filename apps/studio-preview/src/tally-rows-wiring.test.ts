import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commitTallyAutoFill, commitTallyFilter, commitTallySort, commitTallyValidatedCell, readTallyNames, readTallySortFilter,
  readTallyValidation, tallyFilterCriteria, tallyFilterFromRule, tallySelectionForRange, TALLY_SORT_IS_DESTRUCTIVE,
} from './tally-rows-wiring.ts';

// Records each TallyDocument method call with its arguments and returns `{data}` like CommandResult.
function recorder(data: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const doc = new Proxy({}, { get: (_, method: string) => async (...args: unknown[]) => {
    calls.push([method, ...args]);
    const value = data[method];
    return { data: typeof value === 'function' ? value(...args) : value ?? { ok: true }, events: [] };
  } });
  return { doc: doc as never, calls };
}
const B2toC5 = { startRow: 1, endRow: 4, startColumn: 1, endColumn: 2 };

test('I-12 sort keys reach sortRange in priority order with direction mapped to ascending', async () => {
  const { doc, calls } = recorder();
  await commitTallySort(doc, B2toC5, [{ columnId: 'C', direction: 'descending' }, { columnId: 'B', direction: 'ascending' }]);
  assert.deepEqual(calls, [['sortRange', { from: 'B2', to: 'C5' }, [{ column: 'C', ascending: false }, { column: 'B', ascending: true }]]]);
  assert.throws(() => commitTallySort(doc, B2toC5, []), new Error(TALLY_SORT_IS_DESTRUCTIVE));
  assert.throws(() => commitTallySort(doc, B2toC5, [{ columnId: 'D', direction: 'ascending' }]), /inside the selection/);
  assert.equal(calls.length, 1);
});

test('I-12 filter operators become COUNTIF criteria and round-trip from stored rules', () => {
  const f = (operator: Parameters<typeof tallyFilterCriteria>[0]['operator'], operand = '') => ({ columnId: 'B', operator, operand });
  assert.equal(tallyFilterCriteria(f('equals', 'a*b')), '=a~*b');
  assert.equal(tallyFilterCriteria(f('contains', 'x?')), '*x~?*');
  assert.equal(tallyFilterCriteria(f('greater', ' 5 ')), '>5');
  assert.equal(tallyFilterCriteria(f('less', '-2.5')), '<-2.5');
  assert.equal(tallyFilterCriteria(f('blank')), '');
  assert.equal(tallyFilterCriteria(f('not-blank')), '<>');
  assert.equal(tallyFilterCriteria(f('all')), null);
  assert.throws(() => tallyFilterCriteria(f('greater', 'abc')), /compare numbers/);
  for (const op of [f('equals', 'a*b'), f('contains', 'x?'), f('less', '-2.5'), f('blank'), f('not-blank')])
    assert.deepEqual(tallyFilterFromRule({ column: 'B', criteria: tallyFilterCriteria(op)! }), op);
  assert.equal(tallyFilterFromRule({ column: 'B', criteria: '>=5' }), undefined);
});

test('I-12 a changed filter sets the new rule before clearing the old one; "all" only clears', async () => {
  const old = { id: 7, sheet: 'Sheet1', sheet_id: 1, range: 'B2:C5', column: 'B', criteria: '=x' };
  const other = { id: 8, sheet: 'Sheet2', sheet_id: 2, range: 'B2:C5', column: 'B', criteria: '=x' };
  const { doc, calls } = recorder({ getFilters: { rules: [old, other] }, setFilter: { rule: { id: 9 } } });
  await commitTallyFilter(doc, B2toC5, 'Sheet1', { columnId: 'B', operator: 'contains', operand: 'y' });
  assert.deepEqual(calls, [['getFilters', 'Sheet1'], ['setFilter', { from: 'B2', to: 'C5' }, '*y*', { sheet: 'Sheet1', column: 'B' }], ['clearFilter', 7]]);
  calls.length = 0;
  await commitTallyFilter(doc, B2toC5, 'Sheet1', { columnId: 'B', operator: 'all', operand: '' });
  assert.deepEqual(calls, [['getFilters', 'Sheet1'], ['clearFilter', 7]]);
});

test('I-12 read reports the range filters and the engine pass count', async () => {
  const { doc, calls } = recorder({
    getFilters: { rules: [{ id: 1, sheet: 'Sheet1', sheet_id: 1, range: 'B2:C5', column: 'C', criteria: '>3' },
      { id: 2, sheet: 'Sheet1', sheet_id: 1, range: 'A1:A9', column: 'A', criteria: '=z' }] },
    evaluateFilters: { rows: [2, 3, 4, 5].map(row => ({ row, visible: row !== 3, matched: [], failed: [] })) },
  });
  assert.deepEqual(await readTallySortFilter(doc, B2toC5, 'Sheet1'),
    { filters: [{ columnId: 'C', operator: 'greater', operand: '3' }], visibleRows: 3, totalRows: 4 });
  assert.deepEqual(calls, [['getFilters', 'Sheet1'], ['evaluateFilters', { from: 'B2', to: 'C5' }, { sheet: 'Sheet1' }]]);
});

test('I-04 listNames feeds NameBox with this sheet\'s names and navigation is a selection change', async () => {
  const { doc, calls } = recorder({ listNames: { names: [
    { name: 'Totals', sheet: 'Sheet1', sheet_id: 1, refers_to: 'B2:C5' },
    { name: 'Rate', sheet: 'Sheet1', sheet_id: 1, refers_to: '$D$1' },
    { name: 'Elsewhere', sheet: 'Sheet2', sheet_id: 2, refers_to: 'A1' },
  ] } });
  assert.deepEqual(await readTallyNames(doc, 'Sheet1'), [
    { id: 'Totals', label: 'Totals', range: B2toC5 },
    { id: 'Rate', label: 'Rate', range: { startRow: 0, endRow: 0, startColumn: 3, endColumn: 3 } },
  ]);
  assert.deepEqual(calls, [['listNames']]);
  assert.deepEqual(tallySelectionForRange(B2toC5), { anchor: 'B2', focus: 'C5' });
});

test('I-11 validateCell supplies the list choices and status; a pick is one setCell', async () => {
  const { doc, calls } = recorder({
    validateCell: { valid: false, expected: 'one of: Open, Done', rule: { id: 3, sheet: 'Sheet1', sheet_id: 1, range: 'D2:D9', criteria: { kind: 'list', values: ['Open', 'Done', 'Open', ''] } } },
    getCell: { raw: 'Late', computed: { kind: 'text', value: 'Late' } },
  });
  assert.deepEqual(await readTallyValidation(doc, 'D4'), {
    addr: 'D4', kind: 'list', value: 'Late',
    choices: [{ value: 'Open', label: 'Open' }, { value: 'Done', label: 'Done' }],
    validation: { status: 'invalid', message: 'Expected one of: Open, Done' },
  });
  await commitTallyValidatedCell(doc, 'D4', 'Done');
  await commitTallyValidatedCell(doc, 'D4', '');
  assert.throws(() => commitTallyValidatedCell(doc, 'D4', '=1+1'), /formula/);
  assert.deepEqual(calls, [['validateCell', 'D4'], ['getCell', 'D4'], ['setCell', 'D4', 'Done'], ['setCell', 'D4', '']]);
});

test('I-07 copy fills with fillRange, series with fillSeries, and formulas is refused', async () => {
  const { doc, calls } = recorder();
  const plan = { source: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }, target: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 0 }, direction: 'down' as const };
  await commitTallyAutoFill(doc, plan, 'copy');
  await commitTallyAutoFill(doc, plan, 'series');
  assert.throws(() => commitTallyAutoFill(doc, plan, 'formulas'), /no separate formula fill/);
  assert.deepEqual(calls, [
    ['fillRange', { from: 'A1', to: 'A2' }, { from: 'A1', to: 'A6' }],
    ['fillSeries', { from: 'A1', to: 'A2' }, { from: 'A1', to: 'A6' }],
  ]);
});
