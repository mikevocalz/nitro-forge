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

describe("tally table objects (real Rust via nf-cli)", () => {
  it("stores tables, patches, lists, describes and removes them", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setRange("A1", [["region", "qty"], ["east", "2"]]);
      const created = await doc.insertTable(
        {
          name: "Sales",
          range: { from: "A1", to: "B5" },
          show_totals: true,
          banded_columns: true,
        },
        "Sheet1",
      );
      const table = created.data.table;
      expect(table.id).toBe(1);
      expect(table.sheet).toBe("Sheet1");
      expect(table.name).toBe("Sales");
      expect(table.range).toBe("A1:B5");
      // Defaults + provided flags round-trip.
      expect(table.show_headers).toBe(true);
      expect(table.show_totals).toBe(true);
      expect(table.banded_rows).toBe(true);
      expect(table.banded_columns).toBe(true);

      // describeTable returns the same spec; storage only — no cells written.
      const described = await doc.describeTable(1);
      expect(described.data.table).toEqual(table);
      const wb = await doc.workbook();
      expect(wb.data.sheets[0]?.cell_count).toBe(4);

      // Partial patch: rename, shrink range, flip flags.
      const patched = await doc.updateTable(1, {
        name: "Revenue",
        range: { from: "A1", to: "B4" },
        show_headers: false,
        banded_columns: false,
      });
      expect(patched.data.table.name).toBe("Revenue");
      expect(patched.data.table.range).toBe("A1:B4");
      expect(patched.data.table.show_headers).toBe(false);
      expect(patched.data.table.show_totals).toBe(true);
      expect(patched.data.table.banded_columns).toBe(false);

      // Equal patch is eventless.
      const noop = await doc.updateTable(1, { name: "Revenue" });
      expect(noop.events).toEqual([]);

      // Undo restores the pre-patch spec, redo re-applies it.
      expect(await doc.undo()).toBe(true);
      expect((await doc.describeTable(1)).data.table.name).toBe("Sales");
      expect(await doc.redo()).toBe(true);
      expect((await doc.describeTable(1)).data.table.name).toBe("Revenue");

      // listTables filters by bound sheet.
      await doc.addSheet("Other");
      await doc.insertTable(
        { range: { from: "C1", to: "D3" } },
        "Other",
      );
      expect((await doc.listTables()).data.tables).toHaveLength(2);
      const onOther = await doc.listTables("Other");
      expect(onOther.data.tables).toHaveLength(1);
      expect(onOther.data.tables[0]?.sheet).toBe("Other");

      // Snapshot round-trip preserves specs (schema:10).
      const bytes = await doc.save();
      const reopened = await TallyDocument.openSnapshot(host, bytes);
      try {
        const tables = await reopened.listTables();
        expect(tables.data.tables).toHaveLength(2);
        expect(tables.data.tables[0]?.name).toBe("Revenue");
      } finally {
        await reopened.close();
      }

      // removeSheet cascade: removing a sheet drops its tables.
      await doc.removeSheet("Other");
      expect((await doc.listTables()).data.tables).toHaveLength(1);
      expect(await doc.undo()).toBe(true);
      expect((await doc.listTables()).data.tables).toHaveLength(2);
      expect(await doc.redo()).toBe(true);
      expect((await doc.listTables()).data.tables).toHaveLength(1);

      const removed = await doc.removeTable(1);
      expect(removed.data.ok).toBe(true);
      expect((await doc.listTables()).data.tables).toHaveLength(0);
      await expect(doc.removeTable(1)).rejects.toMatchObject({ code: "not_found" });
      await expect(doc.describeTable(99)).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await doc.close();
    }
  });

  it("enforces names, overlap and merge rules; auto-names and remaps", async () => {
    const doc = await TallyDocument.open(host);
    try {
      // Omitted name gets the smallest free Table{n}.
      const first = await doc.insertTable({ range: { from: "A1", to: "B3" } });
      expect(first.data.table.name).toBe("Table1");
      const second = await doc.insertTable({ range: { from: "D1", to: "E3" } });
      expect(second.data.table.name).toBe("Table2");

      // Workbook-unique names, case-insensitive.
      await expect(
        doc.insertTable({ name: "table1", range: { from: "G1", to: "H3" } }),
      ).rejects.toMatchObject({ code: "validation" });
      await expect(
        doc.insertTable({ name: "Bad Name!", range: { from: "G1", to: "H3" } }),
      ).rejects.toMatchObject({ code: "validation" });

      // Overlapping table on the same sheet rejects atomically.
      await expect(
        doc.insertTable({ range: { from: "B3", to: "C5" } }),
      ).rejects.toMatchObject({ code: "validation" });
      expect((await doc.listTables()).data.tables).toHaveLength(2);

      // A merge may not intersect a table; a table may not cover a merge.
      await expect(
        doc.mergeCells({ from: "A2", to: "C2" }),
      ).rejects.toMatchObject({ code: "validation" });
      await doc.mergeCells({ from: "J1", to: "K1" });
      await expect(
        doc.insertTable({ range: { from: "J1", to: "L4" } }),
      ).rejects.toMatchObject({ code: "validation" });
      // Non-overlapping merge is fine.
      const third = await doc.insertTable({ range: { from: "A10", to: "B12" } });
      expect(third.data.table.name).toBe("Table3");

      // Structural edit inside a table expands its range (Excel behavior).
      await doc.insertRows({ from: 3, to: 3 });
      const grown = await doc.describeTable(1);
      expect(grown.data.table.range).toBe("A1:B4");
      // The merge sits above the edit and is unaffected.
      const merges = await doc.listMergedCells();
      expect(merges.data.merges[0]).toMatchObject({ from: "J1", to: "K1" });

      // Deleting the table's bottom row shrinks it; deleting every row
      // the range covers drops the table.
      await doc.deleteRows({ from: 4, to: 4 });
      expect((await doc.describeTable(1)).data.table.range).toBe("A1:B3");
      await doc.deleteRows({ from: 1, to: 3 });
      await expect(doc.describeTable(1)).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await doc.close();
    }
  });
});
