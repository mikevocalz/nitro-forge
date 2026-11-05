import { describe, expect, it, vi } from "vitest";
import {
  FOLIO_ANNOTATION_TOOLS, FOLIO_DEFERRED_OPS, addFolioAnnotation, bindFolioComments, folioSearchPages, folioThreadRef,
  readFolioReadAloudBlocks, readFolioThreads, type FolioOfficeDocument,
} from "../src/office-cluster";
import { OPS } from "../src/index";

const ok = <T>(data: T) => Promise.resolve({ events: [], data });
const texts = ["Harbor one", "", "harbor two", "nothing"];
function fake() {
  const calls: unknown[][] = [];
  const annots: Record<number, { id: number; subtype: string; rect: number[]; contents: string }[]> = {
    0: [{ id: 7, subtype: "Text", rect: [1, 2, 3, 4], contents: "Check" }], 2: [{ id: 9, subtype: "Highlight", rect: [0, 0, 5, 5], contents: "" }],
  };
  const doc = {
    pageCount: vi.fn(() => ok({ pages: texts.length })),
    pageText: vi.fn((p: number) => { calls.push(["pageText", p]); return ok({ text: texts[p]! }); }),
    listAnnotations: vi.fn((p: number) => ok({ annots: annots[p] ?? [] })),
    addAnnotation: vi.fn((...a: unknown[]) => { calls.push(["addAnnotation", ...a]); return ok({ annot_id: 12 }); }),
    removeAnnotation: vi.fn((page: number, id: number) => { calls.push(["removeAnnotation", page, id]); annots[page] = (annots[page] ?? []).filter(x => x.id !== id); return ok({ ok: true }); }),
    undo: vi.fn(() => ok({})), redo: vi.fn(() => ok({})),
  };
  return { doc: doc as unknown as FolioOfficeDocument, calls };
}

describe("K-04 / K-18 page text", () => {
  it("yields pages from the reader's page, wrapping, and stops on abort", async () => {
    const { doc } = fake();
    const seen: number[] = [];
    for await (const p of folioSearchPages(doc, 2)) seen.push(p.page);
    expect(seen).toEqual([2, 3, 0, 1]);
    const ctrl = new AbortController();
    const partial: number[] = [];
    for await (const p of folioSearchPages(doc, 1, ctrl.signal)) { partial.push(p.page); if (partial.length === 2) ctrl.abort(); }
    expect(partial).toEqual([1, 2]);
    expect(await readFolioReadAloudBlocks(doc)).toEqual([{ block: 0, text: "Harbor one" }, { block: 2, text: "harbor two" }, { block: 3, text: "nothing" }]);
  });
});

describe("K-06 / K-07 annotations", () => {
  it("saves only the tools Folio can store", async () => {
    const { doc, calls } = fake();
    expect(FOLIO_ANNOTATION_TOOLS).toEqual(["select", "note", "highlight"]);
    expect(await addFolioAnnotation(doc, "note", 0, [10, 20, 30, 40], "Why?")).toBe(12);
    await addFolioAnnotation(doc, "highlight", 1, [0, 0, 1, 1], "");
    expect(calls).toEqual([["addAnnotation", 0, [10, 20, 30, 40], "Why?", "Text"], ["addAnnotation", 1, [0, 0, 1, 1], "", "Highlight"]]);
    await expect(addFolioAnnotation(doc, "strike", 0, [0, 0, 1, 1], "")).rejects.toThrow(/FOLIO_DEFERRED_OPS/);
  });

  it("lists annotations as one-comment threads and deletes through removeAnnotation", async () => {
    const { doc, calls } = fake();
    expect(await readFolioThreads(doc)).toEqual([
      { id: "0:7", page: 0, body: "Check", subtype: "Text", rect: [1, 2, 3, 4], replies: [] },
      { id: "2:9", page: 2, body: "", subtype: "Highlight", rect: [0, 0, 5, 5], replies: [] },
    ]);
    let latest = await bindFolioComments(doc, next => { latest = next; });
    expect(Object.keys(latest).sort()).toEqual(["onDelete", "threads"]);
    await latest.onDelete("2:9");
    expect(calls.at(-1)).toEqual(["removeAnnotation", 2, 9]);
    expect(latest.threads.map(t => t.id)).toEqual(["0:7"]);
    expect(() => folioThreadRef("2-9")).toThrow(RangeError);
  });

  it("names deferred ops that Folio's OPS does not have", () => {
    for (const op of Object.keys(FOLIO_DEFERRED_OPS)) expect(Object.values(OPS)).not.toContain(op);
  });
});
