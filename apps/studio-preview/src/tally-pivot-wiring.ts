import type { PivotAgg, PivotInfo, TallyDocument } from '../../../packages/tally/src/index';
import { parseTallyCellAddress, tallyCellAddress, tallyColumnName } from '../../../packages/tally/src/grid-adapter.ts';

/*
 * Engine side of NYC-Tron v1.0.0 I-15 PivotFieldList (F3 option B). No
 * @nyc-tron import: the shapes mirror the v1.0.0 props structurally so this
 * module and its tests run without the UI package.
 *
 * The list has no source-range input, and Tally's insertPivot needs a source
 * range and at least one value slot. The host therefore keeps a draft spec
 * until both exist ("Use selection as pivot source" sets the range), then
 * inserts the pivot; later assignments patch it with updatePivot. A field
 * placed in the filters zone becomes `{field, values: []}`, which Tally reads
 * as "All": every record passes until a value picker exists.
 */

/** v1.0.0 `PivotZone`. */
export type PivotZoneShape = 'rows' | 'columns' | 'values' | 'filters';
/** v1.0.0 `PivotAssignment['aggregate']`. */
export type PivotAggregateShape = 'sum' | 'count' | 'average' | 'min' | 'max';
/** v1.0.0 `PivotAssignment`. */
export interface PivotAssignmentShape { readonly id: string; readonly fieldId: string; readonly zone: PivotZoneShape; readonly aggregate: PivotAggregateShape }
/** v1.0.0 `PivotFieldListProps['fields'][number]`. */
export interface PivotFieldShape { readonly id: string; readonly label: string; readonly numeric: boolean }

/** The source binding: a canonical range on the output sheet plus per-column numeric flags. */
export interface TallyPivotSource {
  readonly range: { readonly from: string; readonly to: string };
  /** One flag per source column: true when every non-empty computed value is a number. */
  readonly numeric: readonly boolean[];
}
/** The assignable part of a Tally pivot spec, in Tally's units (0-based source column offsets). */
export interface TallyPivotSpec {
  readonly rows: readonly number[];
  readonly columns: readonly number[];
  readonly values: readonly { readonly field: number; readonly agg: PivotAgg }[];
  readonly filters: readonly { readonly field: number; readonly values: readonly string[] }[];
}
export const EMPTY_TALLY_PIVOT_SPEC: TallyPivotSpec = { rows: [], columns: [], values: [], filters: [] };

// Tally's bounds (pivot_ops.rs), checked here so the list shows the reason before an engine call.
const MAX_AXIS = 16, MAX_VALUES = 16, MAX_FILTERS = 32, MAX_SOURCE_CELLS = 16384, MAX_FIELDS = 512;
export const TALLY_PIVOT_NEEDS_VALUE = 'A pivot needs at least one value field. Add another value before removing this one.';

const toAggregate: Record<PivotAgg, PivotAggregateShape> = { sum: 'sum', count: 'count', avg: 'average', min: 'min', max: 'max' };
const toAgg: Record<PivotAggregateShape, PivotAgg> = { sum: 'sum', count: 'count', average: 'avg', min: 'min', max: 'max' };

/** Bounds of a `{from,to}` source, validated against the 16384-cell budget and the list's 512-field cap. */
export function tallyPivotSourceBounds(range: { readonly from: string; readonly to: string }) {
  const a = parseTallyCellAddress(range.from), b = parseTallyCellAddress(range.to);
  if (b.row < a.row || b.column < a.column) throw new RangeError('The pivot source range must be ordered.');
  const width = b.column - a.column + 1, height = b.row - a.row + 1;
  if (width * height > MAX_SOURCE_CELLS) throw new RangeError('Select at most 16384 cells as the pivot source.');
  if (width > MAX_FIELDS) throw new RangeError('Select at most 512 columns as the pivot source.');
  return { startRow: a.row, endRow: b.row, startColumn: a.column, endColumn: b.column, width };
}

/** The output anchor: one empty column to the right of the source, on its first row, so refresh never writes over it. */
export function tallyPivotOutputAnchor(range: { readonly from: string; readonly to: string }) {
  const bounds = tallyPivotSourceBounds(range);
  return tallyCellAddress(bounds.startRow, bounds.endColumn + 2);
}

/** One list field per source column, labelled by its sheet column ("Column B"). Tally has no header row. */
export function tallyPivotFields(source: TallyPivotSource): PivotFieldShape[] {
  const bounds = tallyPivotSourceBounds(source.range);
  if (source.numeric.length !== bounds.width) throw new RangeError('Numeric flags must cover every source column.');
  return source.numeric.map((numeric, offset) => ({ id: `f${offset}`, label: `Column ${tallyColumnName(bounds.startColumn + offset)}`, numeric }));
}

