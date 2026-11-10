import { commitTallyFill } from "../src/grid-cluster";
import { describe, expect, it, vi } from "vitest";
import {
  bindTallySheetTabs, readTallySheetTabs, readTallyRange, tallyRangeWindow, commitTallyCardField,
  TALLY_DEFERRED_OPS, TALLY_SHEET_BOUNDS, type TallySheetDocument,
} from "../src/grid-cluster";
import { OPS } from "../src/index";

const ok = <T>(data: T) => Promise.resolve({ events: [], data });

function fakeSheets() {
  const state = { sheets: ["Sheet1", "Sheet2"], active: 0 };
  const protectedNames = new Set<string>();
  const tones = new Map<string, string | null>();
  const doc = {
    workbook: vi.fn(() => ok({ sheets: state.sheets.map(name => ({ name, cell_count: 0, tone: tones.get(name) ?? null, is_protected: protectedNames.has(name) })), active: state.active })),
    setActive: vi.fn((i: number) => { state.active = i; return ok({ ok: true }); }),
    addSheet: vi.fn(() => { state.sheets.push("Sheet" + (state.sheets.length + 1)); return ok({ sheet: "x" }); }),
    renameSheet: vi.fn((i: number, to: string) => {
      if (state.sheets.some(n => n.toLowerCase() === to.toLowerCase())) return Promise.reject(new Error(`sheet name '${to}' already exists`));
      state.sheets[i] = to; return ok({ ok: true });
    }),
    protectSheet: vi.fn((i: number, value: boolean) => {
      const name = state.sheets[i]!;
      if (value) protectedNames.add(name); else protectedNames.delete(name);
      return ok({ ok: true });
    }),
    duplicateSheet: vi.fn((i: number) => {
      const active = state.sheets[state.active];
      const name = state.sheets[i]! + " Copy 1";
      state.sheets.splice(i + 1, 0, name);
      tones.set(name, tones.get(state.sheets[i]!) ?? null);
      state.active = state.sheets.indexOf(active!);
      return ok({ sheet: { id: 2, name, index: i + 1 } });
    }),
    moveSheet: vi.fn((i: number, to: number) => {
      const active = state.sheets[state.active];
      const [sheet] = state.sheets.splice(i, 1);
      state.sheets.splice(to, 0, sheet!);
      state.active = state.sheets.indexOf(active!);
      return ok({ ok: true });
    }),
    setSheetColor: vi.fn((i: number, tone: string | null) => { tones.set(state.sheets[i]!, tone); return ok({ ok: true }); }),
    removeSheet: vi.fn((i: number) => { state.sheets.splice(i, 1); state.active = Math.min(state.active, state.sheets.length - 1); return ok({ ok: true }); }),
  };
  return { state, doc: doc as unknown as TallySheetDocument, raw: doc };
}

