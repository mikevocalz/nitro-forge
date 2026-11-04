import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError, base64ToBytes } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PrismDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("prism engine e2e (real Rust via nf-cli)", () => {
  it("creates layers, paints pixels, flattens", async () => {
    const doc = await PrismDocument.open(host, 4, 4);
    const layer = (await doc.addRasterLayer("paint")).data.layer_id;
    // paint one opaque red pixel at (1,1)
    await doc.drawPixels(layer, 1, 1, 1, 1, new Uint8Array([255, 0, 0, 255]));
    const flat = await doc.flatten();
    const px = base64ToBytes(flat.data.pixels_b64);
    expect(px.length).toBe(4 * 4 * 4);
    const i = (1 * 4 + 1) * 4;
    expect([px[i], px[i + 1], px[i + 2], px[i + 3]]).toEqual([255, 0, 0, 255]);
    await doc.close();
  });

  it("round-trips save/reopen with layers intact", async () => {
    const doc = await PrismDocument.open(host, 8, 8);
    const l = (await doc.addRasterLayer("bg")).data.layer_id;
    await doc.fillLayer(l, [0, 0, 255, 255]);
    const bytes = await doc.save();
    await doc.close();

    const reopened = await PrismDocument.openSnapshot(host, bytes);
    const desc = await reopened.describe<any>();
    expect(desc.data.layers).toHaveLength(1);
    const flat = await reopened.flatten();
    const px = base64ToBytes(flat.data.pixels_b64);
    expect([px[0], px[1], px[2], px[3]]).toEqual([0, 0, 255, 255]);
    await reopened.close();
  });

  it("undo restores pixel region", async () => {
    const doc = await PrismDocument.open(host, 2, 2);
    const l = (await doc.addRasterLayer()).data.layer_id;
    await doc.fillLayer(l, [10, 20, 30, 255]);
    expect(await doc.undo()).toBe(true);
    const flat = await doc.flatten();
    const px = base64ToBytes(flat.data.pixels_b64);
    expect(px[3]).toBe(0); // back to transparent
    await doc.close();
  });

  it("rejects ops on missing layers and bad opacity", async () => {
    const doc = await PrismDocument.open(host, 2, 2);
    await expect(doc.removeLayer(999)).rejects.toBeInstanceOf(EngineError);
    const l = (await doc.addRasterLayer()).data.layer_id;
    await expect(doc.setLayerOpacity(l, 2)).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });
});

// Typed public API, real Rust host, one history entry and durable layer identity.
it("edits an existing shape fill and preserves it through undo/redo and reopen", async () => {
  const doc = await PrismDocument.open(host, 4, 4);
  const id = (await doc.addShape({ kind: "rect", x: 0, y: 0, w: 4, h: 4, fill: [255, 0, 0, 255] }, "Shape")).data.layer_id;
  const before = await doc.save();
  await doc.setShapeFill(id, [0, 128, 255, 255]);
  expect(Array.from(base64ToBytes((await doc.flatten()).data.pixels_b64).slice(0, 4))).toEqual([0, 128, 255, 255]);
  const after = await doc.save();
  expect(await doc.undo()).toBe(true);
  expect(await doc.save()).toEqual(before);
  await expect(doc.setShapeFill(id, [0, 0, 256, 255])).rejects.toBeInstanceOf(EngineError);
  expect(await doc.save()).toEqual(before);
  expect(await doc.redo()).toBe(true);
  expect(await doc.save()).toEqual(after);
  const reopened = await PrismDocument.openSnapshot(host, after);
  const layer = (await reopened.getLayer(id)).data as { id: number; name: string };
  expect(layer.id).toBe(id);
  expect(layer.name).toBe("Shape");
  expect((await reopened.flatten()).data).toEqual((await doc.flatten()).data);
  await reopened.close();
  await doc.close();
});
