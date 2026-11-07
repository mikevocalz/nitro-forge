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
  clearCell: "clearCell",
  getCell: "getCell",
  getRange: "getRange",
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

/** One entry of the read-only `functionCatalog` op. */
export interface FunctionInfo {
  name: string;
  min_args: number;
  /** `null` marks a variadic function. */
  max_args: number | null;
  signature: string;
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
  getCell(addr: string) {
    return this.call<{ raw: string; computed: CellValue; format?: CellFormat }>(OPS.getCell, { addr });
  }
  getRange(from: string, to: string) {
    return this.call<{ cells: CellInfo[][] }>(OPS.getRange, { from, to });
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
