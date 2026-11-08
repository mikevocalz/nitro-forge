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

describe("tally pivot specs (real Rust via nf-cli)", () => {
  it("stores pivot specs, patches, lists, describes and removes them", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setRange("A1", [["region", "qty", "price"], ["east", "2", "5"]]);
      const created = await doc.insertPivot(
        {
          name: "Sales",
          source: { range: { from: "B2", to: "E9" } },
          rows: [0, 2],
          columns: [1],
          values: [
            { field: 3, agg: "sum" },
            { field: 2, agg: "count" },
          ],
          filters: [{ field: 0, values: ["east", "west"] }],
          sort: { field: 0, ascending: false },
        },
        "Sheet1",
      );
      const pivot = created.data.pivot;
      expect(pivot.id).toBe(1);
      expect(pivot.sheet).toBe("Sheet1");
      expect(pivot.name).toBe("Sales");
      expect(pivot.source.range).toBe("B2:E9");
      expect(pivot.source.sheet_id).toBe(pivot.sheet_id);
      expect(pivot.rows).toEqual([0, 2]);
      expect(pivot.columns).toEqual([1]);
      expect(pivot.values).toEqual([
        { field: 3, agg: "sum" },
        { field: 2, agg: "count" },
      ]);
      expect(pivot.filters).toEqual([{ field: 0, values: ["east", "west"] }]);
      expect(pivot.sort).toEqual({ field: 0, ascending: false });

      // describePivot returns the same spec; storage only — no cells written.
      const described = await doc.describePivot(1);
      expect(described.data.pivot).toEqual(pivot);
      const wb = await doc.workbook();
      expect(wb.data.sheets[0]?.cell_count).toBe(6);

      // Partial patch: rename, swap values, clear filters/sort.
      const patched = await doc.updatePivot(1, {
        name: "Revenue",
        values: [{ field: 2, agg: "max" }],
        filters: null,
        sort: null,
      });
      expect(patched.data.pivot.name).toBe("Revenue");
      expect(patched.data.pivot.values).toEqual([{ field: 2, agg: "max" }]);
      expect(patched.data.pivot.filters).toBeUndefined();
      expect(patched.data.pivot.sort).toBeUndefined();
      expect(patched.data.pivot.rows).toEqual([0, 2]);

      // Equal patch is eventless.
      const noop = await doc.updatePivot(1, { name: "Revenue" });
      expect(noop.events).toEqual([]);

      // Undo restores the pre-patch spec, redo re-applies it.
      expect(await doc.undo()).toBe(true);
      expect((await doc.describePivot(1)).data.pivot.name).toBe("Sales");
      expect(await doc.redo()).toBe(true);
      expect((await doc.describePivot(1)).data.pivot.name).toBe("Revenue");

      // listPivots filters by output sheet.
      await doc.addSheet("Out");
      await doc.insertPivot(
        {
          source: { sheet: "Sheet1", range: { from: "A1", to: "C4" } },
          values: [{ field: 0, agg: "min" }],
        },
        "Out",
      );
      expect((await doc.listPivots()).data.pivots).toHaveLength(2);
      const onOut = await doc.listPivots("Out");
      expect(onOut.data.pivots).toHaveLength(1);
      expect(onOut.data.pivots[0]?.sheet).toBe("Out");
      expect(onOut.data.pivots[0]?.source.sheet).toBe("Sheet1");

      // Snapshot round-trip preserves specs (schema:9).
      const bytes = await doc.save();
      const reopened = await TallyDocument.openSnapshot(host, bytes);
      try {
        const pivots = await reopened.listPivots();
        expect(pivots.data.pivots).toHaveLength(2);
        expect(pivots.data.pivots[0]?.name).toBe("Revenue");
      } finally {
        await reopened.close();
      }

      // removeSheet cascade: removing the source sheet drops the pivot.
      await doc.removeSheet("Sheet1");
      expect((await doc.listPivots()).data.pivots).toHaveLength(0);
      expect(await doc.undo()).toBe(true);
      expect((await doc.listPivots()).data.pivots).toHaveLength(2);
      expect(await doc.redo()).toBe(true);
      expect((await doc.listPivots()).data.pivots).toHaveLength(0);
      await doc.undo(); // restore Sheet1 for the remove assertions below

      const removed = await doc.removePivot(1);
      expect(removed.data.ok).toBe(true);
      expect((await doc.listPivots()).data.pivots).toHaveLength(1);
      await expect(doc.removePivot(1)).rejects.toMatchObject({ code: "not_found" });
      await expect(doc.describePivot(99)).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await doc.close();
    }
  });

  it("rejects invalid specs atomically and remaps source ranges", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.addSheet("Data");
      // Field index past the source width (A1:D4 → indices 0..3).
      await expect(
        doc.insertPivot(
          {
            source: { range: { from: "A1", to: "D4" } },
            values: [{ field: 4, agg: "sum" }],
          },
          "Data",
        ),
      ).rejects.toMatchObject({ code: "validation" });
      expect((await doc.listPivots()).data.pivots).toHaveLength(0);

      const created = await doc.insertPivot(
        {
          source: { sheet: "Data", range: { from: "B2", to: "D10" } },
          rows: [0],
          columns: [1],
          values: [{ field: 2, agg: "sum" }],
        },
        "Data",
      );
      expect(created.data.pivot.source.range).toBe("B2:D10");

      // Insert 3 rows before row 1 → source shifts to B5:D13.
      await doc.insertRows({ sheet: "Data", from: 1, to: 3 });
      expect((await doc.describePivot(created.data.pivot.id)).data.pivot.source.range).toBe("B5:D13");

      // Insert a column before column A → B..D becomes C..E.
      await doc.insertCols({ sheet: "Data", from: 1, to: 1 });
      expect((await doc.describePivot(created.data.pivot.id)).data.pivot.source.range).toBe("C5:E13");

      // Delete the columns covering the whole source width → pivot drops.
      await doc.deleteCols({ sheet: "Data", from: 3, to: 5 });
      expect((await doc.listPivots()).data.pivots).toHaveLength(0);
      expect(await doc.undo()).toBe(true);
      expect((await doc.describePivot(created.data.pivot.id)).data.pivot.source.range).toBe("C5:E13");

      // Protection: a protected output sheet gates mutations, reads stay open.
      await doc.protectSheet("Data", true);
      await expect(
        doc.insertPivot(
          { source: { range: { from: "A1", to: "A2" } }, values: [{ field: 0, agg: "sum" }] },
          "Data",
        ),
      ).rejects.toMatchObject({ code: "validation" });
      await expect(doc.updatePivot(created.data.pivot.id, { name: "X" })).rejects.toMatchObject({ code: "validation" });
      await expect(doc.removePivot(created.data.pivot.id)).rejects.toMatchObject({ code: "validation" });
      expect((await doc.listPivots()).data.pivots).toHaveLength(1);
    } finally {
      await doc.close();
    }
  });

  it("refreshPivot materializes the grid, refreshes on edit and undoes", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setRange("A1", [
        ["east", "1", "10"],
        ["west", "2", "20"],
        ["east", "3", "30"],
        ["west", "4", "40"],
      ]);
      await doc.addSheet("Out");
      const created = await doc.insertPivot(
        {
          source: { sheet: "Sheet1", range: { from: "A1", to: "C4" } },
          rows: [0],
          values: [
            { field: 1, agg: "sum" },
            { field: 2, agg: "avg" },
          ],
        },
        "Out",
      );
      const id = created.data.pivot.id;
      // insertPivot still writes no cells. Grid reads go through
      // exportCsv (read-only, sheet-targeted) so setActive never lands
      // on the undo stack between a refresh and its undo/redo checks.
      const grid = async (from: string, to: string) =>
        (await doc.exportCsv({ sheet: "Out", range: { from, to } })).data.text;
      expect((await doc.workbook()).data.sheets[1]?.cell_count).toBe(0);

      const first = await doc.refreshPivot(id);
      expect(first.data.changed).toBeGreaterThan(0);
      expect(first.events).toHaveLength(1);
      // Header row then one row per row-group (east before west).
      expect(await grid("A1", "C3")).toBe(
        ",sum:1,avg:2\r\neast,4,20\r\nwest,6,30\r\n",
      );
      const spec = (await doc.describePivot(id)).data.pivot;
      expect(spec.output).toEqual({ anchor: "A1", rows: 3, cols: 3 });

      // Identical refresh is eventless.
      const noop = await doc.refreshPivot(id);
      expect(noop.data.changed).toBe(0);
      expect(noop.events).toEqual([]);

      // Source edit + refresh recomputes. Source A1:C4 has no header row;
      // renaming A2 (west→north) yields groups east, north, west.
      await doc.setActive("Sheet1");
      await doc.setCell("A2", "north");
      const second = await doc.refreshPivot(id);
      expect(second.data.changed).toBeGreaterThan(0);
      expect(await grid("A1", "C4")).toBe(
        ",sum:1,avg:2\r\neast,4,20\r\nnorth,2,20\r\nwest,4,40\r\n",
      );

      // One undo reverts the refresh (cells + recorded footprint); the
      // journal restore also returns the active sheet to Sheet1.
      expect(await doc.undo()).toBe(true);
      expect(await grid("A1", "C3")).toBe(
        ",sum:1,avg:2\r\neast,4,20\r\nwest,6,30\r\n",
      );
      expect((await doc.describePivot(id)).data.pivot.output).toEqual({
        anchor: "A1",
        rows: 3,
        cols: 3,
      });
      expect(await doc.redo()).toBe(true);
      expect(await grid("A1", "C4")).toBe(
        ",sum:1,avg:2\r\neast,4,20\r\nnorth,2,20\r\nwest,4,40\r\n",
      );

      // refreshAllPivots recomputes every unprotected pivot in one op.
      await doc.setCell("B4", "9"); // west is now only row 4: qty 9
      const all = await doc.refreshAllPivots();
      expect(all.data.refreshed).toBe(1);
      expect(all.data.changed).toBeGreaterThan(0);
      expect(all.events).toHaveLength(1);
      expect(await grid("A1", "C4")).toBe(
        ",sum:1,avg:2\r\neast,4,20\r\nnorth,2,20\r\nwest,9,40\r\n",
      );

      // Output anchor is settable and reported; retargeting resets the
      // recorded footprint.
      await doc.updatePivot(id, { output: "J10" });
      const moved = (await doc.describePivot(id)).data.pivot;
      expect(moved.output).toEqual({ anchor: "J10", rows: 0, cols: 0 });
      await doc.refreshPivot(id);
      expect(await grid("J10", "L13")).toBe(
        ",sum:1,avg:2\r\neast,4,20\r\nnorth,2,20\r\nwest,9,40\r\n",
      );
      // The old A1-anchored grid is abandoned, not cleared.
      expect(await grid("A1", "C4")).toBe(
        ",sum:1,avg:2\r\neast,4,20\r\nnorth,2,20\r\nwest,9,40\r\n",
      );
    } finally {
      await doc.close();
    }
  });
});
