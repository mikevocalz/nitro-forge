import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PitchDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

const CHART = {
  kind: "column" as const,
  title: "Revenue",
  x_axis_label: "Quarter",
  series: [
    { id: "s1", label: "2025", points: [{ x: 1, y: 10 }, { x: 2, y: 20 }] },
    { id: "s2", label: "2026", points: [{ x: 1, y: 15 }, { x: 2, y: 25 }] },
  ],
};

const TABLE = {
  rows: 3,
  cols: 2,
  cells: [
    { row: 0, col: 0, value: "Name" },
    { row: 0, col: 1, value: "Score" },
    { row: 1, col: 1, value: 42.5 },
  ],
};

describe("pitch charts/tables e2e (real Rust via nf-cli)", () => {
  it("adds, describes, patches and removes chart and table objects", async () => {
    const doc = await PitchDocument.open(host, "Data deck");
    const slide = (await doc.describe<any>()).data.slides[0].id as number;

    const chart = (await doc.addChart(slide, 10, 20, 400, 300, CHART)).data.object_id;
    const table = (await doc.addTable(slide, 50, 60, 300, 200, TABLE)).data.object_id;

    const described = (await doc.describe<any>()).data;
    const chartObj = described.slides[0].objects.find((o: any) => o.id === chart);
    const tableObj = described.slides[0].objects.find((o: any) => o.id === table);
    expect(chartObj.kind).toBe("chart");
    expect(chartObj.chart.kind).toBe("column");
    expect(chartObj.chart.series).toHaveLength(2);
    expect(chartObj.chart.series[0].points[1].y).toBe(20);
    expect(tableObj.kind).toBe("table");
    expect(tableObj.table.cells).toHaveLength(3);
    expect(tableObj.table.cells[2].value).toBe(42.5);

    // Partial patches: chart series replace + kind change; table dims/cells.
    await doc.updateChart(slide, chart, {
      kind: "line",
      title: null,
      series: [{ id: "s9", label: "Total", points: [{ x: 0, y: -3.5 }] }],
    });
    await doc.updateTable(slide, table, {
      rows: 2,
      cols: 3,
      cells: [{ row: 1, col: 2, value: "new" }],
    });
    const patched = (await doc.describe<any>()).data.slides[0].objects;
    expect(patched.find((o: any) => o.id === chart).chart).toMatchObject({
      kind: "line",
      series: [{ id: "s9", label: "Total", points: [{ x: 0, y: -3.5 }] }],
    });
    expect(patched.find((o: any) => o.id === chart).chart.title).toBeUndefined();
    expect(patched.find((o: any) => o.id === table).table).toMatchObject({
      rows: 2,
      cols: 3,
      cells: [{ row: 1, col: 2, value: "new" }],
    });

    // Equal patch is an eventless no-op.
    const noop = await doc.updateChart(slide, chart, {
      kind: "line",
      series: [{ id: "s9", label: "Total", points: [{ x: 0, y: -3.5 }] }],
    });
    expect(noop.events).toHaveLength(0);

    // move/resize/rotate apply to data objects like media objects.
    await doc.moveObject(slide, chart, 55, 66);
    await doc.resizeObject(slide, table, 320, 210);
    await doc.rotateObject(slide, chart, 15);
    const moved = (await doc.describe<any>()).data.slides[0].objects;
    expect(moved.find((o: any) => o.id === chart)).toMatchObject({ x: 55, y: 66, rotation_deg: 15 });
    expect(moved.find((o: any) => o.id === table)).toMatchObject({ w: 320, h: 210 });

    // Undo covers the data ops (5 mutating ops after the adds: two spec
    // patches plus move/resize/rotate); removeObject drops objects entirely.
    for (let i = 0; i < 5; i++) await doc.undo();
    const undone = (await doc.describe<any>()).data.slides[0].objects;
    expect(undone.find((o: any) => o.id === chart).chart.kind).toBe("column");
    await doc.removeObject(slide, chart);
    await doc.removeObject(slide, table);
    expect((await doc.describe<any>()).data.slides[0].objects).toHaveLength(0);
    await doc.close();
  });

  it("rejects out-of-contract payloads without mutating the deck", async () => {
    const doc = await PitchDocument.open(host);
    const slide = (await doc.describe<any>()).data.slides[0].id as number;

    await expect(
      doc.addChart(slide, 0, 0, 100, 100, { kind: "pie" as never, series: [] }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.addChart(slide, 0, 0, 0, 100, CHART),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.addTable(slide, 0, 0, 100, 100, { rows: 2, cols: 2, cells: [{ row: 5, col: 0, value: "x" }] }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.addTable(slide, 0, 0, 100, 100, { rows: 2, cols: 2, cells: [
        { row: 0, col: 0, value: "a" },
        { row: 0, col: 0, value: "b" },
      ] }),
    ).rejects.toBeInstanceOf(EngineError);

    const text = (await doc.addText(slide, 0, 0, 50, 20, "plain")).data.object_id;
    await expect(doc.updateChart(slide, text, { kind: "line", series: CHART.series })).rejects.toBeInstanceOf(EngineError);
    await expect(doc.updateTable(slide, text, { rows: 2 })).rejects.toBeInstanceOf(EngineError);

    // The only surviving object is the text object; snapshots still match.
    const after = (await doc.describe<any>()).data.slides[0].objects;
    expect(after).toHaveLength(1);
    expect(after[0].kind).toBe("text");
    await doc.close();
  });

  it("round-trips chart and table data through save/reopen", async () => {
    const doc = await PitchDocument.open(host, "Charts");
    const slide = (await doc.describe<any>()).data.slides[0].id as number;
    await doc.addChart(slide, 10, 20, 400, 300, CHART);
    await doc.addTable(slide, 50, 60, 300, 200, TABLE);
    const bytes = await doc.save();
    await doc.close();

    const re = await PitchDocument.openSnapshot(host, bytes);
    const objects = (await re.describe<any>()).data.slides[0].objects;
    expect(objects.find((o: any) => o.kind === "chart").chart.series).toHaveLength(2);
    expect(objects.find((o: any) => o.kind === "table").table.cells).toHaveLength(3);
    const resaved = await re.save();
    expect(Buffer.from(resaved).equals(Buffer.from(bytes))).toBe(true);
    await re.close();
  });
});
