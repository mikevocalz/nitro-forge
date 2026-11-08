import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError, base64ToBytes } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PrismDocument, type StrokeSample } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

/** A straight stroke: `n` samples from (x0,y) stepping dx, 10ms apart (t in seconds). */
function line(n: number, x0: number, y: number, dx: number): StrokeSample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 0.01,
    x: x0 + i * dx,
    y,
    pressure: 0.8,
  }));
}

describe("prism brush/stroke ops e2e (real Rust via nf-cli)", () => {
  it("modelStroke is deterministic, read-only and bounded", async () => {
    const doc = await PrismDocument.open(host, 32, 32);
    const samples = line(20, 2, 16, 1.2);
    const a = await doc.modelStroke(samples, { predict: { steps: 4 } });
    const b = await doc.modelStroke(samples, { predict: { steps: 4 } });
    expect(a.data).toEqual(b.data);
    expect(a.data.modeled.length).toBeGreaterThan(20);
    expect(a.data.predicted).toHaveLength(4);
    expect(a.data.modeled[0]?.segment).toBe(0);
    // Read-only: nothing was journaled, so a mutating op is the only thing
    // an undo would restore — assert describe output is unchanged instead.
    const before = await doc.describe<any>();
    await doc.modelStroke(samples);
    const after = await doc.describe<any>();
    expect(after.data).toEqual(before.data);
    await expect(
      doc.modelStroke(Array.from({ length: 4097 }, (_, i) => ({ t: i * 0.001, x: i, y: 0 }))),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(doc.modelStroke([{ t: 0.02, x: 1, y: 1 }, { t: 0.01, x: 2, y: 1 }])).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("brush CRUD round-trips through describe, listBrushes and snapshots", async () => {
    const doc = await PrismDocument.open(host, 8, 8);
    const added = await doc.addBrush({ name: "Ink", size: 12, color: [10, 20, 30, 255] });
    const bid = added.data.brush_id;
    const listed = await doc.listBrushes();
    expect(listed.data.brushes).toHaveLength(1);
    expect(listed.data.brushes[0]).toMatchObject({ id: bid, name: "Ink", size: 12 });
    const desc = await doc.describe<any>();
    expect(desc.data.brushes).toHaveLength(1);
    const same = await doc.setBrush(bid, { size: 12 });
    expect(same.data.changed).toBe(false);
    const changed = await doc.setBrush(bid, { size: 30, taper: { start: 0.1, end: 0.1 } });
    expect(changed.data.changed).toBe(true);
    await expect(doc.setBrush(9999, { size: 5 })).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addBrush({ size: -1 })).rejects.toBeInstanceOf(EngineError);
    const bytes = await doc.save();
    await doc.close();
    const reopened = await PrismDocument.openSnapshot(host, bytes);
    const listed2 = await reopened.listBrushes();
    expect(listed2.data.brushes[0]).toMatchObject({ id: bid, size: 30 });
    await reopened.close();
  });

  it("paintStroke commits dabs, dry-run does not mutate, undo restores", async () => {
    const doc = await PrismDocument.open(host, 32, 32);
    const layer = (await doc.addRasterLayer("ink")).data.layer_id;
    const brush = (await doc.addBrush({ size: 8, color: [200, 10, 10, 255], spacing: 0.5 })).data.brush_id;
    const samples = line(10, 2, 16, 2);
    const dry = await doc.paintStroke({ id: layer, brush_id: brush, samples, commit: false });
    expect(dry.data.dabs).toBeGreaterThan(0);
    let flat = await doc.flatten();
    expect(base64ToBytes(flat.data.pixels_b64).every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
    const painted = await doc.paintStroke({ id: layer, brush_id: brush, samples });
    expect(painted.data.dabs).toBeGreaterThan(0);
    flat = await doc.flatten();
    const px = base64ToBytes(flat.data.pixels_b64);
    const at = (x: number, y: number): [number, number, number, number] => {
      const i = (y * 32 + x) * 4;
      return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0, px[i + 3] ?? 0];
    };
    const mid = at(12, 16);
    expect(mid[3]).toBeGreaterThan(0);
    expect(mid[0]).toBeGreaterThan(mid[1]); // red channel dominant
    expect(await doc.undo()).toBe(true);
    flat = await doc.flatten();
    expect(base64ToBytes(flat.data.pixels_b64).every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
    await doc.close();
  });

  it("paintStroke validates brush exclusivity, layers and budgets", async () => {
    const doc = await PrismDocument.open(host, 16, 16);
    const layer = (await doc.addRasterLayer()).data.layer_id;
    const shape = (await doc.addShape({
      kind: "rect", x: 0, y: 0, w: 4, h: 4, fill: [0, 0, 0, 255],
    })).data.layer_id;
    const samples = line(4, 1, 2, 1);
    await expect(doc.paintStroke({ id: layer, samples })).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.paintStroke({ id: layer, brush_id: 1, brush: { size: 4 }, samples }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.paintStroke({ id: layer, brush_id: 999, samples }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.paintStroke({ id: shape, brush: { size: 4 }, samples }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.paintStroke({ id: layer, brush: { size: 4 }, samples: [] }),
    ).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("taper reduces painted coverage deterministically", async () => {
    const doc = await PrismDocument.open(host, 48, 48);
    const layer = (await doc.addRasterLayer()).data.layer_id;
    const samples = line(20, 2, 24, 2);
    const countPainted = async () => {
      const flat = await doc.flatten();
      return base64ToBytes(flat.data.pixels_b64).filter((_, i) => i % 4 === 3 && _ > 0).length;
    };
    await doc.paintStroke({
      id: layer,
      brush: { size: 10, color: [0, 0, 0, 255], spacing: 0.4 },
      samples,
    });
    const plain = await countPainted();
    expect(plain).toBeGreaterThan(0);
    await doc.undo();
    await doc.paintStroke({
      id: layer,
      brush: { size: 10, color: [0, 0, 0, 255], spacing: 0.4, taper: { start: 0.3, end: 0.3 } },
      samples,
    });
    const tapered = await countPainted();
    expect(tapered).toBeLessThan(plain);
    await doc.close();
  });
});
