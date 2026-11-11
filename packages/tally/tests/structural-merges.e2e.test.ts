import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("tally structural edits + merged cells (real Rust via nf-cli)", () => {
  it("insert/delete rows remap cells, formats and formula refs", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setRange("A1", [
        ["1", "=A1*2", "x"],
        ["2", "=A2*2", "y"],
        ["3", "=A3*2", "z"],
      ]);
      await doc.setFormat({ from: "B2", to: "B2" }, { bold: true });
      await doc.setCell("E1", "=A2"); // references a row the delete will kill

      // Insert one row before row 2: rows 2-3 shift down, refs rewrite.
      const ins = await doc.insertRows({ from: 2, to: 2 });
      expect(ins.data.changed).toBe(1);
      expect((await doc.getCell("A3")).data.raw).toBe("2");
      expect((await doc.getCell("B3")).data.raw).toBe("=A3*2");
      expect((await doc.getCell("B1")).data.raw).toBe("=A1*2"); // above band, untouched
      expect((await doc.getCell("E1")).data.raw).toBe("=A3"); // A2 shifted to A3
      expect((await doc.getCell("B3")).data.format?.bold).toBe(true);

      // Undo restores exactly; redo reapplies.
      expect(await doc.undo()).toBe(true);
      expect((await doc.getCell("A2")).data.raw).toBe("2");
      expect(await doc.redo()).toBe(true);
      expect((await doc.getCell("A3")).data.raw).toBe("2");

      // Delete rows 2-3 (empty inserted row + old row 2): old row 3 moves
      // up to row 2; E1's reference dies with its row.
      await doc.deleteRows({ from: 2, to: 3 });
      expect((await doc.getCell("A2")).data.raw).toBe("3");
      expect((await doc.getCell("B2")).data.raw).toBe("=A2*2");
      expect((await doc.getCell("E1")).data.raw).toBe("=#REF!");
    } finally {
      await doc.close();
    }
  });

  it("column ops mirror row ops", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("C1", "=A1+B1");
      await doc.setCell("D1", "42");
      await doc.insertCols({ from: 1, to: 1 }); // insert col A
      expect((await doc.getCell("D1")).data.raw).toBe("=B1+C1");
      expect((await doc.getCell("E1")).data.raw).toBe("42");
      await doc.deleteCols({ from: 2, to: 2 }); // delete col B (formula's home)
      expect((await doc.getCell("C1")).data.raw).toBe("=#REF!+B1");
    } finally {
      await doc.close();
    }
  });

  it("metadata tables remap; entries covered by a delete drop", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.defineName("Zone", "C3:C7");
      await doc.setValidation({ from: "C1", to: "C9" }, { kind: "number", min: 0 });
      await doc.addComment({ cell: "C4" }, "note");

      // Insert two rows inside every range: ranges expand, the name (fully
      // inside the band) shifts, the comment anchor shifts.
      await doc.insertRows({ from: 2, to: 3 });
      const names = await doc.listNames();
      expect(names.data.names[0]!.refers_to).toBe("C5:C9");
      const comments = await doc.listComments();
      expect(comments.data.comments[0]!.anchor).toBe("C6");

      // Delete the comment's row: the comment drops with it.
      await doc.deleteRows({ from: 6, to: 6 });
      expect((await doc.listComments()).data.comments).toEqual([]);
      // The validation range (C1:C11 after the insert) loses row 6 -> C1:C10.
      const vals = await doc.describe<{ validations: { range: string }[] }>();
      expect(vals.data?.validations[0]?.range).toBe("C1:C10");
    } finally {
      await doc.close();
    }
  });

  it("mergeCells/unmergeCells/listMergedCells round-trip with remap", async () => {
    const doc = await TallyDocument.open(host);
    try {
      const merged = await doc.mergeCells({ from: "b2", to: "d4" });
      expect(merged.data.range).toBe("B2:D4");
      // Idempotent re-merge is eventless.
      const again = await doc.mergeCells({ from: "B2", to: "D4" });
      expect(again.events).toEqual([]);
      // Covered cell reports merged_into; anchor does not; contents live.
      await doc.setCell("C3", "7");
      expect((await doc.getCell("C3")).data.merged_into).toBe("B2");
      expect((await doc.getCell("C3")).data.computed).toBe(7);
      expect((await doc.getCell("B2")).data.merged_into).toBeUndefined();
      // listMergedCells.
      const list = await doc.listMergedCells();
      expect(list.data.merges).toEqual([
        { sheet: "Sheet1", sheet_id: expect.any(Number), from: "B2", to: "D4" },
      ]);
      // Insert a row above: merge shifts to B3:D5.
      await doc.insertRows({ from: 1, to: 1 });
      const shifted = await doc.listMergedCells();
      expect(shifted.data.merges[0]!).toMatchObject({ from: "B3", to: "D5" });
      // Undo the insert restores B2:D4.
      await doc.undo();
      expect((await doc.listMergedCells()).data.merges[0]!).toMatchObject({ from: "B2", to: "D4" });
      // Unmerge by single covered cell; cleared:0 eventless.
      const un = await doc.unmergeCells({ from: "C3", to: "C3" });
      expect(un.data.cleared).toBe(1);
      const none = await doc.unmergeCells({ from: "C3", to: "C3" });
      expect(none.data.cleared).toBe(0);
      expect(none.events).toEqual([]);
      // Overlap rejects atomically.
      await doc.mergeCells({ from: "A1", to: "B2" });
      await expect(doc.mergeCells({ from: "B2", to: "C3" })).rejects.toThrow();
      const still = await doc.listMergedCells();
      expect(still.data.merges).toHaveLength(1);
      expect(still.data.merges[0]!).toMatchObject({ from: "A1", to: "B2" });
    } finally {
      await doc.close();
    }
  });

  it("snapshot round-trips merges at schema 8", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.mergeCells({ from: "A1", to: "C1" });
      const bytes = await doc.save();
      const reopened = await TallyDocument.openSnapshot(host, bytes);
      try {
        const list = await reopened.listMergedCells();
        expect(list.data.merges[0]!).toMatchObject({ from: "A1", to: "C1" });
        expect((await reopened.getCell("B1")).data.merged_into).toBe("A1");
      } finally {
        await reopened.close();
      }
    } finally {
      await doc.close();
    }
  });

  it("protected sheets reject structural and merge ops", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("A1", "1");
      await doc.protectSheet(0, true);
      await expect(doc.insertRows({ from: 1, to: 1 })).rejects.toThrow();
      await expect(doc.deleteCols({ from: 1, to: 1 })).rejects.toThrow();
      await expect(doc.mergeCells({ from: "A1", to: "B1" })).rejects.toThrow();
      expect((await doc.getCell("A1")).data.raw).toBe("1"); // unchanged
      // listMergedCells stays a read.
      expect((await doc.listMergedCells()).data.merges).toEqual([]);
    } finally {
      await doc.close();
    }
  });

  it("bounds and atomicity: bad bands reject without mutation", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("A1", "keep");
      const before = await doc.getCell("A1");
      await expect(doc.deleteRows({ from: 1, to: 1048576 })).rejects.toThrow();
      await expect(doc.deleteCols({ from: 1, to: 16384 })).rejects.toThrow();
      await expect(doc.insertRows({ from: 1048576, to: 1048577 })).rejects.toThrow();
      await expect(doc.insertRows({ from: 5, to: 2 })).rejects.toThrow();
      await expect(doc.mergeCells({ from: "A1", to: "A1" })).rejects.toThrow(); // single cell
      expect((await doc.getCell("A1")).data).toEqual(before.data);
      // Eventless no-op insert far below content still succeeds.
      const noop = await doc.insertRows({ from: 500000, to: 500001 });
      expect(noop.events).toEqual([]);
    } finally {
      await doc.close();
    }
  });
});