/** Assignment ids encode the zone and the position Tally uses: the field for axes and filters, the slot index for values. */
export function tallyPivotAssignments(spec: TallyPivotSpec): PivotAssignmentShape[] {
  return [
    ...spec.rows.map(field => ({ id: `rows:${field}`, fieldId: `f${field}`, zone: 'rows' as const, aggregate: 'count' as const })),
    ...spec.columns.map(field => ({ id: `columns:${field}`, fieldId: `f${field}`, zone: 'columns' as const, aggregate: 'count' as const })),
    ...spec.values.map((value, index) => ({ id: `values:${index}`, fieldId: `f${value.field}`, zone: 'values' as const, aggregate: toAggregate[value.agg] })),
    ...spec.filters.map(filter => ({ id: `filters:${filter.field}`, fieldId: `f${filter.field}`, zone: 'filters' as const, aggregate: 'count' as const })),
  ];
}

function fieldOffset(fieldId: string, width: number) {
  const match = /^f(0|[1-9][0-9]{0,8})$/.exec(fieldId);
  const offset = match ? Number(match[1]) : -1;
  if (offset < 0 || offset >= width) throw new RangeError('That field is not in the pivot source.');
  return offset;
}
function parseAssignment(id: string) {
  const match = /^(rows|columns|values|filters):(0|[1-9][0-9]{0,8})$/.exec(id);
  if (!match) throw new RangeError('Unknown pivot assignment.');
  return { zone: match[1] as PivotZoneShape, key: Number(match[2]) };
}

/** `onAssign`: append the field to the zone. A filter starts as "All" (no accepted values). */
export function assignTallyPivotField(spec: TallyPivotSpec, source: TallyPivotSource, fieldId: string, zone: PivotZoneShape): TallyPivotSpec {
  const field = fieldOffset(fieldId, source.numeric.length);
  if (zone === 'rows' || zone === 'columns') {
    if (spec[zone].includes(field)) throw new RangeError(`That field is already in ${zone}.`);
    if (spec[zone].length >= MAX_AXIS) throw new RangeError(`A pivot holds at most ${MAX_AXIS} ${zone === 'rows' ? 'row' : 'column'} fields.`);
    return { ...spec, [zone]: [...spec[zone], field] };
  }
  if (zone === 'values') {
    if (spec.values.length >= MAX_VALUES) throw new RangeError(`A pivot holds at most ${MAX_VALUES} value fields.`);
    return { ...spec, values: [...spec.values, { field, agg: source.numeric[field] ? 'sum' : 'count' }] };
  }
  if (zone === 'filters') {
    if (spec.filters.some(filter => filter.field === field)) throw new RangeError('That field is already a filter.');
    if (spec.filters.length >= MAX_FILTERS) throw new RangeError(`A pivot holds at most ${MAX_FILTERS} filters.`);
    return { ...spec, filters: [...spec.filters, { field, values: [] }] };
  }
  throw new RangeError('Unknown pivot zone.');
}

/** `onRemove`. Removing the last value slot of a stored pivot is refused by the caller (see `commitTallyPivot`). */
export function removeTallyPivotAssignment(spec: TallyPivotSpec, id: string): TallyPivotSpec {
  const { zone, key } = parseAssignment(id);
  if (zone === 'values') {
    if (key >= spec.values.length) throw new RangeError('Unknown pivot assignment.');
    return { ...spec, values: spec.values.filter((_, index) => index !== key) };
  }
  if (zone === 'filters') {
    if (!spec.filters.some(filter => filter.field === key)) throw new RangeError('Unknown pivot assignment.');
    return { ...spec, filters: spec.filters.filter(filter => filter.field !== key) };
  }
  if (!spec[zone].includes(key)) throw new RangeError('Unknown pivot assignment.');
  return { ...spec, [zone]: spec[zone].filter(field => field !== key) };
}

/** `onAggregate`: only value slots carry an aggregate; text fields only count. */
export function aggregateTallyPivotValue(spec: TallyPivotSpec, source: TallyPivotSource, id: string, aggregate: PivotAggregateShape): TallyPivotSpec {
  const { zone, key } = parseAssignment(id), slot = spec.values[key];
  if (zone !== 'values' || !slot) throw new RangeError('Only value fields have an aggregate.');
  if (!(aggregate in toAgg)) throw new RangeError('Unknown aggregate.');
  if (!source.numeric[slot.field] && aggregate !== 'count') throw new RangeError('A text field can only be counted.');
  return { ...spec, values: spec.values.map((value, index) => index === key ? { field: value.field, agg: toAgg[aggregate] } : value) };
}

