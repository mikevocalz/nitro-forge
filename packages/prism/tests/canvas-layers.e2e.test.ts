import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError, base64ToBytes } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { BLEND_MODES, OPS, PrismDocument, type Rgba } from "../src/index";

// Real Rust through nf-cli: each op is checked for its effect and for one
// undo step, and rejections are checked to leave the document unchanged.

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

async function pixel(doc: PrismDocument, w: number, x: number, y: number) {
  const px = base64ToBytes((await doc.flatten()).data.pixels_b64);
  const i = (y * w + x) * 4;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
}
const describeDoc = async (doc: PrismDocument) => (await doc.describe<any>()).data;

describe("prism canvas/layers ops e2e (real Rust via nf-cli)", () => {
  it("exposes every op name once", () => {
    const names = Object.values(OPS);
    expect(new Set(names).size).toBe(names.length);
    expect(BLEND_MODES).toContain("color-dodge");
  });

  it("transforms, aligns and undoes in single steps", async () => {
    const doc = await PrismDocument.open(host, 20, 10);
    const a = (await doc.addShape({ kind: "rect", x: 0, y: 0, w: 2, h: 2, fill: RED })).data.layer_id;
    const b = (await doc.addShape({ kind: "rect", x: 10, y: 5, w: 2, h: 2, fill: BLUE })).data.layer_id;
    await doc.translateLayers([a, b], 1, 1);
    expect(await pixel(doc, 20, 1, 1)).toEqual(RED);
    await doc.alignLayers([a, b], "top");
    const bounds = (await doc.layerBounds([a, b])).data.bounds as any[];
    expect(bounds.map(r => r.y)).toEqual([1, 1]);
    expect(await doc.undo()).toBe(true);
    expect(((await doc.layerBounds([b])).data.bounds[0] as any).y).toBe(6);
    expect((await doc.hitTest(11, 6)).data.layer_id).toBe(b);
    await expect(doc.setLayerTransform(a, { sx: 0 })).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("selects regions, runs the magic wand and fills inside the selection", async () => {
    const doc = await PrismDocument.open(host, 6, 1);
    const l = (await doc.addRasterLayer("paint")).data.layer_id;
    await doc.drawPixels(l, 3, 0, 1, 1, new Uint8Array(RED));
    await doc.selectRegion({ kind: "rect", x: 0, y: 0, w: 2, h: 1 });
    const fill = await doc.floodFill(l, { x: 0, y: 0, color: BLUE, tolerance: 0 });
    expect(fill.data.filled).toBe(2);
    expect(await pixel(doc, 6, 1, 0)).toEqual(BLUE);
    expect((await pixel(doc, 6, 2, 0))[3]).toBe(0);
    await doc.magicWand({ x: 3, y: 0, tolerance: 0 });
    const sel = (await doc.getSelection()).data;
    expect("bounds" in sel && sel.bounds).toEqual({ x: 3, y: 0, w: 1, h: 1 });
    await doc.deselect();
    expect((await doc.getSelection()).data).toEqual({ empty: true });
    await doc.close();
  });

  it("groups, locks, blends and clips", async () => {
    const doc = await PrismDocument.open(host, 4, 1);
    const base = (await doc.addShape({ kind: "rect", x: 0, y: 0, w: 2, h: 1, fill: RED })).data.layer_id;
    const top = (await doc.addRasterLayer()).data.layer_id;
    await doc.fillLayer(top, BLUE);
    await doc.setClipped(top, true);
    expect(await pixel(doc, 4, 0, 0)).toEqual(BLUE);
    expect((await pixel(doc, 4, 3, 0))[3]).toBe(0);
    await doc.setLayerBlend(top, "multiply");
    expect(await pixel(doc, 4, 0, 0)).toEqual([0, 0, 0, 255]);
    const g = (await doc.groupLayers([base, top], "card")).data.layer_id;
    await doc.setLayerLocked(g, true);
    await expect(doc.fillLayer(top, RED)).rejects.toThrow(/locked/);
    const desc = await describeDoc(doc);
    expect(desc.layers.find((x: any) => x.id === top).parent).toBe(g);
    await doc.close();
  });

  it("masks, thumbnails and artboards", async () => {
    const doc = await PrismDocument.open(host, 8, 4);
    const l = (await doc.addRasterLayer()).data.layer_id;
    await doc.fillLayer(l, RED);
    await doc.addMask(l, "reveal");
    await doc.paintMask(l, 0, 0, 4, 4, new Uint8Array(16));
    expect((await pixel(doc, 8, 1, 1))[3]).toBe(0);
    await doc.invertMask(l);
    expect(await pixel(doc, 8, 1, 1)).toEqual(RED);
    const mt = (await doc.maskThumbnail(l, 4)).data;
    expect([mt.width, mt.height]).toEqual([4, 2]);
    const thumb = (await doc.layerThumbnail(l, 2)).data;
    expect([thumb.width, thumb.height]).toEqual([2, 1]);
    const art = (await doc.addArtboard({ x: 4, y: 0, w: 4, h: 4 }, "Back")).data.artboard_id;
    await doc.updateArtboard(art, { name: "Cover" });
    expect((await describeDoc(doc)).artboards[0].name).toBe("Cover");
    expect((await doc.artboardThumbnail(art, 4)).data.width).toBe(4);
    await expect(doc.addMask(l)).rejects.toThrow(/already has a mask/);
    await doc.close();
  });

  it("edits paths, gradients and editable booleans", async () => {
    const doc = await PrismDocument.open(host, 10, 4);
    const p = (await doc.addPath(
      [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }] }],
      { fill: { type: "solid", color: RED } },
    )).data.layer_id;
    await doc.setPathNode(p, 0, 1, { x: 4, y: 0 });
    await doc.setStroke(p, { paint: { type: "solid", color: BLUE }, width: 1, join: "round", dash: [2, 1] });
    await doc.setFill(p, {
      type: "linear", x0: 0, y0: 0, x1: 6, y1: 0,
      stops: [{ offset: 0, color: [0, 0, 0, 255] }, { offset: 1, color: [240, 0, 0, 255] }],
    });
    const q = (await doc.addShape({ kind: "rect", x: 4, y: 0, w: 6, h: 4, fill: BLUE })).data.layer_id;
    await doc.setStroke(p, null);
    const bo = (await doc.booleanLayers([p, q], "union")).data.layer_id;
    expect((await pixel(doc, 10, 9, 2))[3]).toBe(255);
    await doc.setBooleanOp(bo, "intersect");
    expect((await pixel(doc, 10, 9, 2))[3]).toBe(0);
    await doc.rasterizeLayer(bo);
    const desc = await describeDoc(doc);
    expect(desc.layers).toHaveLength(1);
    expect(desc.layers[0].content.type).toBe("raster");
    await expect(doc.setPathNode(p, 0, 0, { x: 0, y: 0 })).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("crops the document with intersection semantics and samples pixels", async () => {
    const doc = await PrismDocument.open(host, 8, 8);
    const l = (await doc.addRasterLayer("paint")).data.layer_id;
    await doc.fillLayer(l, RED);
    await doc.addShape({ kind: "rect", x: 4, y: 5, w: 2, h: 2, fill: BLUE });
    await doc.selectAll();
    // Eyedropper reads the composite before the crop.
    expect((await doc.samplePixels(5, 6)).data).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    expect((await doc.samplePixels(0, 0)).data).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect((await doc.samplePixels(50, 0)).data).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    // Crop (2,1,5,6) keeps the overlap; content is preserved.
    await doc.crop({ x: 2, y: 1, w: 5, h: 6 });
    const desc = await describeDoc(doc);
    expect(desc.width).toBe(5);
    expect(desc.height).toBe(6);
    expect((await doc.samplePixels(3, 5)).data).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    const sel = (await doc.getSelection()).data as any;
    expect(sel.width).toBe(5);
    expect(sel.height).toBe(6);
    // One undo restores the 8x8 document.
    expect(await doc.undo()).toBe(true);
    expect((await describeDoc(doc)).width).toBe(8);
    await expect(doc.crop({ x: 100, y: 0, w: 4, h: 4 })).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("smooths a selection edge in one undo step", async () => {
    const doc = await PrismDocument.open(host, 10, 10);
    await doc.selectRegion({ kind: "rect", x: 2, y: 2, w: 6, h: 6 });
    await doc.modifySelection("smooth", 3);
    const sel = (await doc.getSelection()).data as any;
    const mask = base64ToBytes(sel.mask_b64);
    expect(mask.every((v) => v === 0 || v === 255)).toBe(true);
    expect(mask[5 * 10 + 5]).toBe(255);
    expect(mask[2 * 10 + 2]).toBe(0);
    expect(await doc.undo()).toBe(true);
    await doc.close();
  });

  it("duplicates a layer and a whole group subtree", async () => {
    const doc = await PrismDocument.open(host, 8, 8);
    const a = (await doc.addShape({ kind: "rect", x: 0, y: 0, w: 4, h: 4, fill: RED })).data.layer_id;
    const b = (await doc.addShape({ kind: "ellipse", x: 2, y: 2, w: 4, h: 4, fill: BLUE })).data.layer_id;
    const g = (await doc.groupLayers([a, b], "art")).data.layer_id;
    const dg = (await doc.duplicateLayer(g)).data.layer_id;
    const desc = await describeDoc(doc);
    const kids = desc.layers.filter((x: any) => x.parent === dg);
    expect(kids).toHaveLength(2);
    expect(desc.layers.find((x: any) => x.id === dg).name).toBe("art copy");
    expect(desc.layers.find((x: any) => x.id === dg).parent).toBeNull();
    // One undo removes the whole copied subtree.
    expect(await doc.undo()).toBe(true);
    expect((await describeDoc(doc)).layers).toHaveLength(3);
    await doc.close();
  });

  it("round-trips the new state through save and reopen", async () => {
    const doc = await PrismDocument.open(host, 6, 6);
    const a = (await doc.addShape({ kind: "ellipse", x: 0, y: 0, w: 6, h: 6, fill: RED })).data.layer_id;
    await doc.setLayerTransform(a, { rotation: 45 });
    await doc.addMask(a);
    await doc.selectAll();
    await doc.addArtboard({ x: 0, y: 0, w: 3, h: 3 });
    const before = await describeDoc(doc);
    const bytes = await doc.save();
    await doc.close();
    const reopened = await PrismDocument.openSnapshot(host, bytes);
    expect(await describeDoc(reopened)).toEqual(before);
    await reopened.close();
  });
});
