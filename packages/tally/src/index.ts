import {
  DocumentHandle,
  type CommandResult,
  type EngineHost,
} from "@nitro-forge/ignition";

/** Op names — single source of truth, mirrors docs/ENGINE_OPS.md § tally. */
export const OPS = {
  newDoc: "new",
  describe: "describe",
  addSheet: "addSheet",
  renameSheet: "renameSheet",
  removeSheet: "removeSheet",
  setActive: "setActive",
  moveSheet: "moveSheet",
  duplicateSheet: "duplicateSheet",
  protectSheet: "protectSheet",
  setSheetColor: "setSheetColor",
  setCell: "setCell",
  setRange: "setRange",
  fillRange: "fillRange",
  fillSeries: "fillSeries",
  setFormat: "setFormat",
  clearFormat: "clearFormat",
  defineName: "defineName",
  updateName: "updateName",
  removeName: "removeName",
  listNames: "listNames",
  functionCatalog: "functionCatalog",
  setValidation: "setValidation",
  clearValidation: "clearValidation",
  validateCell: "validateCell",
  setConditionalFormat: "setConditionalFormat",
  clearConditionalFormat: "clearConditionalFormat",
  getConditionalFormats: "getConditionalFormats",
  evaluateConditionalFormats: "evaluateConditionalFormats",
  sortRange: "sortRange",
  setFilter: "setFilter",
  clearFilter: "clearFilter",
  getFilters: "getFilters",
  evaluateFilters: "evaluateFilters",
  insertChart: "insertChart",
  updateChart: "updateChart",
  removeChart: "removeChart",
  listCharts: "listCharts",
  setSparkline: "setSparkline",
  clearSparkline: "clearSparkline",
  listSparklines: "listSparklines",
  saveSheetView: "saveSheetView",
  setSheetView: "setSheetView",
  removeSheetView: "removeSheetView",
  listSheetViews: "listSheetViews",
  addComment: "addComment",
  updateComment: "updateComment",
  removeComment: "removeComment",
  resolveComment: "resolveComment",
  reopenComment: "reopenComment",
  listComments: "listComments",
  insertPivot: "insertPivot",
  updatePivot: "updatePivot",
  removePivot: "removePivot",
  listPivots: "listPivots",
  describePivot: "describePivot",
  clearCell: "clearCell",
  insertRows: "insertRows",
  deleteRows: "deleteRows",
  insertCols: "insertCols",
  deleteCols: "deleteCols",
  mergeCells: "mergeCells",
  unmergeCells: "unmergeCells",
  listMergedCells: "listMergedCells",
  getCell: "getCell",
  getRange: "getRange",
  importCsv: "importCsv",
  importTsv: "importTsv",
  exportCsv: "exportCsv",
  exportTsv: "exportTsv",
  evaluate: "evaluate",
  workbook: "workbook",
} as const;

export type CellValue = number | string | boolean | CellError | null;
export type CellError =
  | "#DIV/0!"
  | "#VALUE!"
  | "#REF!"
  | "#NAME?"
  | "#NUM!"
  | "#CYCLE!";

export interface CellInfo {
  addr: string;
  raw: string;
  computed: CellValue;
  /** Present only when the cell has a stored format. */
  format?: CellFormat;
  /**
   * Present only on a cell covered by a merged region: the anchor cell's
   * address (e.g. `"B2"`). The covered cell keeps its stored value/format —
   * merges are render metadata, never data loss.
   */
  merged_into?: string;
}

export type BorderSide = "top" | "right" | "bottom" | "left";
export type BorderStyle = "thin" | "medium" | "thick" | "dashed" | "dotted";

/** One border spec; `color` is `#RRGGBB`, `sides` a nonempty subset. */
export interface CellBorder {
  style: BorderStyle;
  color: string;
  sides: BorderSide[];
}

/** Stored per-cell format; every attribute optional. */
export interface CellFormat {
  /** Preset id or bounded custom pattern (≤64 chars); host-interpreted. */
  number_format?: string;
  bold?: boolean;
  italic?: boolean;
  /** `#RRGGBB` fill color. */
  fill?: string;
  border?: CellBorder;
}

/** `setFormat` patch: present keys set, explicit `null` clears, absent keys untouched. */
export interface CellFormatPatch {
  number_format?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  fill?: string | null;
  border?: CellBorder | null;
}

/** Format target: a rectangle `{from,to}` or an explicit deduped address list. */
export type FormatTarget = { from: string; to: string } | readonly string[];

export type SheetTabTone = "primary" | "accent" | "success" | "info" | "muted";

export interface WorkbookInfo {
  sheets: { name: string; cell_count: number; tone?: SheetTabTone | null; is_protected?: boolean }[];
  active: number;
}

/**
 * Workbook-scoped named range bound to one sheet (by durable sheet id).
 * `refers_to` is a canonical same-sheet `"A1"` or `"A1:B2"`; formulas on the
 * bound sheet resolve the name (case-insensitive), names on other sheets
 * evaluate to `#NAME?`.
 */
