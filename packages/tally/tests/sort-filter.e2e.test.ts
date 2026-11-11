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

describe("tally sort and filters (real Rust via nf-cli)", () => {
  it("sorts rows by computed keys, keeps formulas verbatim, undoes exactly", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("A1", "30");
      await doc.setCell("A2", "10");
      await doc.setCell("A3", "=A1/3");
      await doc.setCell("B1", "x");
      await doc.setCell("B2", "y");
      await doc.setCell("B3", "z");
      const before = await doc.save();

      // A3 computes 10, tying A2 — stable order keeps A2 before A3.
      const sorted = await doc.sortRange(
        { from: "A1", to: "B3" },
        [{ column: "A" }],
      );
      expect(sorted.data.sorted_rows).toBe(3);
      expect(sorted.data.changed).toBeGreaterThan(0);
      expect((await doc.getCell("A1")).data.raw).toBe("10");
      expect((await doc.getCell("A2")).data.raw).toBe("=A1/3");
      expect((await doc.getCell("A3")).data.raw).toBe("30");
      // Formulas moved verbatim: "=A1/3" now reads the new A1 (10) → 10/3.
      expect((await doc.getCell("A2")).data.computed).toBeCloseTo(10 / 3);
      // Whole rows moved together.
      expect((await doc.getCell("B1")).data.raw).toBe("y");
      expect((await doc.getCell("B3")).data.raw).toBe("x");

      expect(await doc.undo()).toBe(true);
      const restored = await doc.save();
      expect(Buffer.from(restored).equals(Buffer.from(before))).toBe(true);
      expect((await doc.getCell("A1")).data.raw).toBe("30");
      expect(await doc.redo()).toBe(true);
      expect((await doc.getCell("A1")).data.raw).toBe("10");

      // Header row stays put.
      const e = await TallyDocument.open(host);
      try {
        await e.setCell("A1", "name");
        await e.setCell("A2", "b");
        await e.setCell("A3", "a");
        await e.sortRange({ from: "A1", to: "A3" }, [{ offset: 0 }], {
          hasHeader: true,
        });
        expect((await e.getCell("A1")).data.raw).toBe("name");
        expect((await e.getCell("A2")).data.raw).toBe("a");
        expect((await e.getCell("A3")).data.raw).toBe("b");
      } finally {
        await e.close();
      }
    } finally {
      await doc.close();
    }
  });

  it("filters hide rows without deleting, reports visibility, and round-trips schema:4", async () => {
    const doc = await TallyDocument.open(host);
    try {
      for (const [addr, v] of [
        ["A1", "10"],
        ["A2", "20"],
        ["A3", "30"],
        ["A4", "40"],
      ] as const) {
        await doc.setCell(addr, v);
      }
      const created = await doc.setFilter(
        { from: "A1", to: "A4" },
        ">15",
        { column: "A" },
      );
      expect(created.data.rule.id).toBe(1);
      expect(created.data.rule.column).toBe("A");
      expect(created.data.rule.sheet).toBe("Sheet1");

      // Rows 2-4 visible, row 1 hidden — but nothing is deleted.
      const report = await doc.evaluateFilters({ from: "A1", to: "A4" });
      const vis = report.data.rows.map((r) => ("visible" in r ? r.visible : r.matched));
      expect(vis).toEqual([false, true, true, true]);
      expect((await doc.getCell("A1")).data.raw).toBe("10");
      expect((await doc.getCell("A4")).data.raw).toBe("40");

      // Single-rule mode.
      const single = await doc.evaluateFilters(
        { from: "A1", to: "A4" },
        { id: created.data.rule.id },
      );
      expect(single.data.rows.map((r) => ("matched" in r ? r.matched : false))).toEqual([
        false, true, true, true,
      ]);

      // Identical resubmission is eventless.
      const dup = await doc.setFilter(
        { from: "A4", to: "A1" },
        ">15",
        { column: "a" },
      );
      expect(dup.events).toEqual([]);
      expect(dup.data.rule.id).toBe(1);

      // Snapshot round-trip preserves the durable rule (schema:4).
      const bytes = await doc.save();
      const reopened = await TallyDocument.openSnapshot(host, bytes);
      try {
        const rules = await reopened.getFilters();
        expect(rules.data.rules).toHaveLength(1);
        expect(rules.data.rules[0]?.criteria).toBe(">15");
        const again = await reopened.evaluateFilters({ from: "A1", to: "A4" });
        expect(again.data.rows[0]).toMatchObject({ row: 1, visible: false });
      } finally {
        await reopened.close();
      }

      // clearFilter by range removes it; undo restores.
      const cleared = await doc.clearFilter({ from: "A1", to: "A4" });
      expect(cleared.data.cleared).toBe(1);
      expect((await doc.getFilters()).data.rules).toHaveLength(0);
      expect(await doc.undo()).toBe(true);
      expect((await doc.getFilters()).data.rules).toHaveLength(1);
      await expect(doc.clearFilter(99)).rejects.toMatchObject({
        code: "not_found",
      });
    } finally {
      await doc.close();
    }
  });

  it("rejects invalid sort keys and filter rules atomically", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("A1", "1");
      await doc.setCell("A2", "2");
      const before = await doc.save();
      for (const bad of [
        { range: { from: "A1", to: "A2" }, keys: [] },
        { range: { from: "A1", to: "A2" }, keys: [{ offset: 0, column: "A" }] },
        { range: { from: "A1", to: "A2" }, keys: [{ column: "Z" }] },
        { range: { from: "A1", to: "A2" }, keys: [{ offset: 5 }] },
      ]) {
        await expect(doc.handle.apply("sortRange", bad)).rejects.toMatchObject({
          code: expect.any(String),
        });
      }
      for (const bad of [
        { range: { from: "A1", to: "A2" }, criteria: ">apple" },
        { range: { from: "A1", to: "A2" }, criteria: ">1", column: "Z" },
        { range: { from: "A1", to: "A2" }, criteria: ">1", column: "A2" },
      ]) {
        await expect(doc.handle.apply("setFilter", bad)).rejects.toMatchObject({
          code: expect.any(String),
        });
      }
      const after = await doc.save();
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
    } finally {
      await doc.close();
    }
  });
});
