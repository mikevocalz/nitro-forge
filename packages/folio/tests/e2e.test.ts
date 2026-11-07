import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { FolioDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("folio engine e2e (real Rust via nf-cli)", () => {
  it("creates a real PDF, annotates it, saves valid bytes", async () => {
    const doc = await FolioDocument.create(host, 2);
    expect((await doc.pageCount()).data.pages).toBe(2);
    const annot = await doc.addAnnotation(0, [100, 700, 200, 20], "remember this");
    expect(annot.data.annot_id).toBeGreaterThan(0);
    const { bytes, size } = await doc.savePdf();
    expect(size).toBeGreaterThan(100);
    expect(bytes.subarray(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
    await doc.close();

    // real round-trip: reopen the saved PDF bytes as a new document
    const pdf = await FolioDocument.openPdf(host, bytes);
    expect((await pdf.pageCount()).data.pages).toBe(2);
    const annots = await pdf.listAnnotations(0);
    expect(annots.data.annots.length).toBeGreaterThanOrEqual(1);
    expect(annots.data.annots[0]!.contents).toBe("remember this");
    await pdf.close();
  });

  it("rotates pages and lists annotations", async () => {
    const doc = await FolioDocument.create(host, 1);
    await doc.rotatePage(0, 90);
    await expect(doc.rotatePage(0, 45)).rejects.toBeInstanceOf(EngineError);
    const list = await doc.listAnnotations(0);
    expect(list.data.annots).toEqual([]);
    await doc.close();
  });

  it("rejects corrupt PDF input", async () => {
    await expect(
      FolioDocument.openPdf(host, new TextEncoder().encode("not a pdf")),
    ).rejects.toBeInstanceOf(EngineError);
  });

  it("encrypts, reports state, and decrypts through save/reopen", async () => {
    const doc = await FolioDocument.create(host, 1);
    await doc.encrypt({ password: "user-pw", permissions: ["print"] });
    expect((await doc.info()).data.encrypted).toBe(true);
    expect(await doc.isEncrypted()).toBe(true);

    const { bytes } = await doc.savePdf();
    const locked = await FolioDocument.openPdf(host, bytes);
    expect((await locked.info()).data.encrypted).toBe(true);
    await expect(locked.decrypt("wrong")).rejects.toBeInstanceOf(EngineError);
    expect((await locked.info()).data.encrypted).toBe(true);
    await locked.decrypt("user-pw");
    expect((await locked.info()).data.encrypted).toBe(false);
    expect((await locked.pageCount()).data.pages).toBe(1);
    await locked.close();
    await doc.close();
  });

  it("adds ink and link annotations that survive save/reopen and undo", async () => {
    const doc = await FolioDocument.create(host, 1);
    const ink = await doc.addInkAnnotation(0, [[[72, 600], [90, 580], [110, 610]], [[200, 200], [220, 220]]], {
      color: [1, 0, 0], width: 2, opacity: 0.8, contents: "doodle",
    });
    const link = await doc.addLinkAnnotation(0, [72, 700, 150, 20], "https://example.com/spec", { contents: "spec" });
    expect(ink.data.annot_id).toBeGreaterThan(0);
    expect(link.data.annot_id).toBeGreaterThan(0);

    const annots = (await doc.listAnnotations(0)).data.annots;
    const inkRow = annots.find(a => a.id === ink.data.annot_id)!;
    const linkRow = annots.find(a => a.id === link.data.annot_id)!;
    expect(inkRow.subtype).toBe("Ink");
    expect(inkRow.contents).toBe("doodle");
    expect(linkRow.subtype).toBe("Link");
    expect(linkRow.uri).toBe("https://example.com/spec");
    expect(linkRow.rect).toEqual([72, 700, 150, 20]);

    // bounds and URI validation reject without mutating
    await expect(doc.addInkAnnotation(0, [])).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addInkAnnotation(0, Array.from({ length: 65 }, () => [[0, 0], [1, 1]] as [number, number][]))).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addInkAnnotation(0, [[[0, 0], [1e7, 1]]])).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addLinkAnnotation(0, [1, 2, 3, 4], "not a uri")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addLinkAnnotation(0, [1, 2, 3, 4], "")).rejects.toBeInstanceOf(EngineError);
    expect((await doc.listAnnotations(0)).data.annots).toHaveLength(2);

    // undo removes the link only; redo restores it
    await doc.undo();
    expect((await doc.listAnnotations(0)).data.annots.map(a => a.subtype)).toEqual(["Ink"]);
    await doc.redo();
    expect((await doc.listAnnotations(0)).data.annots.map(a => a.subtype).sort()).toEqual(["Ink", "Link"]);

    const { bytes } = await doc.savePdf();
    await doc.close();
    const re = await FolioDocument.openPdf(host, bytes);
    const rows = (await re.listAnnotations(0)).data.annots;
    expect(rows.find(a => a.subtype === "Ink")?.contents).toBe("doodle");
    expect(rows.find(a => a.subtype === "Link")?.uri).toBe("https://example.com/spec");
    await re.close();
  });

  it("moves, duplicates, inserts and deletes pages through save/reopen", async () => {
    const doc = await FolioDocument.create(host, 3);
    await doc.rotatePage(0, 90);
    await doc.rotatePage(2, 180);
    const annot = await doc.addAnnotation(0, [10, 10, 20, 20], "page zero note", "Text");

    // listPageInfo reflects order, rotation and annotations.
    let info = (await doc.listPageInfo()).data.pages;
    expect(info.map(p => p.rotate)).toEqual([90, 0, 180]);
    expect(info[0]!.annots_count).toBe(1);
    expect(info[0]!.mediabox).toEqual([0, 0, 612, 792]);

    // Reorder: page 0 lands at index 2.
    await doc.movePage(0, 2);
    info = (await doc.listPageInfo()).data.pages;
    expect(info.map(p => p.rotate)).toEqual([0, 180, 90]);
    expect(info[2]!.annots_count).toBe(1);

    // Duplicate page 2 (the annotated original): the copy lands at index 3.
    const dup = await doc.duplicatePage(2);
    expect(dup.data.page).toBe(3);
    expect((await doc.pageCount()).data.pages).toBe(4);
    info = (await doc.listPageInfo()).data.pages;
    expect(info.map(p => p.rotate)).toEqual([0, 180, 90, 90]);
    expect(info[3]!.annots_count).toBe(1);

    // The copy's annotation is a distinct object: editing it leaves the source alone.
    const copyAnnots = (await doc.listAnnotations(3)).data.annots;
    expect(copyAnnots).toHaveLength(1);
    expect(copyAnnots[0]!.id).not.toBe(annot.data.annot_id);
    await doc.setAnnotationContents(3, copyAnnots[0]!.id, "copied note");
    expect((await doc.listAnnotations(2)).data.annots[0]!.contents).toBe("page zero note");

    // Insert blank at the front, then delete the original annotated page (index 2).
    await doc.insertBlankPage(0);
    expect((await doc.pageCount()).data.pages).toBe(5);
    await doc.deletePage(3); // annotated original shifted +1 by the insert
    expect((await doc.pageCount()).data.pages).toBe(4);
    const after = (await doc.listPageInfo()).data.pages;
    expect(after.map(p => p.rotate)).toEqual([0, 0, 180, 90]);
    expect(after[0]!.has_contents).toBe(false);
    expect(after[3]!.annots_count).toBe(1); // the copy survives

    // Bounds and the last-page floor reject without mutating.
    await expect(doc.movePage(0, 9)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.deletePage(9)).rejects.toBeInstanceOf(EngineError);
    while ((await doc.pageCount()).data.pages > 1) {
      await doc.deletePage(0);
    }
    await expect(doc.deletePage(0)).rejects.toBeInstanceOf(EngineError);
    expect((await doc.pageCount()).data.pages).toBe(1);

    // Everything survives a real save → open round-trip.
    const { bytes } = await doc.savePdf();
    await doc.close();
    const re = await FolioDocument.openPdf(host, bytes);
    expect((await re.pageCount()).data.pages).toBe(1);
    const reInfo = (await re.listPageInfo()).data.pages;
    expect(reInfo[0]!.mediabox).toEqual([0, 0, 612, 792]);
    await re.close();
  });

  it("snapshot/save/reopen preserves annotations", async () => {
    const doc = await FolioDocument.create(host, 1);
    await doc.addAnnotation(0, [0, 0, 50, 50], "note", "Text");
    const bytes = await doc.save();
    await doc.close();
    const re = await FolioDocument.openSnapshot(host, bytes);
    expect((await re.listAnnotations(0)).data.annots[0]!.contents).toBe("note");
    await re.close();
  });
});