export interface NamedRangeInfo {
  name: string;
  /** Current sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  refers_to: string;
}

/**
 * Validation criteria kinds the engine can evaluate. Field names are the
 * wire format (snake_case). Deferred kinds — date bounds, custom formulas,
 * whole-row/column ranges — are rejected by the engine.
 */
export type ValidationCriteria =
  /** Computed value must be a finite number within optional inclusive bounds; `integer` requires an integral value. */
  | { kind: "number"; min?: number; max?: number; integer?: boolean }
  /** Computed value's text form must exactly equal one of `values` (case-sensitive). */
  | { kind: "list"; values: string[] }
  /** Computed value's text form must have a character length within optional inclusive bounds. */
  | { kind: "text"; min_length?: number; max_length?: number };

/**
 * Durable per-range validation rule bound to one sheet (by durable sheet id).
 * `range` is a canonical same-sheet `"A1"` or `"A1:B2"`. Rules on one sheet
 * may not overlap; `setValidation` on an identical sheet+range replaces the
 * criteria in place (keeping `id`).
 */
export interface ValidationRuleInfo {
  id: number;
  /** Current sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  range: string;
  criteria: ValidationCriteria;
}

/** Result of the read-only `validateCell` op. */
export interface CellValidation {
  valid: boolean;
  /** Present only when a rule covers the cell. */
  rule?: ValidationRuleInfo;
  /** Human-readable expectation, present only when a rule covers the cell. */
  expected?: string;
  /** The cell's computed value, present only when a rule covers the cell. */
  actual?: CellValue;
}

/** One entry of the read-only `functionCatalog` op. */
export interface FunctionInfo {
  name: string;
  min_args: number;
  /** `null` marks a variadic function. */
  max_args: number | null;
  signature: string;
}

/**
 * Bounded style payload stored on a conditional-format rule. The engine
 * reports matches only — applying these styles is host-side. `color` is a
 * `#RRGGBB` font color, `fill` a `#RRGGBB` background.
 */
export interface ConditionalFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fill?: string;
}

/** Input for `setConditionalFormat`'s `rule` field. */
export interface ConditionalRuleInput {
  /** COUNTIF-style criteria: `">=3"`, `"<>apple"`, `"a*"`, `""`, etc. */
  criteria: string;
  format: ConditionalFormat;
}

/**
 * Durable conditional-format rule bound to one sheet. `range` is a
 * canonical `"A1"`/`"A1:B2"`; rules may overlap — every match is reported
 * in creation order and precedence/merge is host-side.
 */
export interface ConditionalRuleInfo {
  id: number;
  /** Current sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  range: string;
  criteria: string;
  format: ConditionalFormat;
}

/** One cell row of `evaluateConditionalFormats`: computed value plus every matching rule. */
export interface ConditionalMatch {
  addr: string;
  computed: CellValue;
  matches: ConditionalRuleInfo[];
}

/**
 * One key of a `sortRange` call: exactly one of `column`/`offset`, enforced
 * by the discriminated union — `{}` and `{column, offset}` both fail to
 * typecheck (the engine rejects them too).
 */
export type SortKey =
  | {
      /** Column letter inside the sort range, e.g. `"B"`. */
      column: string;
      offset?: never;
      /** Sort direction; defaults to ascending. */
      ascending?: boolean;
    }
  | {
      /** 0-based column offset from the range's left edge. */
      offset: number;
      column?: never;
      /** Sort direction; defaults to ascending. */
      ascending?: boolean;
    };

/**
 * Durable row-filter rule bound to one sheet. `range` is a canonical
 * `"A1"`/`"A1:B2"`; `column` is an optional column letter inside `range`.
 * Filters hide rows — they never delete cells — and visibility is derived
 * live from computed values, so it stays correct across edits and undo.
 */
export interface FilterRuleInfo {
  id: number;
  /** Current sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  range: string;
  /** Present only for single-column filters. */
  column?: string;
  /** COUNTIF-style criteria string, same matcher as conditional formats. */
  criteria: string;
}

/** One row of an `evaluateFilters` report (all-rules mode). */
export interface FilterRowVisibility {
  /** 1-based sheet row number. */
  row: number;
  /** True when every covering rule passes — the row a host should show. */
  visible: boolean;
  /** Ids of covering rules the row satisfied. */
  matched: number[];
  /** Ids of covering rules the row failed (these hide the row). */
  failed: number[];
}

/** One row of an `evaluateFilters` report (single-rule `id` mode). */
export interface FilterRowMatch {
  /** 1-based sheet row number. */
  row: number;
  /** Whether the row passes the selected rule; rows outside its range pass. */
  matched: boolean;
}

/** Bounded chart kinds the engine stores; rendering is host-side. */
export type ChartKind = "line" | "column" | "bar" | "area" | "pie";

/**
 * Optional per-series override on a chart: a display `name` and/or a
 * `range` (`{from,to}` on the chart's sheet). At least one field required.
 */
export interface ChartSeriesInput {
  name?: string;
  range?: { from: string; to: string };
}

/** Input for `insertChart`'s `chart` field (id/sheet are engine-assigned). */
export interface ChartInput {
  kind: ChartKind;
  /** 1-512 byte title; omit for none. */
  title?: string;
  /** Data anchor range on the bound sheet (≤16384 cells). */
  range: { from: string; to: string };
  /** ≤32 series overrides. */
  series?: readonly ChartSeriesInput[];
  /** ≤16 `#RRGGBB` palette entries (deduped engine-side). */
  colors?: readonly string[];
}

/**
 * Durable chart object bound to one sheet. The engine stores the bounded
 * spec only — it never evaluates series data or renders; hosts read cell
 * values and draw.
 */
export interface ChartInfo {
  id: number;
  /** Current sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  kind: ChartKind;
  title?: string;
  /** Canonical `"A1"`/`"A1:B2"` data anchor on the bound sheet. */
  range: string;
  series?: { name?: string; range?: string }[];
  colors?: string[];
}

/**
 * `updateChart` patch: present keys set, explicit `null` clears
 * `title`/`series`/`colors`; `kind`/`range` cannot be null. An update that
 * changes nothing is eventless.
 */
export interface ChartPatch {
  kind?: ChartKind;
  title?: string | null;
  range?: { from: string; to: string };
  series?: readonly ChartSeriesInput[] | null;
  colors?: readonly string[] | null;
}

/** Bounded sparkline kinds the engine stores; rendering is host-side. */
export type SparklineKind = "line" | "column" | "bar" | "winloss";

/**
 * Durable sparkline spec bound to one sheet. `target` is the canonical
 * anchor the sparkline is drawn in, `data` the canonical source range it
 * summarizes. Storage only — the engine never evaluates or renders.
 */
export interface SparklineInfo {
  id: number;
  /** Current sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  /** Canonical `"A1"`/`"A1:B2"` anchor on the bound sheet. */
  target: string;
  /** Canonical `"A1"`/`"A1:B2"` source range on the bound sheet. */
  data: string;
  kind: SparklineKind;
}

/** `setSparkline` anchor: exactly one of `cell` or `range`. */
export type SparklineTarget = { cell: string; range?: never } | { range: { from: string; to: string }; cell?: never };

/**
 * One filter spec captured into a sheet view — the `FilterRule` fields
 * minus the rule `id`. Views capture engine-owned durable state only:
 * scroll, zoom, frozen panes/splits and column widths are host view state,
 * and sorts are destructive mutations, so none of them are captured.
 */
export interface SheetViewFilter {
  /** Canonical `"A1"`/`"A1:B2"` range on the bound sheet. */
  range: string;
  /** Present only for single-column filters. */
  column?: string;
  /** COUNTIF-style criteria string, same matcher as filters. */
  criteria: string;
}

/**
 * Durable named sheet view bound to one sheet. `name` is unique
 * case-insensitively among that sheet's views; `filters` is the captured
 * spec set `setSheetView` applies (replacing the sheet's filter rules
 * under fresh ids). `active` marks the sheet's recorded view selection.
 */
export interface SheetViewInfo {
  id: number;
  /** Current sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  name: string;
  filters: SheetViewFilter[];
  /** True when this view is the bound sheet's `active_view`. */
  active: boolean;
}

/**
 * Durable cell/range-anchored comment bound to one sheet. `anchor` is a
 * canonical `"A1"`/`"A1:B2"` coordinate string that remaps with row/column
 * insert/delete edits like Excel (an anchor inside a deleted band is
 * dropped with its comment); sorts move cell contents, not anchors.
 * Single-entry, not threaded: replies are a deferred host-side concern.
 */
export interface CommentInfo {
  id: number;
  /** Current sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  /** Canonical `"A1"` or `"A1:B2"` anchor on the bound sheet. */
  anchor: string;
  /** Present only when set (1-128 bytes, no control characters). */
  author?: string;
  /** Non-blank body, at most 8192 UTF-8 bytes. */
  body: string;
  resolved: boolean;
}

/** `addComment`/`listComments` anchor: exactly one of `cell` or `range`. */
export type CommentAnchor = { cell: string; range?: never } | { range: { from: string; to: string }; cell?: never };

/** Bounded pivot aggregation kinds the engine stores. */
export type PivotAgg = "sum" | "count" | "avg" | "min" | "max";

/**
 * One aggregated value slot: `field` is a 0-based column offset into the
 * pivot's source range (not a header name — robust against header edits).
 */
export interface PivotValueInput {
  field: number;
  agg: PivotAgg;
}

/** One field filter: a source field offset plus 1–64 accepted literal values. */
export interface PivotFilterInput {
  field: number;
  values: string[];
}

/** Optional result ordering hint over one source field. */
export interface PivotSortInput {
  field: number;
  ascending: boolean;
}

/**
 * Input for `insertPivot`'s `pivot` field (id/sheet are engine-assigned).
 * `source.sheet` accepts a sheet name or index and defaults to the pivot's
 * output sheet. Storage only — the engine never computes or writes the
 * pivot grid; update/refresh/materialization are deferred.
 */
export interface PivotInput {
  /** 1–128 byte display name; omit for none. */
  name?: string;
  source: {
    sheet?: string | number;
    /** Source data rectangle on the source sheet (≤16384 cells). */
    range: { from: string; to: string };
  };
  /** Row fields: ≤16 unique 0-based source column offsets. */
  rows?: readonly number[];
  /** Column fields: ≤16 unique 0-based source column offsets. */
  columns?: readonly number[];
  /** ≥1 aggregated value slots (≤16). */
  values: readonly PivotValueInput[];
  /** ≤32 field filters with unique fields. */
  filters?: readonly PivotFilterInput[];
  sort?: PivotSortInput;
}

/**
 * `updatePivot` patch: present keys set, explicit `null` clears
 * `name`/`filters`/`sort`; `source`/`rows`/`columns`/`values` cannot be
 * null. `source` is a partial `{sheet?, range?}` — at least one key.
 * An unchanged spec is eventless.
 */
export interface PivotPatch {
  name?: string | null;
  source?: { sheet?: string | number; range?: { from: string; to: string } };
  rows?: readonly number[];
  columns?: readonly number[];
  values?: readonly PivotValueInput[];
  filters?: readonly PivotFilterInput[] | null;
  sort?: PivotSortInput | null;
}

/**
 * Durable pivot-table spec bound to an output sheet, sourcing data from a
 * (possibly different) sheet's canonical range. Storage only — the engine
 * stores and returns the bounded spec; computing, refreshing and
 * materializing the pivot grid are deferred to a later slice.
 */
export interface PivotInfo {
  id: number;
  /** Current output sheet name, or null if the bound sheet is gone. */
  sheet: string | null;
  sheet_id: number;
  name?: string;
  source: {
    /** Current source sheet name, or null if the bound sheet is gone. */
    sheet: string | null;
    sheet_id: number;
    /** Canonical `"A1"`/`"A1:B2"` source range on the source sheet. */
    range: string;
  };
  /** 0-based source column offsets (always emitted, possibly empty). */
  rows?: number[];
  /** 0-based source column offsets (always emitted, possibly empty). */
  columns?: number[];
  values: PivotValueInput[];
  filters?: PivotFilterInput[];
  sort?: PivotSortInput;
}

/**
 * One durable merged-cell region bound to a sheet. `from`/`to` are the
 * canonical A1 corners of an inclusive rectangle spanning at least two
 * cells; regions never overlap. Covered cells report `merged_into` (the
 * `from` anchor) in `getCell`/`getRange`; every cell stays live to
 * formulas and reads. Regions remap with row/column insert/delete edits
 * and shrink or drop when their band is deleted.
 */
export interface MergedRangeInfo {
  sheet: string;
  sheet_id: number;
  /** Top-left (anchor) cell, e.g. `"B2"`. */
  from: string;
  /** Bottom-right cell, e.g. `"D4"`. */
  to: string;
}

/**
 * Structural band edit payload: 1-based inclusive row/column indexes on
 * `sheet` (name or index; default active). `from`/`to` may span many rows
 * or columns; inserts shift every coordinate-bound structure at or after
 * `from`, deletes remove the band and remap the rest (see
 * docs/ENGINE_OPS.md § tally for the full remap matrix).
 */
export interface BandEdit {
  sheet?: string | number;
  /** First row/column of the band, 1-based inclusive. */
  from: number;
  /** Last row/column of the band, 1-based inclusive. */
  to: number;
}

export class TallyDocument {
  private constructor(private doc: DocumentHandle) {}

