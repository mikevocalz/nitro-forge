import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateTallyPivotValue, assignTallyPivotField, commitTallyPivot, EMPTY_TALLY_PIVOT_SPEC, orderTallyPivotZone, readTallyPivot,
  readTallyPivotSource, removeTallyPivotAssignment, tallyPivotAssignments, tallyPivotFields, tallyPivotOutputAnchor, TALLY_PIVOT_NEEDS_VALUE,
} from './tally-pivot-wiring.ts';

function recorder(data: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const doc = new Proxy({}, { get: (_, method: string) => async (...args: unknown[]) => {
    calls.push([method, ...args]);
    const value = data[method];
    return { data: typeof value === 'function' ? value(...args) : value ?? { ok: true }, events: [] };
  } });
  return { doc: doc as never, calls };
}
// A1:C4: region (text), units (number), price (number).
const source = { range: { from: 'A1', to: 'C4' }, numeric: [false, true, true] };

test('I-15 fields are the source columns; the output sits one column right of the source', () => {
  assert.deepEqual(tallyPivotFields(source), [
    { id: 'f0', label: 'Column A', numeric: false }, { id: 'f1', label: 'Column B', numeric: true }, { id: 'f2', label: 'Column C', numeric: true }]);
  assert.equal(tallyPivotOutputAnchor(source.range), 'E1');
  assert.equal(tallyPivotOutputAnchor({ from: 'B3', to: 'D9' }), 'F3');
  assert.throws(() => tallyPivotFields({ ...source, numeric: [true] }), /every source column/);
  assert.throws(() => tallyPivotOutputAnchor({ from: 'A1', to: 'Z1000' }), /16384 cells/);
});

test('I-15 a filters assignment is a filter with no values ("All"); axes and values map to offsets and aggregates', () => {
  let spec = assignTallyPivotField(EMPTY_TALLY_PIVOT_SPEC, source, 'f0', 'rows');
  spec = assignTallyPivotField(spec, source, 'f1', 'values');
  spec = assignTallyPivotField(spec, source, 'f0', 'values');
  spec = assignTallyPivotField(spec, source, 'f2', 'filters');
  assert.deepEqual(spec, { rows: [0], columns: [], values: [{ field: 1, agg: 'sum' }, { field: 0, agg: 'count' }], filters: [{ field: 2, values: [] }] });
  assert.deepEqual(tallyPivotAssignments(spec), [
    { id: 'rows:0', fieldId: 'f0', zone: 'rows', aggregate: 'count' },
    { id: 'values:0', fieldId: 'f1', zone: 'values', aggregate: 'sum' },
    { id: 'values:1', fieldId: 'f0', zone: 'values', aggregate: 'count' },
    { id: 'filters:2', fieldId: 'f2', zone: 'filters', aggregate: 'count' }]);
  assert.throws(() => assignTallyPivotField(spec, source, 'f2', 'filters'), /already a filter/);
  assert.throws(() => assignTallyPivotField(spec, source, 'f0', 'rows'), /already in rows/);
  assert.throws(() => assignTallyPivotField(spec, source, 'f3', 'rows'), /not in the pivot source/);
  assert.throws(() => assignTallyPivotField(spec, source, 'f1', 'nowhere' as never), /Unknown pivot zone/);
});

test('I-15 aggregate, order and remove edit the spec; text fields only count', () => {
  const spec = { rows: [0, 2], columns: [], values: [{ field: 1, agg: 'sum' as const }, { field: 2, agg: 'max' as const }], filters: [{ field: 1, values: [] }, { field: 2, values: [] }] };
  assert.deepEqual(aggregateTallyPivotValue(spec, source, 'values:0', 'average').values[0], { field: 1, agg: 'avg' });
  assert.throws(() => aggregateTallyPivotValue({ ...spec, values: [{ field: 0, agg: 'count' }] }, source, 'values:0', 'sum'), /only be counted/);
  assert.throws(() => aggregateTallyPivotValue(spec, source, 'rows:0', 'sum'), /Only value fields/);
  assert.deepEqual(orderTallyPivotZone(spec, 'rows', ['rows:2', 'rows:0']).rows, [2, 0]);
  assert.deepEqual(orderTallyPivotZone(spec, 'values', ['values:1', 'values:0']).values, [{ field: 2, agg: 'max' }, { field: 1, agg: 'sum' }]);
  assert.deepEqual(orderTallyPivotZone(spec, 'filters', ['filters:2', 'filters:1']).filters.map(f => f.field), [2, 1]);
  assert.throws(() => orderTallyPivotZone(spec, 'rows', ['rows:0']), /order changed/);
  assert.deepEqual(removeTallyPivotAssignment(spec, 'filters:1').filters, [{ field: 2, values: [] }]);
  assert.deepEqual(removeTallyPivotAssignment(spec, 'values:0').values, [{ field: 2, agg: 'max' }]);
  assert.deepEqual(removeTallyPivotAssignment(spec, 'rows:2').rows, [0]);
  assert.throws(() => removeTallyPivotAssignment(spec, 'rows:1'), /Unknown pivot assignment/);
  assert.throws(() => removeTallyPivotAssignment(spec, 'bogus'), /Unknown pivot assignment/);
});

