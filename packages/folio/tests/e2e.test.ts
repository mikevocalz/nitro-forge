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