  static async open(host: EngineHost): Promise<TallyDocument> {
    const doc = await DocumentHandle.openInitialized(host, "tally",
      (document) => document.apply(OPS.newDoc, {}));
    return new TallyDocument(doc);
  }

  /** Reopen a workbook from bytes produced by `save()`. */
  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<TallyDocument> {
    const doc = await DocumentHandle.openSnapshot(host, "tally", bytes);
    return new TallyDocument(doc);
  }

  get handle(): DocumentHandle {
    return this.doc;
  }

  private call<T>(op: string, payload?: unknown): Promise<CommandResult<T>> {
    return this.doc.apply<T>(op, payload);
  }

  addSheet(name?: string) {
    return this.call<{ sheet: string }>(OPS.addSheet, { name });
  }
  renameSheet(sheet: string | number, to: string) {
    return this.call(OPS.renameSheet, { sheet, to });
  }
  removeSheet(sheet: string | number) {
    return this.call(OPS.removeSheet, { sheet });
  }
  setActive(sheet: string | number) {
    return this.call(OPS.setActive, { sheet });
  }
  protectSheet(sheet: string | number, protectedValue: boolean) {
    return this.call<{ ok: boolean }>(OPS.protectSheet, { sheet, protected: protectedValue });
  }
  duplicateSheet(sheet: string | number) {
    return this.call<{ sheet: { id: number; name: string; index: number } }>(OPS.duplicateSheet, { sheet });
  }
  moveSheet(sheet: string | number, toIndex: number) {
    return this.call<{ ok: boolean }>(OPS.moveSheet, { sheet, toIndex });
  }
  setSheetColor(sheet: string | number, tone: SheetTabTone | null) {
    return this.call<{ ok: boolean }>(OPS.setSheetColor, { sheet, tone });
  }
  setCell(addr: string, value: string) {
    return this.call<{ addr: string; computed: CellValue }>(OPS.setCell, {
      addr,
      value,
    });
  }
  /** Atomic rectangular paste; empty strings clear cells. */
  setRange(from: string, values: readonly (readonly string[])[]) {
    return this.call<{ changed: number }>(OPS.setRange, { from, values });
  }
  /** Repeat the source into a containing target, shifting relative formulas. */
  fillRange(source: { from: string; to: string }, target: { from: string; to: string }) {
    return this.call<{ changed: number }>(OPS.fillRange, { source, target });
  }
  /** Linear series fill from a single-row/column numeric source; writes literals. */
  fillSeries(source: { from: string; to: string }, target: { from: string; to: string }, step?: number) {
    return this.call<{ changed: number }>(OPS.fillSeries, {
      source,
      target,
      ...(step === undefined ? {} : { step }),
    });
  }
  /** Apply a format patch to a range or explicit cell list; `null` clears an attribute. */
  setFormat(target: FormatTarget, format: CellFormatPatch) {
    const payload = Array.isArray(target)
      ? { cells: [...target], format }
      : { range: target, format };
    return this.call<{ changed: number }>(OPS.setFormat, payload);
  }
  /** Remove stored formats from a range or explicit cell list; contents are untouched. */
  clearFormat(target: FormatTarget) {
    const payload = Array.isArray(target)
      ? { cells: [...target] }
      : { range: target };
    return this.call<{ changed: number }>(OPS.clearFormat, payload);
  }
  clearCell(addr: string) {
    return this.call(OPS.clearCell, { addr });
  }
  /** Define a workbook-scoped name bound to `sheet` (name or index; default active). */
  defineName(name: string, refersTo: string, sheet?: string | number) {
    return this.call<{ name: NamedRangeInfo }>(OPS.defineName, {
      name,
      refers_to: refersTo,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /** Retarget a name's sheet and/or refers_to; at least one field required (explicit null counts as absent). */
  updateName(name: string, patch: { sheet?: string | number; refersTo?: string }) {
    return this.call<{ name: NamedRangeInfo }>(OPS.updateName, {
      name,
      ...(patch.sheet === undefined ? {} : { sheet: patch.sheet }),
      ...(patch.refersTo === undefined ? {} : { refers_to: patch.refersTo }),
    });
  }
  removeName(name: string) {
    return this.call<{ ok: boolean }>(OPS.removeName, { name });
  }
  listNames() {
    return this.call<{ names: NamedRangeInfo[] }>(OPS.listNames, {});
  }
  /** Read-only catalog of the bounded function set the evaluator supports. */
  functionCatalog() {
    return this.call<{ functions: FunctionInfo[] }>(OPS.functionCatalog, {});
  }
  /**
   * Create or replace the validation rule for `range` on `sheet` (name or
   * index; default active). The range must not partially overlap an existing
   * rule on that sheet; an identical sheet+range replaces the criteria.
   */
  setValidation(range: { from: string; to: string }, rule: ValidationCriteria, sheet?: string | number) {
    return this.call<{ rule: ValidationRuleInfo }>(OPS.setValidation, {
      range,
      rule,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Remove validation rules: by rule `id`, or every rule on `sheet`
   * (default active) intersecting `range`.
   */
  clearValidation(target: number | { from: string; to: string }, sheet?: string | number) {
    const payload = typeof target === "number"
      ? { id: target }
      : { range: target, ...(sheet === undefined ? {} : { sheet }) };
    return this.call<{ cleared: number }>(OPS.clearValidation, payload);
  }
  /** Read-only: does the cell's computed value satisfy its covering rule? */
  validateCell(addr: string, sheet?: string | number) {
    return this.call<CellValidation>(OPS.validateCell, {
      addr,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Append a conditional-format rule to `sheet` (name or index; default
   * active). `range` is `{from,to}`; an identical existing rule is an
   * eventless no-op. Overlaps are allowed.
   */
  setConditionalFormat(
    range: { from: string; to: string },
    rule: ConditionalRuleInput,
    sheet?: string | number,
  ) {
    return this.call<{ rule: ConditionalRuleInfo }>(OPS.setConditionalFormat, {
      range,
      rule,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Remove conditional rules: either `{id}` for one rule, or
   * `{range, sheet?}` removing every rule on that sheet intersecting the
   * rectangle. Exactly one form is required.
   */
  clearConditionalFormat(
    target: { id: number } | { range: { from: string; to: string }; sheet?: string | number },
  ) {
    const payload = "id" in target
      ? { id: target.id }
      : {
          range: target.range,
          ...(target.sheet === undefined ? {} : { sheet: target.sheet }),
        };
    return this.call<{ cleared: number }>(OPS.clearConditionalFormat, payload);
  }
  /** Read-only rule list; `sheet` filters to one sheet, absent lists all. */
  getConditionalFormats(sheet?: string | number) {
    return this.call<{ rules: ConditionalRuleInfo[] }>(OPS.getConditionalFormats, {
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Read-only match report: per cell in `range` on `sheet` (default active),
   * the computed value and every rule whose criteria it satisfies. Reports
   * matches only — the engine does not apply or render styles.
   */
  evaluateConditionalFormats(
    range: { from: string; to: string },
    sheet?: string | number,
  ) {
    return this.call<{ cells: ConditionalMatch[] }>(OPS.evaluateConditionalFormats, {
      range,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Stable sort of whole rows inside `range` on `sheet` (name or index;
   * default active) by computed key-cell values. Keys are tried in order;
   * rows equal on every key keep their original order. Formulas move
   * verbatim — references are NOT rewritten (see docs/ENGINE_OPS.md).
   * `hasHeader` keeps the range's first row in place.
   */
  sortRange(
    range: { from: string; to: string },
    keys: readonly SortKey[],
    options?: { sheet?: string | number; hasHeader?: boolean },
  ) {
    return this.call<{ changed: number; sorted_rows: number }>(OPS.sortRange, {
      range,
      keys: [...keys],
      ...(options?.sheet === undefined ? {} : { sheet: options.sheet }),
      ...(options?.hasHeader === undefined ? {} : { has_header: options.hasHeader }),
    });
  }
  /**
   * Append a row-filter rule to `sheet` (name or index; default active).
   * `column` restricts the criteria to one column inside `range`; absent
   * means every cell of the row's range slice must satisfy the criteria.
   * An identical existing rule is an eventless no-op.
   */
  setFilter(
    range: { from: string; to: string },
    criteria: string,
    options?: { sheet?: string | number; column?: string },
  ) {
    return this.call<{ rule: FilterRuleInfo }>(OPS.setFilter, {
      range,
      criteria,
      ...(options?.sheet === undefined ? {} : { sheet: options.sheet }),
      ...(options?.column === undefined ? {} : { column: options.column }),
    });
  }
  /**
   * Remove filter rules: by rule `id`, or every rule on `sheet`
   * (default active) intersecting `range`. Exactly one form is required.
   */
  clearFilter(target: number | { from: string; to: string }, sheet?: string | number) {
    const payload = typeof target === "number"
      ? { id: target }
      : { range: target, ...(sheet === undefined ? {} : { sheet }) };
    return this.call<{ cleared: number }>(OPS.clearFilter, payload);
  }
  /** Read-only filter rule list; `sheet` filters to one sheet, absent lists all. */
  getFilters(sheet?: string | number) {
    return this.call<{ rules: FilterRuleInfo[] }>(OPS.getFilters, {
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Read-only per-row filter report over `range` on `sheet` (default
   * active). Without `id`, each row reports `visible` plus the `matched`/
   * `failed` covering-rule ids; with `id`, each row reports `matched`
   * against that one rule. `visible:false` rows are the ones a host should
   * hide — the engine never deletes or hides cells itself.
   */
  evaluateFilters(
    range: { from: string; to: string },
    options?: { sheet?: string | number; id?: number },
  ) {
    return this.call<{ rows: (FilterRowVisibility | FilterRowMatch)[] }>(
      OPS.evaluateFilters,
      {
        range,
        ...(options?.sheet === undefined ? {} : { sheet: options.sheet }),
        ...(options?.id === undefined ? {} : { id: options.id }),
      },
    );
  }
  /**
   * Insert a chart object bound to `sheet` (name or index; default
   * active). Stores the bounded spec only — rendering is host-side.
   */
  insertChart(chart: ChartInput, sheet?: string | number) {
    return this.call<{ chart: ChartInfo }>(OPS.insertChart, {
      chart: {
        kind: chart.kind,
        ...(chart.title === undefined ? {} : { title: chart.title }),
        range: chart.range,
        ...(chart.series === undefined ? {} : { series: chart.series.map((s) => ({
          ...(s.name === undefined ? {} : { name: s.name }),
          ...(s.range === undefined ? {} : { range: s.range }),
        })) }),
        ...(chart.colors === undefined ? {} : { colors: chart.colors }),
      },
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Partially update chart `id`: present patch keys set, `null` clears
   * `title`/`series`/`colors`. An unchanged spec is eventless.
   */
  updateChart(id: number, patch: ChartPatch) {
    return this.call<{ chart: ChartInfo }>(OPS.updateChart, { id, patch });
  }
  removeChart(id: number) {
    return this.call<{ ok: boolean }>(OPS.removeChart, { id });
  }
  /** Read-only chart list; `sheet` filters to one sheet, absent lists all. */
  listCharts(sheet?: string | number) {
    return this.call<{ charts: ChartInfo[] }>(OPS.listCharts, {
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Attach a sparkline spec to a `cell` or `range` anchor on `sheet`
   * (default active), summarizing `data` (a `{from,to}` range). Identical
   * sheet+target+data+kind is eventless; the same target with a different
   * spec replaces in place keeping the id. Storage only — host renders.
   */
  setSparkline(target: SparklineTarget, data: { from: string; to: string }, kind: SparklineKind, sheet?: string | number) {
    return this.call<{ sparkline: SparklineInfo }>(OPS.setSparkline, {
      ...("cell" in target ? { cell: target.cell } : { range: target.range }),
      data,
      kind,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Remove sparkline specs: by rule `id`, or every spec on `sheet`
   * (default active) with the given `cell`/`range` target.
   */
  clearSparkline(target: number | SparklineTarget, sheet?: string | number) {
    const payload = typeof target === "number"
      ? { id: target }
      : {
          ...("cell" in target ? { cell: target.cell } : { range: target.range }),
          ...(sheet === undefined ? {} : { sheet }),
        };
    return this.call<{ cleared: number }>(OPS.clearSparkline, payload);
  }
  /** Read-only sparkline list; `sheet` filters to one sheet, absent lists all. */
  listSparklines(sheet?: string | number) {
    return this.call<{ sparklines: SparklineInfo[] }>(OPS.listSparklines, {
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Capture `sheet`'s (default active) current filter rules into a named
   * view. Re-saving the same case-insensitive name on the same sheet
   * updates the captured specs in place, keeping the view id; an
   * identical capture is eventless. Views hold at most 64 filter specs.
   */
  saveSheetView(name: string, sheet?: string | number) {
    return this.call<{ view: SheetViewInfo }>(OPS.saveSheetView, {
      name,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Apply view `id` to its bound sheet: the sheet's filter rules are
   * replaced by the view's captured specs under fresh ids and the
   * selection is recorded durably. Re-applying the active view is
   * eventless. `null` clears the resolved sheet's (default active)
   * selection without touching its filters; `sheet` is only valid with
   * `null` — the engine rejects it alongside a view id.
   */
  setSheetView(view: number): Promise<CommandResult<{ view: SheetViewInfo | null }>>;
  setSheetView(view: null, sheet?: string | number): Promise<CommandResult<{ view: SheetViewInfo | null }>>;
  setSheetView(view: number | null, sheet?: string | number) {
    return this.call<{ view: SheetViewInfo | null }>(OPS.setSheetView, {
      view,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  removeSheetView(id: number) {
    return this.call<{ ok: boolean }>(OPS.removeSheetView, { id });
  }
  /** Read-only view list; `sheet` filters to one sheet, absent lists all. */
  listSheetViews(sheet?: string | number) {
    return this.call<{ views: SheetViewInfo[] }>(OPS.listSheetViews, {
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Attach a comment to a `cell` or `range` anchor on `sheet` (name or
   * index; default active). `body` is required non-blank (≤8192 UTF-8
   * bytes); `author` is optional (≤128 bytes, no control characters) and
   * `resolved` defaults false. Anchors are static coordinates — content
   * edits and sorts never move them.
   */
  addComment(anchor: CommentAnchor, body: string, options?: { sheet?: string | number; author?: string; resolved?: boolean }) {
    return this.call<{ comment: CommentInfo }>(OPS.addComment, {
      ...("cell" in anchor ? { cell: anchor.cell } : { range: anchor.range }),
      body,
      ...(options?.sheet === undefined ? {} : { sheet: options.sheet }),
      ...(options?.author === undefined ? {} : { author: options.author }),
      ...(options?.resolved === undefined ? {} : { resolved: options.resolved }),
    });
  }
  /**
   * Patch comment `id`: present `author`/`body` keys set (`author:null`
   * clears the author), absent keys keep values. Anchors are not
   * re-pointable. No fields or an equal patch is eventless.
   */
  updateComment(id: number, patch: { author?: string | null; body?: string }) {
    return this.call<{ comment: CommentInfo }>(OPS.updateComment, { id, ...patch });
  }
  removeComment(id: number) {
    return this.call<{ ok: boolean }>(OPS.removeComment, { id });
  }
  /** Mark comment `id` resolved; already resolved is eventless. */
  resolveComment(id: number) {
    return this.call<{ comment: CommentInfo }>(OPS.resolveComment, { id });
  }
  /** Mark comment `id` open again; already open is eventless. */
  reopenComment(id: number) {
    return this.call<{ comment: CommentInfo }>(OPS.reopenComment, { id });
  }
  /**
   * Read-only comment list. `sheet` filters by bound sheet (absent lists
   * all); `cell`/`range` narrow to anchors containing the cell or
   * intersecting the range on the resolved sheet (default active) — the
   * engine rejects both together.
   */
  listComments(options?: {
    sheet?: string | number;
    cell?: string;
    range?: { from: string; to: string };
  }) {
    return this.call<{ comments: CommentInfo[] }>(OPS.listComments, {
      ...(options?.sheet === undefined ? {} : { sheet: options.sheet }),
      ...(options?.cell === undefined ? {} : { cell: options.cell }),
      ...(options?.range === undefined ? {} : { range: options.range }),
    });
  }
  /**
   * Structural row/column band edits. Each is atomic (one undo entry),
   * protection-gated on the target sheet, and remaps every
   * coordinate-bound structure: cell/format keys, formula references
   * (deleted refs become `#REF!`, partially-covered ranges shrink),
   * named ranges, validations, conditional formats, filters, charts,
   * sparklines, sheet views' captured filter specs, comment anchors,
   * pivot source ranges and merged regions. Entries fully inside a
   * deleted band are dropped (a pivot also drops when a column delete
   * shrinks its source range below a referenced field).
   * Bounds: `from`/`to` are 1-based inclusive within the sheet caps
   * (1,048,576 rows / 16,384 columns); a delete may not cover every row
   * or column; an insert must fit inside the cap. An insert that would
   * push any stored content (cells, formats, merges, rule/name/chart/
   * sparkline/view/comment ranges) past the sheet edge rejects with
   * `out_of_bounds` before mutating — deletes never reject for this.
   * A no-op band (nothing stored at/after it for inserts, nothing to
   * delete) still succeeds without recording undo.
   */
  private bandEdit(op: string, band: BandEdit) {
    return this.call<{ ok: boolean; changed: number }>(op, {
      ...(band.sheet === undefined ? {} : { sheet: band.sheet }),
      from: band.from,
      to: band.to,
    });
  }
  insertRows(band: BandEdit) {
    return this.bandEdit(OPS.insertRows, band);
  }
  deleteRows(band: BandEdit) {
    return this.bandEdit(OPS.deleteRows, band);
  }
  insertCols(band: BandEdit) {
    return this.bandEdit(OPS.insertCols, band);
  }
  deleteCols(band: BandEdit) {
    return this.bandEdit(OPS.deleteCols, band);
  }
  /**
   * Merge `range` (`{from,to}` A1 corners, at least two cells) on `sheet`
   * (name or index; default active). Regions may not overlap; merging an
   * already-merged region is an idempotent no-op. Covered cells report
   * `merged_into` in `getCell`/`getRange` but keep their contents —
   * formulas and reads still see every cell.
   */
  mergeCells(range: { from: string; to: string }, sheet?: string | number) {
    return this.call<{ ok: boolean; range: string }>(OPS.mergeCells, {
      range,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Unmerge every region overlapping `range` on `sheet` — a single-cell
   * range selects the merge covering it (Excel-style). Returns the count
   * of regions cleared; `0` is an eventless no-op. `range` is capped at
   * the shared 16,384-cell rectangle limit, so clearing a larger span
   * takes multiple calls.
   */
  unmergeCells(range: { from: string; to: string }, sheet?: string | number) {
    return this.call<{ cleared: number }>(OPS.unmergeCells, {
      range,
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /** List merged regions; `sheet` narrows to one sheet, absent lists all. */
  listMergedCells(sheet?: string | number) {
    return this.call<{ merges: MergedRangeInfo[] }>(OPS.listMergedCells, {
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Store a pivot-table spec bound to `sheet` (name or index; default
   * active), sourcing `pivot.source.range` on `pivot.source.sheet`
   * (default the output sheet). Fields are 0-based column offsets into
   * the source range. Storage only — the engine writes no cells;
   * compute/refresh/materialization are deferred.
   */
  insertPivot(pivot: PivotInput, sheet?: string | number) {
    return this.call<{ pivot: PivotInfo }>(OPS.insertPivot, {
      pivot: {
        ...(pivot.name === undefined ? {} : { name: pivot.name }),
        source: {
          ...(pivot.source.sheet === undefined ? {} : { sheet: pivot.source.sheet }),
          range: pivot.source.range,
        },
        ...(pivot.rows === undefined ? {} : { rows: [...pivot.rows] }),
        ...(pivot.columns === undefined ? {} : { columns: [...pivot.columns] }),
        values: pivot.values.map((v) => ({ field: v.field, agg: v.agg })),
        ...(pivot.filters === undefined
          ? {}
          : { filters: pivot.filters.map((f) => ({ field: f.field, values: [...f.values] })) }),
        ...(pivot.sort === undefined ? {} : { sort: pivot.sort }),
      },
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /**
   * Partially update pivot `id`: present patch keys set, `null` clears
   * `name`/`filters`/`sort`. An unchanged spec is eventless.
   */
  updatePivot(id: number, patch: PivotPatch) {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.source !== undefined) {
      body.source = {
        ...(patch.source.sheet === undefined ? {} : { sheet: patch.source.sheet }),
        ...(patch.source.range === undefined ? {} : { range: patch.source.range }),
      };
    }
    if (patch.rows !== undefined) body.rows = [...patch.rows];
    if (patch.columns !== undefined) body.columns = [...patch.columns];
    if (patch.values !== undefined) {
      body.values = patch.values.map((v) => ({ field: v.field, agg: v.agg }));
    }
    if (patch.filters !== undefined) {
      body.filters = patch.filters === null
        ? null
        : patch.filters.map((f) => ({ field: f.field, values: [...f.values] }));
    }
    if (patch.sort !== undefined) body.sort = patch.sort;
    return this.call<{ pivot: PivotInfo }>(OPS.updatePivot, { id, patch: body });
  }
  removePivot(id: number) {
    return this.call<{ ok: boolean }>(OPS.removePivot, { id });
  }
  /** Read-only pivot list; `sheet` filters to one output sheet, absent lists all. */
  listPivots(sheet?: string | number) {
    return this.call<{ pivots: PivotInfo[] }>(OPS.listPivots, {
      ...(sheet === undefined ? {} : { sheet }),
    });
  }
  /** Read-only single pivot spec by id. */
  describePivot(id: number) {
    return this.call<{ pivot: PivotInfo }>(OPS.describePivot, { id });
  }
  getCell(addr: string) {
    return this.call<{ raw: string; computed: CellValue; format?: CellFormat; merged_into?: string }>(OPS.getCell, { addr });
  }
  getRange(from: string, to: string) {
    return this.call<{ cells: CellInfo[][] }>(OPS.getRange, { from, to });
  }
  /**
   * Import delimited text into `sheet` (name or index; default active)
   * starting at `at` (default `A1`). Every parsed row is data — there is
   * no header handling — and field text is stored verbatim like
   * `setRange` (`=`-prefixed fields become formulas, numeric-looking text
   * computes as numbers, empty fields clear cells). RFC 4180 quoting,
   * CRLF/LF/CR breaks, UTF-8 BOM; completely blank lines are skipped and
   * rows may be ragged. Atomic: malformed or oversized text (over 16 MiB,
   * over the sheet bounds or the 1,048,576-cell budget) rejects without
   * mutation; one undo entry covers the whole import.
   */
  importDelimited(text: string, format: "csv" | "tsv", options?: { sheet?: string | number; at?: string }) {
    return this.call<{ changed: number; rows: number }>(
      format === "csv" ? OPS.importCsv : OPS.importTsv,
      {
        text,
        ...(options?.sheet === undefined ? {} : { sheet: options.sheet }),
        ...(options?.at === undefined ? {} : { at: options.at }),
      },
    );
  }
  importCsv(text: string, options?: { sheet?: string | number; at?: string }) {
    return this.importDelimited(text, "csv", options);
  }
  importTsv(text: string, options?: { sheet?: string | number; at?: string }) {
    return this.importDelimited(text, "tsv", options);
  }
  /**
   * Export computed values of `sheet` (name or index; default active) as
   * delimited text. `range` (`{from,to}`) narrows the rectangle; absent it
   * the export covers the bounding box of the sheet's used cells. Both
   * forms are capped at 16,384 cells. RFC 4180 quoting with CRLF row
   * breaks; number formats are ignored.
   */
  exportDelimited(format: "csv" | "tsv", options?: { sheet?: string | number; range?: { from: string; to: string } }) {
    return this.call<{ text: string; rows: number; cols: number }>(
      format === "csv" ? OPS.exportCsv : OPS.exportTsv,
      {
        ...(options?.sheet === undefined ? {} : { sheet: options.sheet }),
        ...(options?.range === undefined ? {} : { range: options.range }),
      },
    );
  }
  exportCsv(options?: { sheet?: string | number; range?: { from: string; to: string } }) {
    return this.exportDelimited("csv", options);
  }
  exportTsv(options?: { sheet?: string | number; range?: { from: string; to: string } }) {
    return this.exportDelimited("tsv", options);
  }
  evaluate(formula: string) {
    return this.call<{ value: CellValue }>(OPS.evaluate, { formula });
  }
  workbook() {
    return this.call<WorkbookInfo>(OPS.workbook);
  }
  describe<T = unknown>() {
    return this.call<T>(OPS.describe);
  }

  save(): Promise<Uint8Array> {
    return this.doc.snapshot();
  }
  undo(): Promise<boolean> {
    return this.doc.undo();
  }
  redo(): Promise<boolean> {
    return this.doc.redo();
  }
  close(): Promise<void> {
    return this.doc.close();
  }
}
