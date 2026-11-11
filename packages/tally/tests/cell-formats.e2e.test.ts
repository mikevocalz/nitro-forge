import { afterAll, beforeAll, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "../src/index";
let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

it("setFormat/clearFormat patch, expose, undo and persist through snapshots", async () => {
  const doc = await TallyDocument.open(host);
  try {
    await doc.setCell("A1", "42");
    const applied = await doc.setFormat({ from: "A1", to: "B2" }, {
      number_format: "currency",
      bold: true,
    });
    expect(applied.data?.changed).toBe(4);
    // Format metadata is exposed; the evaluated value is untouched.
    const cell = await doc.getCell("A1");
    expect(cell.data?.format).toEqual({ number_format: "currency", bold: true });
    expect(cell.data?.computed).toBe(42);
    const range = await doc.getRange("A1", "C1");
    expect(range.data?.cells[0]?.[1]?.format).toEqual({ number_format: "currency", bold: true });
    expect(range.data?.cells[0]?.[2]?.format).toBeUndefined();

    // Patch merge: null clears an attribute, absent keys survive.
    await doc.setFormat(["A1"], { bold: null, italic: true });
    expect((await doc.getCell("A1")).data?.format).toEqual({
      number_format: "currency",
      italic: true,
    });

    // Formats survive a snapshot round-trip (wrapped payload).
    const saved = await doc.save();
    const restored = await TallyDocument.openSnapshot(host, saved);
    try {
      expect((await restored.getCell("A1")).data?.format).toEqual({
        number_format: "currency",
        italic: true,
      });
      expect((await restored.getCell("A1")).data?.computed).toBe(42);
    } finally {
      await restored.close();
    }

    // clearFormat removes formats but keeps contents.
    const cleared = await doc.clearFormat({ from: "A1", to: "B2" });
    expect(cleared.data?.changed).toBe(4);
    expect((await doc.getCell("A1")).data?.format).toBeUndefined();
    expect((await doc.getCell("A1")).data?.raw).toBe("42");

    // Undo restores the pre-clear formats; redo re-clears.
    await doc.undo();
    expect((await doc.getCell("B2")).data?.format).toEqual({
      number_format: "currency",
      bold: true,
    });
    await doc.redo();
    expect((await doc.getCell("B2")).data?.format).toBeUndefined();
  } finally {
    await doc.close();
  }
});

it("rejects invalid formats and targets atomically without losing redo", async () => {
  const doc = await TallyDocument.open(host);
  try {
    await doc.setCell("A1", "before");
    await doc.setCell("A1", "after");
    await doc.undo();
    const before = await doc.save();
    await expect(
      doc.setFormat({ from: "A1", to: "A1" }, { fill: "red" }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      doc.setFormat({ from: "A1", to: "A1" }, { bold: "yes" as never }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      doc.setFormat({ from: "A1", to: "A1048577" }, { bold: true }),
    ).rejects.toMatchObject({ code: "out_of_bounds" });
    await expect(
      doc.clearFormat(["XFE1"]),
    ).rejects.toMatchObject({ code: "out_of_bounds" });
    expect(await doc.save()).toEqual(before);
    await doc.redo();
    expect((await doc.getCell("A1")).data?.raw).toBe("after");
  } finally {
    await doc.close();
  }
});
