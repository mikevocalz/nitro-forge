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

describe("tally data validation (real Rust via nf-cli)", () => {
  it("sets rules, validates cells, replaces in place and clears", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("A1", "7");
      await doc.setCell("A2", "7.5");
      await doc.setCell("B1", "red");

      const set = await doc.setValidation(
        { from: "A1", to: "A2" },
        { kind: "number", min: 1, max: 10, integer: true },
      );
      expect(set.data.rule).toMatchObject({
        id: 1,
        sheet: "Sheet1",
        sheet_id: 0,
        range: "A1:A2",
        criteria: { kind: "number", min: 1, max: 10, integer: true },
      });

      const ok = await doc.validateCell("A1");
      expect(ok.data.valid).toBe(true);
      expect(ok.data.rule?.id).toBe(1);
      expect(ok.data.expected).toContain("integer");
      expect(ok.data.actual).toBe(7);

      const bad = await doc.validateCell("A2");
      expect(bad.data.valid).toBe(false);
      expect(bad.data.actual).toBe(7.5);

      // Uncovered cells report valid with no rule detail.
      const uncovered = await doc.validateCell("Z9");
      expect(uncovered.data).toEqual({ valid: true });

      // List criteria: exact case-sensitive match on the text form.
      await doc.setValidation({ from: "B1", to: "B1" }, { kind: "list", values: ["red", "blue"] });
      expect((await doc.validateCell("B1")).data.valid).toBe(true);
      await doc.setCell("B1", "RED");
      expect((await doc.validateCell("B1")).data.valid).toBe(false);

      // Same sheet+range replaces criteria in place, keeping the rule id.
      const replaced = await doc.setValidation(
        { from: "B1", to: "B1" },
        { kind: "text", min_length: 1 },
      );
      expect(replaced.data.rule.id).toBe(2);
      expect(replaced.data.rule.criteria).toEqual({ kind: "text", min_length: 1 });

      // Overlap with a different range rejects; identical resubmission is a no-op.
      await expect(
        doc.setValidation({ from: "A2", to: "B2" }, { kind: "number" }),
      ).rejects.toMatchObject({ code: "validation" });
      const noop = await doc.setValidation(
        { from: "A1", to: "A2" },
        { kind: "number", min: 1, max: 10, integer: true },
      );
      expect(noop.events ?? []).toEqual([]);

      // Clear by id and by intersecting range.
      expect((await doc.clearValidation(1)).data.cleared).toBe(1);
      expect((await doc.validateCell("A1")).data).toEqual({ valid: true });
      expect((await doc.clearValidation({ from: "B1", to: "B1" })).data.cleared).toBe(1);
      await expect(doc.clearValidation(99)).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await doc.close();
    }
  });

  it("undoes/redoos validation ops and persists rules through snapshots", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("A1", "3");
      await doc.setValidation({ from: "A1", to: "A1" }, { kind: "number", min: 0, max: 10 });
      await doc.setValidation({ from: "A1", to: "A1" }, { kind: "number", min: 5 });
      expect((await doc.validateCell("A1")).data.valid).toBe(false);

      const saved = await doc.save();
      const restored = await TallyDocument.openSnapshot(host, saved);
      try {
        const check = await restored.validateCell("A1");
        expect(check.data.valid).toBe(false);
        expect(check.data.rule?.criteria).toEqual({ kind: "number", min: 5 });
      } finally {
        await restored.close();
      }

      await doc.undo(); // undo the criteria replace
      expect((await doc.validateCell("A1")).data.valid).toBe(true);
      await doc.undo(); // undo the set
      expect((await doc.validateCell("A1")).data).toEqual({ valid: true });
      await doc.redo();
      await doc.redo();
      expect((await doc.validateCell("A1")).data.valid).toBe(false);
    } finally {
      await doc.close();
    }
  });

  it("cascade-drops rules with their sheet and restores them on undo", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.addSheet("Data");
      await doc.setValidation(
        { from: "A1", to: "A1" },
        { kind: "list", values: ["a"] },
        "Data",
      );
      await doc.setValidation({ from: "B2", to: "B2" }, { kind: "number", max: 3 });
      await doc.removeSheet("Data");
      const described = await doc.describe<{ validations?: unknown[] }>();
      expect(described.data.validations).toHaveLength(1);
      await doc.undo();
      const restored = await doc.describe<{ validations?: { sheet_id: number }[] }>();
      expect(restored.data.validations).toHaveLength(2);
      await doc.redo();
      const dropped = await doc.describe<{ validations?: unknown[] }>();
      expect(dropped.data.validations).toHaveLength(1);
    } finally {
      await doc.close();
    }
  });

  it("rejects invalid criteria and protected-sheet mutations", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await expect(
        doc.setValidation({ from: "A1", to: "A1" }, { kind: "list", values: [] }),
      ).rejects.toMatchObject({ code: "validation" });
      await expect(
        doc.setValidation({ from: "A1", to: "A1" }, { kind: "number", min: 5, max: 1 }),
      ).rejects.toMatchObject({ code: "validation" });
      await expect(
        // @ts-expect-error deferred kind is not part of the criteria union
        doc.setValidation({ from: "A1", to: "A1" }, { kind: "date", min: "2020-01-01" }),
      ).rejects.toMatchObject({ code: "invalid_command" });

      await doc.setValidation({ from: "A1", to: "A1" }, { kind: "number", min: 0 });
      await doc.protectSheet(0, true);
      await expect(
        doc.setValidation({ from: "B1", to: "B1" }, { kind: "number" }),
      ).rejects.toMatchObject({ code: "validation" });
      await expect(doc.clearValidation(1)).rejects.toMatchObject({ code: "validation" });
      // Reads stay allowed on protected sheets.
      expect((await doc.validateCell("A1")).data.valid).toBe(true);
      await doc.protectSheet(0, false);
      expect((await doc.clearValidation(1)).data.cleared).toBe(1);
    } finally {
      await doc.close();
    }
  });
});