test('I-15 a draft without a value calls nothing; the first value inserts; later edits update; the last value is kept', async () => {
  const { doc, calls } = recorder({ insertPivot: { pivot: { id: 4 } }, updatePivot: { pivot: { id: 4 } } });
  const draft = assignTallyPivotField(EMPTY_TALLY_PIVOT_SPEC, source, 'f2', 'filters');
  assert.deepEqual(await commitTallyPivot(doc, 'Sheet1', null, source, draft), { stored: false });
  assert.equal(calls.length, 0);
  const first = assignTallyPivotField(draft, source, 'f1', 'values');
  assert.deepEqual(await commitTallyPivot(doc, 'Sheet1', null, source, first), { stored: true, id: 4 });
  assert.deepEqual(calls[0], ['insertPivot', { source: { sheet: 'Sheet1', range: { from: 'A1', to: 'C4' } }, rows: [], columns: [],
    values: [{ field: 1, agg: 'sum' }], filters: [{ field: 2, values: [] }], output: 'E1' }, 'Sheet1']);
  const next = assignTallyPivotField(first, source, 'f0', 'rows');
  await commitTallyPivot(doc, 'Sheet1', 4, source, next);
  assert.deepEqual(calls[1], ['updatePivot', 4, { rows: [0], columns: [], values: [{ field: 1, agg: 'sum' }], filters: [{ field: 2, values: [] }] }]);
  await commitTallyPivot(doc, 'Sheet1', 4, source, removeTallyPivotAssignment(next, 'filters:2'));
  assert.deepEqual(calls[2], ['updatePivot', 4, { rows: [0], columns: [], values: [{ field: 1, agg: 'sum' }], filters: null }]);
  await assert.rejects(commitTallyPivot(doc, 'Sheet1', 4, source, removeTallyPivotAssignment(next, 'values:0')), new RangeError(TALLY_PIVOT_NEEDS_VALUE));
  assert.equal(calls.length, 3);
});

test('I-15 reads the sheet pivot and per-column numeric flags from computed values', async () => {
  const cells = [['east', 1, null], ['west', 2, 'x'], [null, 3, 4]].map(row => row.map(computed => ({ computed })));
  const pivot = { id: 2, sheet: 'Sheet1', sheet_id: 1, source: { sheet: 'Sheet1', sheet_id: 1, range: 'A1:C3' }, rows: [0], columns: [],
    values: [{ field: 1, agg: 'avg' }], filters: [{ field: 0, values: [] }], output: { anchor: 'E1', rows: 3, cols: 2 } };
  const { doc, calls } = recorder({ listPivots: { pivots: [{ ...pivot, id: 9 }, pivot] }, getRange: { cells } });
  assert.deepEqual(await readTallyPivotSource(doc, { from: 'A1', to: 'C3' }), { range: { from: 'A1', to: 'C3' }, numeric: [false, true, false] });
  const read = await readTallyPivot(doc, 'Sheet1');
  assert.equal(read?.id, 2);
  assert.deepEqual(read?.spec, { rows: [0], columns: [], values: [{ field: 1, agg: 'avg' }], filters: [{ field: 0, values: [] }] });
  assert.deepEqual(tallyPivotAssignments(read!.spec).find(a => a.zone === 'values')?.aggregate, 'average');
  assert.deepEqual(calls.filter(c => c[0] === 'listPivots'), [['listPivots', 'Sheet1']]);
  const empty = recorder({ listPivots: { pivots: [] } });
  assert.equal(await readTallyPivot(empty.doc, 'Sheet1'), null);
  const other = recorder({ listPivots: { pivots: [{ ...pivot, source: { ...pivot.source, sheet: 'Data' } }] } });
  await assert.rejects(readTallyPivot(other.doc, 'Sheet1'), /another sheet/);
});
