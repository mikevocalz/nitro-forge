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

describe("tally named ranges + functionCatalog (real Rust via nf-cli)", () => {
  it("defines, lists, updates, resolves in formulas, and removes names", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("A1", "2");
      await doc.setCell("A2", "3");
      await doc.setCell("B1", "4");

      const defined = await doc.defineName("Vals", "b2:a1");
      expect(defined.data.name).toEqual({
        name: "Vals",
        sheet: "Sheet1",
        sheet_id: 0,
        refers_to: "A1:B2",
      });
      const listed = await doc.listNames();
      expect(listed.data.names).toHaveLength(1);
      expect(listed.data.names[0]?.refers_to).toBe("A1:B2");

      // Formulas resolve the name case-insensitively; it is live (derived).
      await doc.setCell("C1", "=sum(vals)");
      expect((await doc.getCell("C1")).data.computed).toBe(9);
      await doc.updateName("vals", { refersTo: "A1:A2" });
      expect((await doc.getCell("C1")).data.computed).toBe(5);

      await doc.removeName("VALS");
      expect((await doc.listNames()).data.names).toHaveLength(0);
      expect((await doc.getCell("C1")).data.computed).toBe("#NAME?");
      await expect(doc.removeName("Vals")).rejects.toMatchObject({
        code: "not_found",
      });
    } finally {
      await doc.close();
    }
  });

  it("rejects invalid names and targets atomically", async () => {
    const doc = await TallyDocument.open(host);
    try {
      for (const bad of [
        "A1", "has space", "R1C1", "TRUE", "9lives",
        // Ref-shaped beyond grid bounds, `.` is not a word character, and
        // function-catalog names are reserved.
        "A0", "ZZZZZZZZ1", "a.b", "SUM",
      ]) {
        await expect(doc.defineName(bad, "A1")).rejects.toMatchObject({
          code: "validation",
        });
      }
      await expect(doc.defineName("Bad", "A1:B2:C3")).rejects.toMatchObject({
        code: "validation",
      });
      await expect(
        doc.defineName("OffSheet", "A1:XFD1048577"),
      ).rejects.toMatchObject({ code: "out_of_bounds" });
      expect((await doc.listNames()).data.names).toHaveLength(0);
    } finally {
      await doc.close();
    }
  });

  it("undoes/redoos name ops and persists names through snapshots", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.defineName("Keep", "A1:B2");
      // `refers_to: null` counts as absent — alone it is a validation error.
      await expect(
        doc.handle.apply("updateName", { name: "Keep", refers_to: null }),
      ).rejects.toMatchObject({ code: "validation" });
      await doc.updateName("Keep", { refersTo: "C3:D4" });
      const saved = await doc.save();

      const restored = await TallyDocument.openSnapshot(host, saved);
      try {
        expect((await restored.listNames()).data.names[0]).toMatchObject({
          name: "Keep",
          refers_to: "C3:D4",
        });
      } finally {
        await restored.close();
      }

      // Undo the update, then the define; redo both.
      await doc.undo();
      expect((await doc.listNames()).data.names[0]?.refers_to).toBe("A1:B2");
      await doc.undo();
      expect((await doc.listNames()).data.names).toHaveLength(0);
      await doc.redo();
      expect((await doc.listNames()).data.names).toHaveLength(1);
      await doc.redo();
      expect((await doc.listNames()).data.names[0]?.refers_to).toBe("C3:D4");
    } finally {
      await doc.close();
    }
  });

  it("functionCatalog returns the bounded evaluator function set", async () => {
    const doc = await TallyDocument.open(host);
    try {
      const catalog = await doc.functionCatalog();
      const fns = catalog.data.functions;
      const byName = new Map(fns.map((f) => [f.name, f]));
      for (const name of [
        "SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA",
        "COUNTIF", "SUMIF", "IF", "ROUND", "ABS", "CONCAT", "TRUE", "FALSE",
      ]) {
        expect(byName.has(name), `missing ${name}`).toBe(true);
      }
      expect(byName.get("SUMIF")).toMatchObject({ min_args: 2, max_args: 3 });
      expect(byName.get("SUM")?.max_args).toBeNull();
      expect(byName.get("ABS")).toMatchObject({ min_args: 1, max_args: 1 });
    } finally {
      await doc.close();
    }
  });
});
