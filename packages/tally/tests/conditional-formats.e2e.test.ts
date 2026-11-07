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

describe("tally conditional formats (real Rust via nf-cli)", () => {
  it("sets, lists, evaluates against computed values, clears and undoes rules", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("A1", "5");
      await doc.setCell("A2", "=A1*2");
      await doc.setCell("A3", "apple");
      await doc.setCell("A4", "pear");

      const created = await doc.setConditionalFormat(
        { from: "A1", to: "A4" },
        { criteria: ">=10", format: { bold: true, fill: "#FF0000" } },
      );
      expect(created.data.rule.id).toBe(1);
      expect(created.data.rule.range).toBe("A1:A4");
      expect(created.data.rule.sheet).toBe("Sheet1");
      await doc.setConditionalFormat(
        { from: "A1", to: "A4" },
        { criteria: "a*", format: { italic: true } },
      );
      // Overlapping identical-range rules are allowed.
      const listed = await doc.getConditionalFormats();
      expect(listed.data.rules).toHaveLength(2);
      expect(listed.data.rules[0]?.format).toEqual({ bold: true, fill: "#FF0000" });

      // Matches track computed values: A2 (=10) hits rule 1 only,
      // A3 ("apple") hits rule 2 only, A1/A4 hit nothing.
      const report = await doc.evaluateConditionalFormats({ from: "A1", to: "A4" });
      const byAddr = new Map(report.data.cells.map((c) => [c.addr, c]));
      expect(byAddr.get("A1")?.matches).toEqual([]);
      expect(byAddr.get("A2")?.computed).toBe(10);
      expect(byAddr.get("A2")?.matches.map((m) => m.id)).toEqual([1]);
      expect(byAddr.get("A3")?.matches.map((m) => m.id)).toEqual([2]);
      expect(byAddr.get("A4")?.matches).toEqual([]);

      // Live evaluation: editing the source cell changes matches.
      await doc.setCell("A1", "20");
      const again = await doc.evaluateConditionalFormats({ from: "A2", to: "A2" });
      expect(again.data.cells[0]?.matches.map((m) => m.id)).toEqual([1]);

      // Identical re-submission is eventless.
      const dup = await doc.setConditionalFormat(
        { from: "A4", to: "A1" },
        { criteria: ">=10", format: { bold: true, fill: "#FF0000" } },
      );
      expect(dup.events).toEqual([]);
      expect(dup.data.rule.id).toBe(1);

      // clearConditionalFormat by range removes every intersecting rule —
      // both rules cover A1:A4, so clearing A3 removes both.
      const cleared = await doc.clearConditionalFormat({
        range: { from: "A3", to: "A3" },
      });
      expect(cleared.data.cleared).toBe(2);
      expect((await doc.getConditionalFormats()).data.rules).toHaveLength(0);

      // Undo restores the cleared rules; redo removes them again.
      expect(await doc.undo()).toBe(true);
      expect((await doc.getConditionalFormats()).data.rules).toHaveLength(2);
      expect(await doc.redo()).toBe(true);
      expect((await doc.getConditionalFormats()).data.rules).toHaveLength(0);

      // Clear by id.
      const againRule = await doc.setConditionalFormat(
        { from: "B1", to: "B1" },
        { criteria: "TRUE", format: { color: "#123456" } },
      );
      const clearedById = await doc.clearConditionalFormat({ id: againRule.data.rule.id });
      expect(clearedById.data.cleared).toBe(1);
      await expect(
        doc.clearConditionalFormat({ id: againRule.data.rule.id }),
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await doc.close();
    }
  });

  it("rejects invalid rules atomically and round-trips through snapshots", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setCell("B2", "42");
      for (const bad of [
        { criteria: ">apple", format: { bold: true } },
        { criteria: ">1", format: {} },
        { criteria: ">1", format: { fill: "red" } },
        { criteria: ">1", format: { number_format: "n" } as never },
      ]) {
        await expect(
          doc.setConditionalFormat({ from: "B2", to: "B2" }, bad),
        ).rejects.toMatchObject({ code: expect.any(String) });
      }
      const ok = await doc.setConditionalFormat(
        { from: "B2", to: "B2" },
        { criteria: ">40", format: { underline: true, color: "#00FF00" } },
      );
      expect(ok.data.rule.id).toBe(1);

      const bytes = await doc.save();
      const reopened = await TallyDocument.openSnapshot(host, bytes);
      try {
        const rules = await reopened.getConditionalFormats();
        expect(rules.data.rules).toHaveLength(1);
        expect(rules.data.rules[0]?.criteria).toBe(">40");
        const report = await reopened.evaluateConditionalFormats({
          from: "B2",
          to: "B2",
        });
        expect(report.data.cells[0]?.computed).toBe(42);
        expect(report.data.cells[0]?.matches.map((m) => m.id)).toEqual([1]);
      } finally {
        await reopened.close();
      }
    } finally {
      await doc.close();
    }
  });
});
