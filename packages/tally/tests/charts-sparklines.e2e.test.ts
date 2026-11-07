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

describe("tally charts and sparklines (real Rust via nf-cli)", () => {
  it("stores chart specs, patches them, lists and removes them", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setRange("A1", [["1", "2"], ["3", "4"]]);
      const created = await doc.insertChart(
        {
          kind: "column",
          title: "Sales",
          range: { from: "B2", to: "A1" },
          series: [{ name: "S1", range: { from: "A1", to: "A2" } }],
          colors: ["#FF0000", "#00ff00", "#FF0000"],
        },
        "Sheet1",
      );
      expect(created.data.chart.id).toBe(1);
      expect(created.data.chart.kind).toBe("column");
      expect(created.data.chart.range).toBe("A1:B2");
      expect(created.data.chart.series?.[0]?.range).toBe("A1:A2");
      expect(created.data.chart.colors).toEqual(["#FF0000", "#00ff00"]);
      expect(created.data.chart.sheet).toBe("Sheet1");

      // describe exposes the stored spec.
      const described = await doc.describe<{ charts?: unknown[] }>();
      expect(described.data.charts).toHaveLength(1);

      const patched = await doc.updateChart(1, {
        title: "Revenue",
        colors: null,
        kind: "line",
      });
      expect(patched.data.chart.title).toBe("Revenue");
      expect(patched.data.chart.kind).toBe("line");
      expect(patched.data.chart.colors).toBeUndefined();
      expect(patched.data.chart.range).toBe("A1:B2");

      // Equal patch is eventless.
      const noop = await doc.updateChart(1, { title: "Revenue" });
      expect(noop.events).toEqual([]);

      const listed = await doc.listCharts();
      expect(listed.data.charts).toHaveLength(1);
      expect(listed.data.charts[0]?.id).toBe(1);

      // Undo restores the pre-patch spec, redo re-applies it.
      expect(await doc.undo()).toBe(true);
      expect((await doc.listCharts()).data.charts[0]?.title).toBe("Sales");
      expect(await doc.redo()).toBe(true);
      expect((await doc.listCharts()).data.charts[0]?.title).toBe("Revenue");

      await doc.addSheet("Other");
      expect((await doc.listCharts("Other")).data.charts).toHaveLength(0);
      expect((await doc.listCharts("Sheet1")).data.charts).toHaveLength(1);

      // Snapshot round-trip preserves specs (schema:5).
      const bytes = await doc.save();
      const reopened = await TallyDocument.openSnapshot(host, bytes);
      try {
        const charts = await reopened.listCharts();
        expect(charts.data.charts).toHaveLength(1);
        expect(charts.data.charts[0]?.title).toBe("Revenue");
        expect(charts.data.charts[0]?.kind).toBe("line");
      } finally {
        await reopened.close();
      }

      const removed = await doc.removeChart(1);
      expect(removed.data.ok).toBe(true);
      expect((await doc.listCharts()).data.charts).toHaveLength(0);
      await expect(doc.removeChart(1)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(doc.updateChart(1, { kind: "pie" })).rejects.toMatchObject({
        code: "not_found",
      });
    } finally {
      await doc.close();
    }
  });

  it("stores sparkline specs per anchor, replaces in place, clears and round-trips", async () => {
    const doc = await TallyDocument.open(host);
    try {
      for (const [addr, v] of [
        ["A1", "1"],
        ["A2", "3"],
        ["A3", "2"],
        ["A4", "5"],
      ] as const) {
        await doc.setCell(addr, v);
      }
      const created = await doc.setSparkline(
        { cell: "$c$3" },
        { from: "A4", to: "A1" },
        "line",
      );
      expect(created.data.sparkline.id).toBe(1);
      expect(created.data.sparkline.target).toBe("C3");
      expect(created.data.sparkline.data).toBe("A1:A4");
      expect(created.data.sparkline.sheet).toBe("Sheet1");

      // Identical resubmission is eventless.
      const dup = await doc.setSparkline({ cell: "C3" }, { from: "A1", to: "A4" }, "line");
      expect(dup.events).toEqual([]);
      expect(dup.data.sparkline.id).toBe(1);

      // Same target, different kind replaces in place keeping the id.
      const replaced = await doc.setSparkline(
        { cell: "C3" },
        { from: "A1", to: "A4" },
        "column",
      );
      expect(replaced.data.sparkline.id).toBe(1);
      expect(replaced.data.sparkline.kind).toBe("column");
      expect((await doc.listSparklines()).data.sparklines).toHaveLength(1);

      // A range anchor is a distinct spec.
      await doc.setSparkline(
        { range: { from: "D1", to: "E2" } },
        { from: "A1", to: "A1" },
        "winloss",
      );
      expect((await doc.listSparklines()).data.sparklines).toHaveLength(2);

      // Snapshot round-trip preserves specs (schema:5).
      const bytes = await doc.save();
      const reopened = await TallyDocument.openSnapshot(host, bytes);
      try {
        const specs = await reopened.listSparklines();
        expect(specs.data.sparklines).toHaveLength(2);
        expect(specs.data.sparklines[0]?.target).toBe("C3");
        expect(specs.data.sparklines[0]?.kind).toBe("column");
      } finally {
        await reopened.close();
      }

      // clearSparkline by target selector, then by id; misses are eventless.
      const cleared = await doc.clearSparkline({ cell: "C3" });
      expect(cleared.data.cleared).toBe(1);
      const miss = await doc.clearSparkline({ cell: "Z9" });
      expect(miss.events).toEqual([]);
      expect(miss.data.cleared).toBe(0);
      const byId = await doc.clearSparkline(2);
      expect(byId.data.cleared).toBe(1);
      expect((await doc.listSparklines()).data.sparklines).toHaveLength(0);
      await expect(doc.clearSparkline(2)).rejects.toMatchObject({
        code: "not_found",
      });

      // Undo restores the id-cleared spec.
      expect(await doc.undo()).toBe(true);
      expect((await doc.listSparklines()).data.sparklines).toHaveLength(1);
    } finally {
      await doc.close();
    }
  });

  it("rejects invalid chart and sparkline payloads atomically", async () => {
    const doc = await TallyDocument.open(host);
    try {
      const before = await doc.save();
      for (const bad of [
        { chart: { kind: "bogus", range: { from: "A1", to: "A1" } } },
        { chart: { kind: "line", range: { from: "A1", to: "XFE1" } } },
        { chart: { kind: "line", range: { from: "A1", to: "A1" }, title: "" } },
        { chart: { kind: "line", range: { from: "A1", to: "A1" }, colors: ["red"] } },
        { chart: { kind: "line", range: { from: "A1", to: "A1" }, series: [{}] } },
      ]) {
        await expect(doc.handle.apply("insertChart", bad)).rejects.toMatchObject({
          code: expect.any(String),
        });
      }
      for (const bad of [
        { cell: "A1", data: { from: "A1", to: "A1" }, kind: "pie" },
        { cell: "A1", data: { from: "A1", to: "XFE1" }, kind: "line" },
        { cell: "A1", range: { from: "A1", to: "A1" }, data: { from: "A1", to: "A1" }, kind: "line" },
        { cell: "A1", data: { from: "A1", to: "A1" } },
      ]) {
        await expect(doc.handle.apply("setSparkline", bad)).rejects.toMatchObject({
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
