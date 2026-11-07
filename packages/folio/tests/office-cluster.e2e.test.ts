import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { FolioDocument } from "../src/index";
import { addFolioAnnotation, bindFolioComments, bindFolioHistory, folioSearchPages, readFolioReadAloudBlocks, readFolioThreads } from "../src/office-cluster";

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

/** A small valid PDF: one Helvetica page per string, each shown with Tj, xref offsets computed. */
function textPdf(pages: readonly string[]): Uint8Array {
  const objs: string[] = [];
  const n = pages.length;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("real Rust Folio engine behind the NYC-Tron PDF controls", () => {
  it("search order, read-aloud pages, annotations as threads, delete, undo", async () => {
    const doc = await FolioDocument.openPdf(host, textPdf(["Harbor Line expansion", "Ridership grew on the harbor line.", "Budget summary."]));
    try {
      const order: [number, string][] = [];
      for await (const p of folioSearchPages(doc, 1)) order.push([p.page, p.text]);
      expect(order.map(o => o[0])).toEqual([1, 2, 0]);
      expect(order[0]![1]).toContain("harbor line");
      expect((await readFolioReadAloudBlocks(doc)).map(b => b.block)).toEqual([0, 1, 2]);

      const id = await addFolioAnnotation(doc, "note", 2, [72, 700, 20, 20], "Where is the 60% from?");
      await addFolioAnnotation(doc, "highlight", 0, [72, 715, 150, 14], "");
      const inkId = await addFolioAnnotation(doc, "ink", 0, [0, 0, 1, 1], "", {
        paths: [[[72, 600], [90, 580], [110, 610]]], color: [0, 0, 0], width: 1.5,
      });
      const annots = (await doc.listAnnotations(0)).data.annots;
      expect(annots.find(a => a.id === inkId)?.subtype).toBe("Ink");
      const threads = await readFolioThreads(doc);
      expect(threads.map(t => [t.page, t.subtype, t.body])).toEqual([[0, "Highlight", ""], [2, "Text", "Where is the 60% from?"]]);
      expect(threads[1]!.id).toBe(`2:${id}`);
      expect(threads[1]!.rect).toEqual([72, 700, 20, 20]);

      let comments = await bindFolioComments(doc, next => { comments = next; });
      await comments.onDelete(`2:${id}`);
      expect(comments.threads.map(t => t.page)).toEqual([0]);
      let refreshed = 0;
      const history = bindFolioHistory(doc, () => { refreshed++; });
      await history.onUndo();
      expect((await readFolioThreads(doc)).map(t => t.page)).toEqual([0, 2]);
      await history.onRedo();
      expect((await readFolioThreads(doc)).map(t => t.page)).toEqual([0]);
      expect(refreshed).toBe(2);
    } finally {
      await doc.close();
    }
  });
});
