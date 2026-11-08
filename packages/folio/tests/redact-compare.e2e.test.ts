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

describe("folio redactRect + comparePdf e2e (real Rust via nf-cli)", () => {
  it("redactRect removes intersecting annotations, reports retained, and undoes", async () => {
    const doc = await FolioDocument.create(host, 1);
    const inside = await doc.addAnnotation(0, [100, 100, 50, 50], "inside", "Text");
    const outside = await doc.addAnnotation(0, [400, 400, 50, 50], "outside");

    const report = await doc.redactRect(0, [90, 90, 120, 120]);
    expect(report.data.ok).toBe(true);
    expect(report.data.removed.annotations).toBe(1);
    expect(report.data.removed.annotation_ids).toEqual([inside.data.annot_id]);
    expect(report.data.retained.annotations).toBe(1);
    expect(report.data.retained.annotation_ids).toEqual([outside.data.annot_id]);
    expect(report.data.content_note).toContain("never removed");

    const annots = (await doc.listAnnotations(0)).data.annots;
    expect(annots.map(a => a.id)).toEqual([outside.data.annot_id]);

    // Undo restores the exact pre-redaction document.
    expect(await doc.undo()).toBe(true);
    expect((await doc.listAnnotations(0)).data.annots.length).toBe(2);
    await doc.close();
  });

  it("redactRect is an eventless no-op when nothing intersects", async () => {
    const doc = await FolioDocument.create(host, 1);
    const report = await doc.redactRect(0, [0, 0, 1, 1]);
    expect(report.data.removed.annotations).toBe(0);
    expect(report.data.retained.annotations).toBe(0);
    expect(report.events).toEqual([]);
    await doc.close();
  });

  it("redactRect rejects invalid rects, bad pages and encrypted documents", async () => {
    const doc = await FolioDocument.create(host, 1);
    await expect(doc.redactRect(0, [0, 0, -5, 10])).rejects.toBeInstanceOf(EngineError);
    await expect(doc.redactRect(0, [0, 0, 0, 10])).rejects.toBeInstanceOf(EngineError);
    // Malformed length reaches the engine through an untyped caller.
    await expect(
      doc.redactRect(0, [0, 0, 1] as unknown as [number, number, number, number]),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(doc.redactRect(9, [0, 0, 10, 10])).rejects.toBeInstanceOf(EngineError);

    await doc.encrypt({ password: "pw" });
    await expect(doc.redactRect(0, [0, 0, 10, 10])).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("comparePdf reports structural identity and annotation diffs", async () => {
    const a = await FolioDocument.create(host, 1);
    const b = await FolioDocument.create(host, 1);
    const { bytes } = await b.savePdf();

    const same = await a.comparePdf(bytes);
    expect(same.data.structural_identical).toBe(true);
    expect(same.data.pages).toEqual({ current: 1, other: 1 });
    expect(same.events).toEqual([]);

    await b.addAnnotation(0, [10, 10, 30, 30], "extra", "Square");
    const { bytes: bytes2 } = await b.savePdf();
    const diff = await a.comparePdf(bytes2);
    expect(diff.data.structural_identical).toBe(false);
    expect(diff.data.differences.annotations_added_total).toBe(1);
    expect(diff.data.differences.annotations_added[0]).toMatchObject({
      page: 0,
      subtype: "Square",
    });
    await a.close();
    await b.close();
  });

  it("comparePdf detects page-count and outline differences", async () => {
    const a = await FolioDocument.create(host, 1);
    const b = await FolioDocument.create(host, 2);
    await b.addBookmark("Chapter", 1);
    const { bytes } = await b.savePdf();
    const diff = await a.comparePdf(bytes);
    expect(diff.data.structural_identical).toBe(false);
    expect(diff.data.differences.only_in_other).toEqual([1]);
    expect(diff.data.differences.outlines_added_total).toBe(1);
    await a.close();
    await b.close();
  });

  it("comparePdf rejects corrupt input and encrypted documents", async () => {
    const doc = await FolioDocument.create(host, 1);
    await expect(doc.comparePdf(new TextEncoder().encode("not a pdf"))).rejects.toBeInstanceOf(EngineError);
    await doc.encrypt({ password: "pw" });
    const { bytes } = await doc.savePdf();
    await expect(doc.comparePdf(bytes)).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });
});
