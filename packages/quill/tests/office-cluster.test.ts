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
    blocks: vi.fn(() => ok(blocks)), applyStyle: rec("applyStyle"), setBlockKind: rec("setBlockKind"),setListKind:rec("setListKind"),setListFormat:rec("setListFormat"),shiftListLevel:rec("shiftListLevel"),
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
  it("list binding uses real atomic kind/format/level operations and full context", async () => {
    const {doc,calls}=fake();const l=await bindQuillList(doc,3,3,()=>{});
    expect(l.kind).toBe('bullet');expect(l.items.map(i=>i.text)).toEqual(['One','Two']);expect([l.selectionStart,l.selectionEnd]).toEqual([1,1]);
    await l.onKindChange('numbered');await l.onLevelFormatChange!(0,'upperRoman');await l.onShiftLevel!(1);
    expect(calls).toEqual([['setListKind',3,3,'numbered'],['setListFormat',3,3,0,'upperRoman'],['shiftListLevel',3,3,1]]);
    await expect(bindQuillList(doc,1,3,()=>{})).rejects.toThrow('mixed list/nonlist');
    await expect(bindQuillList(doc,2,9,()=>{})).rejects.toThrow(RangeError);
  });
  it("withholds a fake canonical preview for nondefault starts or multiple definitions",async()=>{
    const {doc}=fake();const levels=Array.from({length:9},(_,i)=>({format:'decimal',start:i===0?5:1,indent_twips:720*(i+1),hanging_twips:360}));
    const item={kind:'list',list:{level:0,definition:{id:1,kind:'numbered',levels}},inlines:[{text:'Actual fifth item',style:{}}]};
    const source={...doc,blocks:vi.fn(()=>ok({blocks:[item]}))} as unknown as QuillOfficeDocument;
    await expect(bindQuillList(source,0,0,()=>{})).rejects.toThrow('nondefault numbering starts');
    const mixed={...doc,blocks:vi.fn(()=>ok({blocks:[item,{...item,list:{...item.list,definition:{...item.list.definition,id:2}}}]}))} as unknown as QuillOfficeDocument;
    await expect(bindQuillList(mixed,0,1,()=>{})).rejects.toThrow('one list definition');
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

describe("direct font-family ribbon binding", () => {
  it("reports mixed and inherited families and forwards set/clear without invented typing style", async () => {
    const { doc, calls } = fake();
    const sel = { start: { block: 1, offset: 0 }, end: { block: 1, offset: 5 } };
    const changed = vi.fn();
    const binding = await bindQuillRibbon(doc, sel, changed);
    expect(binding.fontFamily).toBeUndefined();
    await binding.onFontFamilyChange("Aptos");
    await binding.onFontFamilyChange(undefined);
    expect(calls).toEqual([
      ["applyStyle", sel.start, sel.end, { font_family: "Aptos" }],
      ["applyStyle", sel.start, sel.end, { font_family: null }],
    ]);
    expect(changed).toHaveBeenCalledTimes(2);
    // A separate read fixture reports durable mixed state, rather than mutating
    // the shared fake and making unrelated selection assertions order-dependent.
    const mixed = { ...doc, blocks: vi.fn(() => ok({ blocks: [{ kind: "para", inlines: [
      { text: "a", style: { font_family: "Aptos" } }, { text: "b", style: {} },
    ] }] })) } as unknown as QuillOfficeDocument;
    const mixedBinding = await bindQuillRibbon(mixed, { start: { block: 0, offset: 0 }, end: { block: 0, offset: 2 } }, () => {});
    expect(mixedBinding.fontFamily).toBe("mixed");
    const caret = await bindQuillRibbon(doc, { start: sel.start, end: sel.start }, changed);
    await expect(caret.onFontFamilyChange("Aptos")).rejects.toThrow(/Select text/);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("preserves engine rejection and does not publish a refreshed binding after failure", async () => {
    const { doc } = fake();
    const failure = new Error("invalid font family");
    const changed = vi.fn();
    const rejected = { ...doc, applyStyle: vi.fn(() => Promise.reject(failure)) } as unknown as QuillOfficeDocument;
    const binding = await bindQuillRibbon(rejected, { start: { block: 1, offset: 0 }, end: { block: 1, offset: 2 } }, changed);
    await expect(binding.onFontFamilyChange("")).rejects.toBe(failure);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("font-size ribbon binding", () => {
  it("reads durable half-point size, forwards set/clear and preserves engine rejection", async () => {
    const { doc, calls } = fake();
    const sized = { ...doc, blocks: vi.fn(() => ok({ blocks: [{ kind: "para", inlines: [
      { text: "a", style: { font_size: 10.5 } }, { text: "b", style: { font_size: 10.5 } },
    ] }] })) } as unknown as QuillOfficeDocument;
    const sel = { start: { block: 0, offset: 0 }, end: { block: 0, offset: 2 } };
    const changed = vi.fn();
    const binding = await bindQuillRibbon(sized, sel, changed);
    expect(binding.fontSize).toBe(10.5);
    await binding.onFontSizeChange(12);
    await binding.onFontSizeChange(undefined);
    expect(calls).toEqual([
      ["applyStyle", sel.start, sel.end, { font_size: 12 }],
      ["applyStyle", sel.start, sel.end, { font_size: null }],
    ]);
    const failure = new Error("size must use half-points");
    const rejected = { ...sized, applyStyle: vi.fn(() => Promise.reject(failure)) } as unknown as QuillOfficeDocument;
    const onChanged = vi.fn();
    const invalid = await bindQuillRibbon(rejected, sel, onChanged);
    await expect(invalid.onFontSizeChange(10.25)).rejects.toBe(failure);
    expect(onChanged).not.toHaveBeenCalled();
    const caret = await bindQuillRibbon(sized, { start: sel.start, end: sel.start }, changed);
    await expect(caret.onFontSizeChange(12)).rejects.toThrow(/Select text/);
  });
});

describe("RGB highlight ribbon binding", () => {
  it("reports mixed background, clears explicitly and preserves engine rejection", async () => {
    const { doc, calls } = fake();
    const highlighted = { ...doc, blocks: vi.fn(() => ok({ blocks: [{ kind: "para", inlines: [
      { text: "a", style: { highlight: "#123456" } }, { text: "b", style: {} },
    ] }] })) } as unknown as QuillOfficeDocument;
    const sel = { start: { block: 0, offset: 0 }, end: { block: 0, offset: 2 } };
    const changed = vi.fn();
    const binding = await bindQuillRibbon(highlighted, sel, changed);
    expect(binding.highlight).toBe("mixed");
    await binding.onHighlightChange("#12aBcF");
    await binding.onHighlightChange(undefined);
    expect(calls).toEqual([
      ["applyStyle", sel.start, sel.end, { highlight: "#12aBcF" }],
      ["applyStyle", sel.start, sel.end, { highlight: null }],
    ]);
    const failure = new Error("RGB highlight required");
    const rejected = { ...highlighted, applyStyle: vi.fn(() => Promise.reject(failure)) } as unknown as QuillOfficeDocument;
    const onChanged = vi.fn();
    const invalid = await bindQuillRibbon(rejected, sel, onChanged);
    await expect(invalid.onHighlightChange("yellow")).rejects.toBe(failure);
    expect(onChanged).not.toHaveBeenCalled();
    const caret = await bindQuillRibbon(highlighted, { start: sel.start, end: sel.start }, changed);
    await expect(caret.onHighlightChange("#123456")).rejects.toThrow(/Select text/);
  });
});

it("refreshes case callbacks with the engine's adjusted scalar selection", async () => {
  let text = "ß";
  const changeCase = vi.fn(async (_from: unknown, _to: unknown, _mode: unknown) => {
    text = "SS";
    return ok({ from: { block: 0, offset: 0 }, to: { block: 0, offset: 2 } });
  });
  const applyStyle = vi.fn(() => ok({ ok: true }));
  const doc = { blocks: vi.fn(() => ok({ blocks: [{ kind: "para", inlines: [{ text, style: { bold: true } }] }] })), changeCase, applyStyle } as unknown as QuillOfficeDocument;
  let latest: Awaited<ReturnType<typeof bindQuillRibbon>> | undefined;
  const binding = await bindQuillRibbon(doc, { start: { block: 0, offset: 0 }, end: { block: 0, offset: 1 } }, next => { latest = next; });
  await binding.onChangeCase("upper");
  expect(changeCase).toHaveBeenCalledWith({ block: 0, offset: 0 }, { block: 0, offset: 1 }, "upper");
  expect(latest!.selection).toEqual({ start: { block: 0, offset: 0 }, end: { block: 0, offset: 2 } });
  await latest!.onToggle("italic", true);
  expect(applyStyle).toHaveBeenCalledWith({ block: 0, offset: 0 }, { block: 0, offset: 2 }, { italic: true });
  const caret = await bindQuillRibbon(doc, { start: { block: 0, offset: 0 }, end: { block: 0, offset: 0 } }, () => {});
  await expect(caret.onChangeCase("lower")).rejects.toThrow("Select text");
});
