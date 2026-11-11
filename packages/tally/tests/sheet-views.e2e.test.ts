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

describe("tally sheet views (real Rust via nf-cli)", () => {
  it("saves, applies, lists and removes named views bound to sheets", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setRange("A1", [["1"], ["2"], ["3"]]);
      await doc.setFilter({ from: "A1", to: "A3" }, ">1", { column: "A" });
      await doc.setFilter({ from: "B1", to: "B3" }, "*", { sheet: "Sheet1" });

      const saved = await doc.saveSheetView("Big only", "Sheet1");
      expect(saved.data.view.id).toBe(1);
      expect(saved.data.view.name).toBe("Big only");
      expect(saved.data.view.sheet).toBe("Sheet1");
      expect(saved.data.view.filters).toHaveLength(2);
      expect(saved.data.view.filters[0]).toEqual({
        range: "A1:A3",
        column: "A",
        criteria: ">1",
      });
      expect(saved.data.view.active).toBe(false);

      // Re-saving the same name on the same sheet updates in place.
      const rulesBefore = (await doc.getFilters()).data.rules.length;
      const resaved = await doc.saveSheetView("big ONLY", "Sheet1");
      expect(resaved.data.view.id).toBe(1);
      expect((await doc.listSheetViews()).data.views).toHaveLength(1);
      expect(rulesBefore).toBe(2);

      // Identical recapture is eventless.
      const noop = await doc.saveSheetView("Big only", "Sheet1");
      expect(noop.events).toEqual([]);

      // Diverge the filters, then apply the view: specs are restored under
      // fresh rule ids and the selection is recorded.
      await doc.setFilter({ from: "C1", to: "C3" }, "<>x", { sheet: "Sheet1" });
      expect((await doc.getFilters()).data.rules).toHaveLength(3);
      const applied = await doc.setSheetView(1);
      expect(applied.data.view?.active).toBe(true);
      const rules = (await doc.getFilters()).data.rules;
      expect(rules).toHaveLength(2);
      expect(rules.map((r) => r.criteria).sort()).toEqual(["*", ">1"]);

      // Re-applying the active view is eventless.
      const reapplied = await doc.setSheetView(1);
      expect(reapplied.events).toEqual([]);

      // view:null clears only the selection.
      const cleared = await doc.setSheetView(null);
      expect(cleared.data.view).toBeNull();
      expect((await doc.listSheetViews()).data.views[0]?.active).toBe(false);
      expect((await doc.getFilters()).data.rules).toHaveLength(2);

      // Undo/redo across apply and clear.
      expect(await doc.undo()).toBe(true); // undo the clear → selection restored
      expect((await doc.listSheetViews()).data.views[0]?.active).toBe(true);
      expect(await doc.undo()).toBe(true); // undo the apply
      expect((await doc.getFilters()).data.rules).toHaveLength(3);
      expect(await doc.redo()).toBe(true);
      expect((await doc.getFilters()).data.rules).toHaveLength(2);

      // Per-sheet scoping: a same-named view on another sheet is distinct.
      await doc.addSheet("Other");
      const other = await doc.saveSheetView("Big only", "Other");
      expect(other.data.view.id).toBe(2);
      expect(other.data.view.sheet).toBe("Other");
      expect((await doc.listSheetViews("Other")).data.views).toHaveLength(1);
      expect((await doc.listSheetViews("Sheet1")).data.views).toHaveLength(1);

      // Snapshot round-trip preserves views and the active selection
      // (schema:6 wrapper).
      await doc.setSheetView(2);
      const bytes = await doc.save();
      const payload = JSON.parse(
        new TextDecoder().decode(bytes.subarray(9)),
      ) as { kind?: string; schema?: number };
      expect(payload.kind).toBe("tally");
      expect(payload.schema).toBe(6);
      const reopened = await TallyDocument.openSnapshot(host, bytes);
      try {
        const views = (await reopened.listSheetViews()).data.views;
        expect(views).toHaveLength(2);
        const otherView = views.find((v) => v.sheet === "Other");
        expect(otherView?.active).toBe(true);
        expect(otherView?.filters).toEqual([]);
      } finally {
        await reopened.close();
      }

      // removeSheetView; unknown ids reject.
      await expect(doc.removeSheetView(99)).rejects.toThrow();
      const removed = await doc.removeSheetView(2);
      expect(removed.data.ok).toBe(true);
      expect((await doc.listSheetViews()).data.views).toHaveLength(1);
      // Removing Other's view cleared its selection; Sheet1's view 1
      // stays active and untouched.
      const remaining = (await doc.listSheetViews()).data.views[0];
      expect(remaining?.id).toBe(1);
      expect(remaining?.active).toBe(true);
    } finally {
      await doc.close();
    }
  });

  it("rejects invalid view payloads without mutating the document", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setFilter({ from: "A1", to: "A2" }, ">0");
      await doc.saveSheetView("V");
      const before = await doc.describe();
      await expect(doc.saveSheetView("")).rejects.toThrow();
      await expect(doc.saveSheetView("x".repeat(129))).rejects.toThrow();
      await expect(doc.setSheetView(42)).rejects.toThrow();
      await expect(doc.removeSheetView(42)).rejects.toThrow();
      expect(await doc.describe()).toEqual(before);
    } finally {
      await doc.close();
    }
  });
});