/** `onOrder`: `ids` must be a permutation of the zone's current assignment ids. */
export function orderTallyPivotZone(spec: TallyPivotSpec, zone: PivotZoneShape, ids: readonly string[]): TallyPivotSpec {
  const current = tallyPivotAssignments(spec).filter(item => item.zone === zone).map(item => item.id);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(id => !current.includes(id)))
    throw new RangeError('The pivot field order changed. Try again.');
  const keys = ids.map(id => parseAssignment(id).key);
  if (zone === 'values') return { ...spec, values: keys.map(index => spec.values[index]!) };
  if (zone === 'filters') return { ...spec, filters: keys.map(field => spec.filters.find(filter => filter.field === field)!) };
  return { ...spec, [zone]: keys };
}

/** Tally's mutable filter input from the read-only spec. */
const filterInputs = (spec: TallyPivotSpec) => spec.filters.map(filter => ({ field: filter.field, values: [...filter.values] }));

/** The editable spec of a stored pivot. */
export function tallyPivotSpecOf(pivot: PivotInfo): TallyPivotSpec {
  return {
    rows: pivot.rows ?? [], columns: pivot.columns ?? [],
    values: pivot.values.map(value => ({ field: value.field, agg: value.agg })),
    filters: (pivot.filters ?? []).map(filter => ({ field: filter.field, values: [...filter.values] })),
  };
}

function rangeOf(canonical: string) {
  const [from = '', to = from] = canonical.split(':');
  return { from, to };
}

/** Per-column numeric flags from the computed source values; an empty column counts as text. */
export async function readTallyPivotSource(document: Pick<TallyDocument, 'getRange'>, range: { readonly from: string; readonly to: string }): Promise<TallyPivotSource> {
  const bounds = tallyPivotSourceBounds(range);
  const cells = (await document.getRange(range.from, range.to)).data.cells;
  const numeric = Array.from({ length: bounds.width }, (_, column) => {
    const values = cells.map(row => row[column]?.computed ?? null).filter(value => value !== null && value !== '');
    return values.length > 0 && values.every(value => typeof value === 'number');
  });
  return { range: { from: range.from, to: range.to }, numeric };
}

export interface TallyPivotRead { readonly id: number; readonly source: TallyPivotSource; readonly spec: TallyPivotSpec; readonly output: { anchor: string; rows: number; cols: number } | null }

/** The sheet's first pivot (lowest id), or null when it has none. Read-only. */
export async function readTallyPivot(document: Pick<TallyDocument, 'listPivots' | 'getRange'>, sheetName: string): Promise<TallyPivotRead | null> {
  const pivots = (await document.listPivots(sheetName)).data.pivots;
  const pivot = [...pivots].sort((a, b) => a.id - b.id)[0];
  if (!pivot) return null;
  if (pivot.source.sheet !== sheetName) throw new Error('This pivot reads another sheet. The preview edits pivots whose source is on the same sheet.');
  return { id: pivot.id, source: await readTallyPivotSource(document, rangeOf(pivot.source.range)), spec: tallyPivotSpecOf(pivot), output: pivot.output ?? null };
}

/**
 * Store an edited spec. With no stored pivot, a spec without a value slot
 * stays a host draft and calls nothing; the first spec with one inserts the
 * pivot (one undo step). A stored pivot is patched with updatePivot (one
 * undo step); removing its last value slot is refused, since Tally needs one.
 * Refresh is a separate command, so an assignment and a refresh undo apart.
 */
export async function commitTallyPivot(document: Pick<TallyDocument, 'insertPivot' | 'updatePivot'>, sheetName: string, pivotId: number | null, source: TallyPivotSource, spec: TallyPivotSpec) {
  tallyPivotSourceBounds(source.range);
  if (spec.values.length === 0) {
    if (pivotId !== null) throw new RangeError(TALLY_PIVOT_NEEDS_VALUE);
    return { stored: false as const };
  }
  if (pivotId === null) {
    const created = await document.insertPivot({
      source: { sheet: sheetName, range: { from: source.range.from, to: source.range.to } },
      rows: spec.rows, columns: spec.columns, values: spec.values,
      ...(spec.filters.length ? { filters: filterInputs(spec) } : {}),
      output: tallyPivotOutputAnchor(source.range),
    }, sheetName);
    return { stored: true as const, id: created.data.pivot.id };
  }
  await document.updatePivot(pivotId, { rows: spec.rows, columns: spec.columns, values: spec.values, filters: spec.filters.length ? filterInputs(spec) : null });
  return { stored: true as const, id: pivotId };
}
