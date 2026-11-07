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
}

export type SheetTabTone = "primary" | "accent" | "success" | "info" | "muted";

export interface WorkbookInfo {
  sheets: { name: string; cell_count: number; tone?: SheetTabTone | null; is_protected?: boolean }[];
  active: number;
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
  clearCell(addr: string) {
    return this.call(OPS.clearCell, { addr });
  }
  getCell(addr: string) {
    return this.call<{ raw: string; computed: CellValue }>(OPS.getCell, { addr });
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
