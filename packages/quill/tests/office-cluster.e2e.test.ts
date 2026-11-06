import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { QuillDocument } from "../src/index";
import { bindQuillList, bindQuillRibbon, quillSelectionRuns, readQuillBlocks, readQuillOutline, readQuillReadAloudBlocks, type QuillRibbonBinding } from "../src/office-cluster";

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

describe("real Rust Quill engine behind the NYC-Tron document controls", () => {
  it("ribbon toggles, color and paragraph style round-trip through the engine", async () => {
    const doc = await QuillDocument.open(host);
    try {
      await doc.insertText({ block: 0, offset: 0 }, "Harbor Line expansion");
      await doc.splitBlock({ block: 0, offset: 21 });
      await doc.insertText({ block: 1, offset: 0 }, "The board approved three stations. Work starts in March.");
      const sel = { start: { block: 1, offset: 4 }, end: { block: 1, offset: 9 } };
      let latest: QuillRibbonBinding | undefined;
      const r = await bindQuillRibbon(doc, sel, next => { latest = next; });
      await r.onToggle("bold", true);
      expect(latest!.runs).toEqual([{ bold: true, italic: false, underline: false, strike: false }]);
      await latest!.onColorChange("#b3261e");
      expect(latest!.runs[0]).toMatchObject({ color: "#b3261e" });
      await latest!.onColorChange(undefined);
      expect(latest!.runs[0]!.color).toBeUndefined();
      const heading = await bindQuillRibbon(doc, { start: { block: 0, offset: 0 }, end: { block: 0, offset: 3 } }, () => {});
      await heading.onParagraphStyleChange("h1");
      const blocks = await readQuillBlocks(doc);
      expect(blocks[0]!.kind).toBe("h1");
      expect(quillSelectionRuns(blocks, { start: { block: 1, offset: 0 }, end: { block: 1, offset: 4 } })).toEqual([
        { bold: false, italic: false, underline: false, strike: false },
      ]);
    } finally {
      await doc.close();
    }
  });

  it("list on/off, outline pages and read-aloud blocks", async () => {
    const doc = await QuillDocument.open(host);
    try {
      await doc.insertText({ block: 0, offset: 0 }, "Stations");
      await doc.setBlockKind(0, "h2");
      await doc.insertBlock(1);
      await doc.insertText({ block: 1, offset: 0 }, "Pier Street");
      await doc.insertBlock(2);
      await doc.insertText({ block: 2, offset: 0 }, "Customs House");
      let list = await bindQuillList(doc, 1, 2, next => { list = next; });
      expect(list.kind).toBe("none");
      await list.onKindChange("bullet");
      expect(list.kind).toBe("bullet");
      await list.onKindChange("none");
      expect((await readQuillBlocks(doc)).map(b => b.kind)).toEqual(["h2", "para", "para"]);
      const outline = await readQuillOutline(doc, 400, 12);
      expect(outline.headings).toEqual([{ id: "b0", level: 2, text: "Stations", block: 0, page: 0 }]);
      expect(outline.pageCount).toBeGreaterThanOrEqual(1);
      expect(await readQuillReadAloudBlocks(doc)).toEqual([
        { block: 0, text: "Stations" }, { block: 1, text: "Pier Street" }, { block: 2, text: "Customs House" },
      ]);
    } finally {
      await doc.close();
    }
  });
});
