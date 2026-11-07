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
    listCommentThreads: vi.fn((p: number, reviewAuthor?: string) => ok({ threads: (annots[p] ?? []).map(a => ({ ...a, replies: [], ...(reviewAuthor ? { resolved: false } : {}) })) })),
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
    expect(FOLIO_ANNOTATION_TOOLS).toEqual(["select", "note", "highlight", "underline", "strike", "rectangle", "ellipse"]);
    expect(await addFolioAnnotation(doc, "note", 0, [10, 20, 30, 40], "Why?")).toBe(12);
    await addFolioAnnotation(doc, "highlight", 1, [0, 0, 1, 1], "");
    expect(calls).toEqual([["addAnnotation", 0, [10, 20, 30, 40], "Why?", "Text"], ["addAnnotation", 1, [0, 0, 1, 1], "", "Highlight"]]);
    await addFolioAnnotation(doc, "underline", 0, [0,0,2,3], "line");
    await addFolioAnnotation(doc, "strike", 0, [0,0,2,3], "removed");
    expect(calls.slice(-2)).toEqual([["addAnnotation",0,[0,0,2,3],"line","Underline"],["addAnnotation",0,[0,0,2,3],"removed","StrikeOut"]]);
    await addFolioAnnotation(doc, "rectangle", 0, [1,2,3,4], "box");
    await addFolioAnnotation(doc, "ellipse", 0, [1,2,3,4], "oval");
    expect(calls.slice(-2)).toEqual([["addAnnotation",0,[1,2,3,4],"box","Square"],["addAnnotation",0,[1,2,3,4],"oval","Circle"]]);
    await expect(addFolioAnnotation(doc, "ink", 0, [0, 0, 1, 1], "")).rejects.toThrow(/FOLIO_DEFERRED_OPS/);
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

it("admits actual reply/review callbacks only with explicit metadata and host write admission", async () => {
  const { doc } = fake();
  const metadata = vi.fn(async () => ({ author: "A", modified: "D:20261107120100Z" }));
  const reply = vi.fn(async () => ok({ annot_id: 90 }));
  const review = vi.fn(async () => ok({ ok: true }));
  const commit = vi.fn(async (write: () => Promise<unknown>) => write());
  const current = { value: true };
  const document = { ...doc, addAnnotationReply: reply, setAnnotationReview: review } as unknown as FolioOfficeDocument;
  const changes = vi.fn();
  const binding = await bindFolioComments(document, changes, { reviewAuthor: "A", metadata, isCurrent: () => current.value, commit });
  await binding.onReply!("0:7", "Reply");
  expect(reply).toHaveBeenCalledWith(0, 7, "Reply", { author: "A", modified: "D:20261107120100Z" });
  await binding.onResolvedChange!("0:7", true);
  expect(review).toHaveBeenCalledWith(0, 7, true, { author: "A", modified: "D:20261107120100Z" });
  expect(commit).toHaveBeenCalledTimes(2); expect(changes).toHaveBeenCalledTimes(2);
  await expect(binding.onReply!("0:7", "Reply", ["unsupported"])).rejects.toThrow("mentions");
  metadata.mockResolvedValueOnce({ author: "Other", modified: "D:20261107120100Z" });
  await expect(binding.onResolvedChange!("0:7", false)).rejects.toThrow("author changed");
  metadata.mockRejectedValueOnce(new Error("provider failed"));
  await expect(binding.onReply!("0:7", "Reply")).rejects.toThrow("provider failed");
  current.value = false;
  await expect(binding.onReply!("0:7", "Reply")).rejects.toThrow("document changed");
  expect(reply).toHaveBeenCalledTimes(1); expect(review).toHaveBeenCalledTimes(1);
});

it("rejects stale async metadata and thread reads before invoking document writes", async () => {
  const { doc } = fake();
  let finish!: (value: { author: string; modified: string }) => void;
  const pending = new Promise<{ author: string; modified: string }>(resolve => { finish = resolve; });
  let current = true;
  const reply = vi.fn(async () => ok({ annot_id: 99 }));
  const document = { ...doc, addAnnotationReply: reply } as unknown as FolioOfficeDocument;
  const binding = await bindFolioComments(document, () => {}, { reviewAuthor: "A", metadata: () => pending, isCurrent: () => current, commit: async write => write() });
  const write = binding.onReply!("0:7", "Body"); current = false;
  finish({ author: "A", modified: "D:20261107120100Z" });
  await expect(write).rejects.toThrow("document changed"); expect(reply).not.toHaveBeenCalled();
});

it("rereads thread authority inside the host write gate and rejects queued generation changes", async () => {
  const { doc } = fake();
  const reply = vi.fn(async () => ok({ annot_id: 99 }));
  const document = { ...doc, addAnnotationReply: reply } as unknown as FolioOfficeDocument;
  const metadata = async () => {
    vi.mocked(doc.listCommentThreads).mockImplementation(async () => ({ data: { threads: [{ id: 7, contents: "Changed", subtype: "Text", rect: [1, 2, 3, 4], replies: [] }] }, events: [] }));
    return { author: "A", modified: "D:20261107120100Z" };
  };
  const binding = await bindFolioComments(document, () => {}, { reviewAuthor: "A", metadata, isCurrent: () => true, commit: async write => write() });
  await expect(binding.onReply!("0:7", "Body")).rejects.toThrow("thread changed"); expect(reply).not.toHaveBeenCalled();
  let current = true;
  const queued = await bindFolioComments(document, () => {}, { reviewAuthor: "A", metadata: async () => ({ author: "A", modified: "D:20261107120100Z" }), isCurrent: () => current, commit: async write => { current = false; return write(); } });
  await expect(queued.onResolvedChange!("0:7", true)).rejects.toThrow("document changed");
});
