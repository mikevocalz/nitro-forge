import { describe, expect, it, vi } from "vitest";
import {
  QUILL_DEFERRED_OPS, bindQuillList, bindQuillRibbon, quillSectionOf, quillSelectionRuns, readQuillBlocks, readQuillOutline,
  type QuillOfficeDocument,
} from "../src/office-cluster";
import { OPS } from "../src/index";

const ok = <T>(data: T) => Promise.resolve({ events: [], data });
const blocks = {
  blocks: [
    { kind: "h1", inlines: [{ text: "Plan", style: { bold: true } }] },
    { kind: "para", inlines: [{ text: "Hé", style: { bold: true } }, { text: "llo", style: { italic: true } }] },
    { kind: "list", inlines: [{ text: "One", style: {} }] },
    { kind: "list", inlines: [{ text: "Two", style: {} }] },
  ],
};
function fake() {
  const calls: unknown[][] = [];
  const rec = (name: string) => vi.fn((...args: unknown[]) => { calls.push([name, ...args]); return ok({ ok: true }); });
  const doc = {
    blocks: vi.fn(() => ok(blocks)), applyStyle: rec("applyStyle"), setBlockKind: rec("setBlockKind"),
    layout: vi.fn(() => ok({ pages: [{ lines: [{ block: 0, start: 0, end: 4 }, { block: 1, start: 0, end: 5 }] }, { lines: [{ block: 2, start: 0, end: 3 }, { block: 3, start: 0, end: 3 }] }] })),
  };
  return { doc: doc as unknown as QuillOfficeDocument, calls };
}

describe("Quill blocks and selection runs for H-03", () => {
  it("joins runs and reports the runs a selection covers", async () => {
    const b = await readQuillBlocks(fake().doc);
    expect(b.map(x => [x.kind, x.text])).toEqual([["h1", "Plan"], ["para", "Héllo"], ["list", "One"], ["list", "Two"]]);
    expect(quillSelectionRuns(b, { start: { block: 1, offset: 1 }, end: { block: 1, offset: 3 } })).toEqual([{ bold: true }, { italic: true }]);
    expect(quillSelectionRuns(b, { start: { block: 1, offset: 2 }, end: { block: 1, offset: 2 } })).toEqual([{ bold: true }]);
    expect(quillSelectionRuns(b, { start: { block: 1, offset: 0 }, end: { block: 1, offset: 0 } })).toEqual([{ bold: true }]);
    expect(quillSelectionRuns(b, { start: { block: 0, offset: 2 }, end: { block: 1, offset: 1 } })).toEqual([{ bold: true }, { bold: true }]);
    expect(() => quillSelectionRuns(b, { start: { block: 1, offset: 3 }, end: { block: 1, offset: 1 } })).toThrow(RangeError);
  });

  it("ribbon writes styles over the selection and clears color with null", async () => {
    const { doc, calls } = fake();
    const sel = { start: { block: 1, offset: 0 }, end: { block: 1, offset: 5 } };
    const r = await bindQuillRibbon(doc, sel, () => {});
    expect(r.paragraphStyle).toBe("para");
    await r.onToggle("bold", true);
    await r.onColorChange(undefined);
    await r.onColorChange("#b3261e");
    await r.onParagraphStyleChange("h2");
    expect(calls).toEqual([
      ["applyStyle", sel.start, sel.end, { bold: true }],
      ["applyStyle", sel.start, sel.end, { color: null }],
      ["applyStyle", sel.start, sel.end, { color: "#b3261e" }],
      ["setBlockKind", 1, "h2"],
    ]);
    await expect(r.onParagraphStyleChange("list")).rejects.toThrow(/not a Quill paragraph style/);
    const caret = await bindQuillRibbon(doc, { start: sel.start, end: sel.start }, () => {});
    await expect(caret.onToggle("italic", true)).rejects.toThrow(/Select text/);
  });
});

describe("H-07 list, H-15 outline, H-21 sections", () => {
  it("list binding offers on/off only and refuses numbering", async () => {
    const { doc, calls } = fake();
    const l = await bindQuillList(doc, 1, 3, () => {});
    expect(l.kind).toBe("mixed");
    expect(l.items.map(i => i.text)).toEqual(["Héllo", "One", "Two"]);
    await l.onKindChange("bullet");
    expect(calls).toEqual([["setBlockKind", 1, "list"], ["setBlockKind", 2, "list"], ["setBlockKind", 3, "list"]]);
    await expect(l.onKindChange("numbered")).rejects.toThrow(/setListFormat/);
    await expect(bindQuillList(doc, 2, 9, () => {})).rejects.toThrow(RangeError);
  });

  it("outline gives headings with their first page, and sections", async () => {
    const o = await readQuillOutline(fake().doc, 400, 12);
    expect(o).toEqual({ headings: [{ id: "b0", level: 1, text: "Plan", block: 0, page: 0 }], pageCount: 2 });
    expect(quillSectionOf(o.headings, 3)).toBe("Plan");
    expect(quillSectionOf([{ ...o.headings[0]!, block: 2 }], 1)).toBeUndefined();
  });

  it("names deferred ops that Quill's OPS does not have", () => {
    for (const op of Object.keys(QUILL_DEFERRED_OPS)) expect(Object.values(OPS)).not.toContain(op);
  });
});
