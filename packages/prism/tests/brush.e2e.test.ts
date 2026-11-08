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

  it("eraseStroke pixel mode reduces alpha, honors selection, undoes", async () => {
    const doc = await PrismDocument.open(host, 32, 32);
    const layer = (await doc.addRasterLayer("ink")).data.layer_id;
    const samples = line(10, 2, 16, 2);
    await doc.paintStroke({
      id: layer,
      brush: { size: 8, color: [200, 10, 10, 255], spacing: 0.5 },
      samples,
    });
    const before = await doc.flatten();
    const bp = base64ToBytes(before.data.pixels_b64);
    const at = (buf: Uint8Array, x: number, y: number) => {
      const i = (y * 32 + x) * 4;
      return [buf[i] ?? 0, buf[i + 1] ?? 0, buf[i + 2] ?? 0, buf[i + 3] ?? 0] as const;
    };
    expect(at(bp, 12, 16)[3]).toBeGreaterThan(200);
    // Restrict erasing to x < 20; the stroke spans x 2..20.
    await doc.selectRegion({ kind: "rect", x: 0, y: 0, w: 20, h: 32 });
    const dry = await doc.eraseStroke({
      id: layer,
      brush: { size: 10, color: [0, 0, 0, 255], spacing: 0.5 },
      samples,
      commit: false,
    });
    expect(dry.data.dabs).toBeGreaterThan(0);
    expect(dry.data.mode).toBe("pixel");
    const erased = await doc.eraseStroke({
      id: layer,
      brush: { size: 10, color: [0, 0, 0, 255], spacing: 0.5 },
      samples,
    });
    expect(erased.data.mode).toBe("pixel");
    const after = await doc.flatten();
    const ap = base64ToBytes(after.data.pixels_b64);
    // Inside the selection alpha dropped; outside it is untouched.
    expect(at(ap, 8, 16)[3]).toBeLessThan(at(bp, 8, 16)[3]);
    expect(at(ap, 20, 16)[3]).toBe(at(bp, 20, 16)[3]);
    expect(await doc.undo()).toBe(true);
    const restored = await doc.flatten();
    expect(base64ToBytes(restored.data.pixels_b64)).toEqual(bp);
    await doc.close();
  });

  it("eraseStroke mask mode erases mask alpha and stays eventless on empty masks", async () => {
    const doc = await PrismDocument.open(host, 16, 16);
    const layer = (await doc.addRasterLayer()).data.layer_id;
    await doc.fillLayer(layer, [10, 200, 10, 255]);
    await doc.addMask(layer, "reveal");
    const samples = line(8, 2, 8, 2);
    const out = await doc.eraseStroke({
      id: layer,
      mode: "mask",
      brush: { size: 8, color: [0, 0, 0, 255], spacing: 0.5 },
      samples,
    });
    expect(out.data.mode).toBe("mask");
    expect(out.data.dabs).toBeGreaterThan(0);
    const desc = await doc.describe<any>();
    const lyr = desc.data.layers.find((l: any) => l.id === layer);
    const mask = base64ToBytes(lyr.mask.mask_b64);
    expect(mask[8 * 16 + 6]).toBeLessThan(255);
    expect(mask[2 * 16 + 2]).toBe(255);
    // Flattened composite follows the mask.
    const flat = await doc.flatten();
    const px = base64ToBytes(flat.data.pixels_b64);
    expect(px[(8 * 16 + 6) * 4 + 3]).toBeLessThan(255);
    // Zero the mask, then erase: provably nothing changes → still ok, and
    // undo must not have recorded the no-op (describe equality check via
    // snapshot bytes is overkill; undo restores the pre-zero state).
    const zero = new Uint8Array(16 * 16);
    await doc.paintMask(layer, 0, 0, 16, 16, zero, "replace");
    const before = await doc.describe<any>();
    const noop = await doc.eraseStroke({
      id: layer,
      mode: "mask",
      brush: { size: 8, color: [0, 0, 0, 255], spacing: 0.5 },
      samples,
    });
    expect(noop.data.dabs).toBeGreaterThan(0);
    const after = await doc.describe<any>();
    expect(after.data).toEqual(before.data);
    await doc.close();
  });

  it("eraseStroke vector mode removes whole entities intersecting the footprint", async () => {
    const doc = await PrismDocument.open(host, 32, 32);
    const hit = (await doc.addShape({
      kind: "rect", x: 2, y: 2, w: 8, h: 8, fill: [200, 10, 10, 255],
    })).data.layer_id;
    const miss = (await doc.addShape({
      kind: "rect", x: 20, y: 20, w: 8, h: 8, fill: [10, 10, 200, 255],
    })).data.layer_id;
    const samples = line(8, 3, 6, 1);
    const brush = { size: 6, color: [0, 0, 0, 255] as [number, number, number, number], spacing: 0.5 };
    // Dry run reports the would-be removal without mutating.
    const dry = await doc.eraseStroke({ mode: "vector", brush, samples, commit: false });
    expect(dry.data.mode).toBe("vector");
    expect(dry.data.dabs).toBeGreaterThan(0);
    expect(dry.data.removed).toEqual([hit]);
    let desc = await doc.describe<any>();
    expect(desc.data.layers.map((l: any) => l.id)).toContain(hit);
    // Commit removes only the hit entity; undo restores it.
    const out = await doc.eraseStroke({ mode: "vector", brush, samples });
    expect(out.data.removed).toEqual([hit]);
    desc = await doc.describe<any>();
    const ids = desc.data.layers.map((l: any) => l.id);
    expect(ids).not.toContain(hit);
    expect(ids).toContain(miss);
    expect(await doc.undo()).toBe(true);
    desc = await doc.describe<any>();
    expect(desc.data.layers.map((l: any) => l.id)).toContain(hit);
    // A stroke missing every entity is eventless: describe unchanged.
    const before = await doc.describe<any>();
    const noop = await doc.eraseStroke({
      mode: "vector",
      brush: { size: 4, color: [0, 0, 0, 255] },
      samples: line(4, 24, 31, 1),
    });
    expect(noop.data.removed).toEqual([]);
    expect((await doc.describe<any>()).data).toEqual(before.data);
    await doc.close();
  });

  it("eraseStroke validates modes, layers, brushes and budgets", async () => {
    const doc = await PrismDocument.open(host, 16, 16);
    const layer = (await doc.addRasterLayer()).data.layer_id;
    const shape = (await doc.addShape({
      kind: "rect", x: 0, y: 0, w: 4, h: 4, fill: [0, 0, 0, 255],
    })).data.layer_id;
    const samples = line(4, 1, 2, 1);
    // Vector mode rejects a non-u64 scope id.
    await expect(
      doc.eraseStroke({ id: "x" as any, mode: "vector", brush: { size: 4 }, samples }),
    ).rejects.toBeInstanceOf(EngineError);
    // Pixel mode rejects non-raster layers; mask mode requires a mask.
    await expect(
      doc.eraseStroke({ id: shape, brush: { size: 4 }, samples }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.eraseStroke({ id: layer, mode: "mask", brush: { size: 4 }, samples }),
    ).rejects.toBeInstanceOf(EngineError);
    // Same brush contract as paintStroke.
    await expect(doc.eraseStroke({ id: layer, samples })).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.eraseStroke({ id: layer, brush_id: 1, brush: { size: 4 }, samples }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.eraseStroke({ id: layer, brush_id: 999, samples }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.eraseStroke({ id: layer, brush: { size: 4 }, samples: [] }),
    ).rejects.toBeInstanceOf(EngineError);
    // Erase on an empty layer is eventless: describe unchanged.
    const before = await doc.describe<any>();
    const noop = await doc.eraseStroke({
      id: layer, brush: { size: 6, color: [0, 0, 0, 255] }, samples,
    });
    expect(noop.data.dabs).toBeGreaterThan(0);
    const after = await doc.describe<any>();
    expect(after.data).toEqual(before.data);
    await doc.close();
  });
});
