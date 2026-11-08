import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { base64ToBytes } from "@nitro-forge/ignition";
import { runExport, runImport } from "@nitro-forge/ignition/transfer";
import { TallyDocument } from "../src/index";
import { TALLY_EXPORT_FORMATS, TALLY_IMPORT_FORMATS } from "../src/transfer";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

/**
 * Hand-built two-sheet .xlsx (sharedStrings + inlineStr + formula + bool +
 * error + merge + activeTab), generated once with Python's zipfile — the
 * same minimal OOXML subset the engine admits.
 */
const FIXTURE_B64 =
  "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";
const FIXTURE = base64ToBytes(FIXTURE_B64);

describe("tally XLSX ops (real Rust via nf-cli)", () => {
  it("importXlsx replaces the workbook: sheets, values, formula, merge, activeTab", async () => {
    const t = await TallyDocument.open(host);
    await t.setCell("Z9", "old");
    const r = await t.importXlsx(FIXTURE);
    expect(r.data.sheets).toBe(2);
    expect(r.data.cells).toBeGreaterThanOrEqual(9);
    // Whole-workbook replace: the seeded cell is gone.
    expect((await t.getCell("Z9")).data.raw).toBe("");
    // activeTab=0 → "Sales" is active.
    expect((await t.workbook()).data.active).toBe(0);
    expect((await t.getCell("A1")).data.raw).toBe("item");       // shared string
    expect((await t.getCell("B1")).data.raw).toBe("qty");
    expect((await t.getCell("C1")).data.raw).toBe("total");      // inlineStr
    expect((await t.getCell("A2")).data.raw).toBe("apples & pears"); // entity + shared
    expect((await t.getCell("B2")).data.computed).toBe(3);
    expect((await t.getCell("C2")).data.raw).toBe("=B2*10");     // <f> → formula
    expect((await t.getCell("C2")).data.computed).toBe(30);      // cached <v> ignored, recomputed
    expect((await t.getCell("A3")).data.raw).toBe("bold note");  // rich-text runs concat
    expect((await t.getCell("B3")).data.raw).toBe("TRUE");       // t="b"
    expect((await t.getCell("C3")).data.raw).toBe("=#DIV/0!");   // t="e" → error literal
    expect((await t.getCell("C3")).data.computed).toBe("#DIV/0!");
    // Merge A5:B6 imported.
    const merges = (await t.handle.apply<{ merges: { from: string; to: string }[] }>("listMergedCells", {})).data.merges;
    expect(merges).toEqual([expect.objectContaining({ from: "A5", to: "B6" })]);
    // Second sheet.
    await t.setActive("Notes");
    expect((await t.getCell("A1")).data.raw).toBe("scratch");
    // Undo restores the previous workbook (active was Sheet1 with Z9).
    await t.setActive("Sales");
    expect(await t.undo()).toBe(true); // un-setActive Sales
    expect(await t.undo()).toBe(true); // un-setActive Notes
    expect(await t.undo()).toBe(true); // importXlsx Reset
    expect((await t.getCell("Z9")).data.raw).toBe("old");
    expect((await t.workbook()).data.sheets).toHaveLength(1);
    await t.close();
  });

  it("malformed xlsx rejects atomically and protected sheets reject import", async () => {
    const t = await TallyDocument.open(host);
    await t.setCell("A1", "keep");
    await expect(t.importXlsx(new TextEncoder().encode("not a zip"))).rejects.toThrow();
    expect((await t.getCell("A1")).data.raw).toBe("keep");
    await t.protectSheet(0, true);
    await expect(t.importXlsx(FIXTURE)).rejects.toThrow();
    expect((await t.getCell("A1")).data.raw).toBe("keep");
    await t.protectSheet(0, false);
    await t.close();
  });

  it("exportXlsx → importXlsx round-trips values, formulas, merges", async () => {
    const t = await TallyDocument.open(host);
    await t.setCell("A1", "item");
    await t.setCell("B1", "3");
    await t.setCell("A2", "=B1*2");
    await t.setCell("B2", "note & <tag>");
    await t.setFormat(["A1"], { bold: true, fill: "#FF0000" });
    await t.handle.apply("mergeCells", { range: { from: "D1", to: "E2" } });
    const bytes = await t.exportXlsx();
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes[0]).toBe(0x50); // 'P' — PK zip magic
    expect(bytes[1]).toBe(0x4b);

    const t2 = await TallyDocument.open(host);
    await t2.importXlsx(bytes);
    expect((await t2.getCell("A1")).data.raw).toBe("item");
    expect((await t2.getCell("A2")).data.raw).toBe("=B1*2");
    expect((await t2.getCell("A2")).data.computed).toBe(6);
    expect((await t2.getCell("B2")).data.raw).toBe("note & <tag>");
    const merges = (await t2.handle.apply<{ merges: { from: string; to: string }[] }>("listMergedCells", {})).data.merges;
    expect(merges).toEqual([expect.objectContaining({ from: "D1", to: "E2" })]);
    await t.close();
    await t2.close();
  });

  it("transfer formats: xlsx import/export run through runImport/runExport", async () => {
    const t = await TallyDocument.open(host);
    await runImport(t.handle, TALLY_IMPORT_FORMATS, "xlsx", FIXTURE);
    expect((await t.getCell("A1")).data.raw).toBe("item");
    await t.setCell("C1", "made-in-tally");
    const out = await runExport(t.handle, TALLY_EXPORT_FORMATS, {
      formatId: "xlsx",
      filename: "book",
    });
    expect(out.filename).toBe("book.xlsx");
    expect(out.bytes[0]).toBe(0x50);

    const t2 = await TallyDocument.open(host);
    await runImport(t2.handle, TALLY_IMPORT_FORMATS, "xlsx", out.bytes);
    expect((await t2.getCell("C1")).data.raw).toBe("made-in-tally");
    expect((await t2.workbook()).data.sheets.map((s) => s.name)).toEqual(["Sales", "Notes"]);
    await t.close();
    await t2.close();
  });
});