describe("I-08 SheetTabs binding over Tally sheet ops", () => {
  it("maps the workbook to tabs keyed by engine index", async () => {
    const { doc } = fakeSheets();
    expect(await readTallySheetTabs(doc)).toEqual({ tabs: [{ id: "0", name: "Sheet1" }, { id: "1", name: "Sheet2" }], activeId: "0" });
  });

  it("writes through the engine, then hands back a fresh binding", async () => {
    const { doc, raw } = fakeSheets();
    const changes: unknown[] = [];
    const binding = await bindTallySheetTabs(doc, next => changes.push(next));
    await binding.onSelect("1");
    expect(raw.setActive).toHaveBeenCalledWith(1);
    await binding.onAdd();
    expect(raw.addSheet).toHaveBeenCalledWith();
    await binding.onRename("0", "Budget");
    expect(raw.renameSheet).toHaveBeenCalledWith(0, "Budget");
    await binding.onRemove("2");
    expect(raw.removeSheet).toHaveBeenCalledWith(2);
    expect(changes).toHaveLength(4);
    expect((changes.at(-1) as { tabs: unknown[]; activeId: string })).toMatchObject({
      tabs: [{ id: "0", name: "Budget" }, { id: "1", name: "Sheet2" }], activeId: "1",
    });
  });

  it("rejects with the engine's message and reports no change", async () => {
    const { doc } = fakeSheets();
    const onChanged = vi.fn();
    const binding = await bindTallySheetTabs(doc, onChanged);
    await expect(binding.onRename("1", "sheet1")).rejects.toThrow("already exists");
    expect(onChanged).not.toHaveBeenCalled();
    await expect(binding.onSelect("-1")).rejects.toThrow(RangeError);
  });

  it("forwards reorder and semantic tones and refreshes after each write", async () => {
    const { doc, raw } = fakeSheets();
    const changes: unknown[] = [];
    const binding = await bindTallySheetTabs(doc, next => changes.push(next));
    await binding.onMove("0", 1);
    expect(raw.moveSheet).toHaveBeenCalledWith(0, 1);
    expect(changes.at(-1)).toMatchObject({ activeId: "1", tabs: [{ name: "Sheet2" }, { name: "Sheet1" }] });
    await binding.onToneChange("1", "accent");
    expect(changes.at(-1)).toMatchObject({ tabs: [{ name: "Sheet2" }, { name: "Sheet1", tone: "accent" }] });
    await binding.onToneChange("1", undefined);
    expect(raw.setSheetColor).toHaveBeenLastCalledWith(1, null);
    expect((changes.at(-1) as { tabs: unknown[] }).tabs[1]).not.toHaveProperty("tone");
  });

  it("forwards duplication and refreshes canonical tabs", async () => {
    const { doc, raw } = fakeSheets();
    const onChanged = vi.fn();
    const binding = await bindTallySheetTabs(doc, onChanged);
    await binding.onDuplicate("0");
    expect(raw.duplicateSheet).toHaveBeenCalledWith(0);
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({
      tabs: [{ id: "0", name: "Sheet1" }, { id: "1", name: "Sheet1 Copy 1" }, { id: "2", name: "Sheet2" }], activeId: "0",
    }));
  });

  it("forwards protection and refreshes the canonical lock state", async () => {
    const { doc, raw } = fakeSheets();
    const onChanged = vi.fn();
    const binding = await bindTallySheetTabs(doc, onChanged);
    await binding.onProtectedChange("0", true);
    expect(raw.protectSheet).toHaveBeenCalledWith(0, true);
    expect(onChanged).toHaveBeenLastCalledWith(expect.objectContaining({ tabs: [
      { id: "0", name: "Sheet1", isProtected: true }, { id: "1", name: "Sheet2" },
    ] }));
    raw.protectSheet.mockRejectedValueOnce(new Error("rejected"));
    await expect(binding.onProtectedChange("0", false)).rejects.toThrow("rejected");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("offers only callbacks Tally can back; the rest are named DEFERs", async () => {
    const binding = await bindTallySheetTabs(fakeSheets().doc, () => {});
    expect(Object.keys(binding).sort()).toEqual(["activeId", "onAdd", "onDuplicate", "onMove", "onProtectedChange", "onRemove", "onRename", "onSelect", "onToneChange", "tabs"]);
    for (const op of Object.keys(TALLY_DEFERRED_OPS)) expect(Object.values(OPS)).not.toContain(op);
  });
});

describe("I-13/I-14/I-20 range reads and card commits", () => {
  it("parses A1 ranges into end-exclusive windows", () => {
    expect(tallyRangeWindow("$c$9:a1")).toEqual({ startRow: 0, endRow: 9, startColumn: 0, endColumn: 3 });
    expect(tallyRangeWindow("E4")).toEqual({ startRow: 3, endRow: 4, startColumn: 4, endColumn: 5 });
    expect(() => tallyRangeWindow("A1:B2:C3")).toThrow();
    expect(() => tallyRangeWindow("XFE1")).toThrow();
  });

  it("reads exactly the requested range and enforces the cell budget", async () => {
    const getRange = vi.fn(() => ok({ cells: [[{ addr: "B2", raw: "5", computed: 5 }, { addr: "C2", raw: "x", computed: "x" }]] }));
    const doc = { getRange, setCell: vi.fn() } as never;
    const cells = await readTallyRange(doc, "B2:C2");
    expect(getRange).toHaveBeenCalledWith("B2", "C2");
    expect(cells.B2?.computed).toBe(5);
    await expect(readTallyRange(doc, "A1:Z1000")).rejects.toThrow(/cell budget/);
    expect(TALLY_SHEET_BOUNDS).toEqual({ rowCount: 1_048_576, columnCount: 16_384, maxWindowCells: 16_384 });
  });

  it("commits a card field through setCell", async () => {
    const setCell = vi.fn(() => ok({ addr: "B3", computed: 9 }));
    await commitTallyCardField({ getRange: vi.fn(), setCell } as never, "B3", "=4+5");
    expect(setCell).toHaveBeenCalledWith("B3", "=4+5");
    await expect(commitTallyCardField({ getRange: vi.fn(), setCell } as never, "b3", "1")).rejects.toThrow();
  });
});


it("commits an inclusive UI fill plan through one engine call", async () => {
  const fillRange = vi.fn(async () => ({ data: { changed: 4 }, events: [] }));
  const source = { startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 };
  const plan = { source, target: { ...source, endRow: 4 }, direction: "down" as const };
  await commitTallyFill({ fillRange } as never, plan);
  expect(fillRange).toHaveBeenCalledExactlyOnceWith({ from: "A2", to: "B3" }, { from: "A2", to: "B5" });
  expect(() => commitTallyFill({ fillRange } as never, { ...plan, target: { ...source, endRow: 0 } })).toThrow();
  expect(fillRange).toHaveBeenCalledTimes(1);
  fillRange.mockRejectedValueOnce(new Error("engine rejected"));
  await expect(commitTallyFill({ fillRange } as never, plan)).rejects.toThrow("engine rejected");
});
