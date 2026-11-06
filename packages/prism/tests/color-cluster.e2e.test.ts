import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { OPS, PrismDocument } from "../src/index";
import {
  PRISM_COLOR_DEFERRED_OPS,
  commitPrismFill,
  PRISM_COLOR_OPS,
  bindPrismColors,
  fromEngineColor,
  readPrismColors,
  toEngineColor,
  type PrismColorBinding,
} from "../src/color-cluster";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

const RED = { r: 255, g: 0, b: 0, alpha: 1 };

describe("prism color cluster (real Rust via nf-cli)", () => {
  it("commits a picked color to the document, re-reads, and undoes in one step", async () => {
    const doc = await PrismDocument.open(host, 4, 4);
    const seen: PrismColorBinding[] = [];
    const colors = bindPrismColors(doc, (b) => seen.push(b));
    const after = await colors.commit("foreground", RED);
    expect(after.pair.foreground).toEqual(RED);
    expect(after.recent).toEqual([RED]);
    expect(seen).toHaveLength(1);

    const desc = await doc.describe<{ colors: { foreground: number[] } }>();
    expect(desc.data.colors.foreground).toEqual([255, 0, 0, 255]);

    expect(await doc.undo()).toBe(true);
    expect((await readPrismColors(doc)).pair.foreground).toEqual({ r: 0, g: 0, b: 0, alpha: 1 });
    await doc.close();
  });

  it("swap, reset and clearRecent are engine writes that survive save/reopen", async () => {
    const doc = await PrismDocument.open(host, 4, 4);
    const colors = bindPrismColors(doc, () => {});
    await colors.commit("background", { r: 10, g: 20, b: 30, alpha: 0.5 });
    const swapped = await colors.swap();
    expect(swapped.pair.foreground).toEqual({ r: 10, g: 20, b: 30, alpha: 0.502 });
    const bytes = await doc.save();
    await doc.close();

    const reopened = await PrismDocument.openSnapshot(host, bytes);
    const again = bindPrismColors(reopened, () => {});
    expect((await readPrismColors(reopened)).pair.background).toEqual({ r: 0, g: 0, b: 0, alpha: 1 });
    const reset = await again.reset();
    expect(reset.pair.foreground).toEqual({ r: 0, g: 0, b: 0, alpha: 1 });
    expect(reset.pair.background).toEqual({ r: 255, g: 255, b: 255, alpha: 1 });
    expect((await again.clearRecent()).recent).toEqual([]);
    await reopened.close();
  });

  it("rejects bad colors before calling the engine and leaves state intact", async () => {
    const doc = await PrismDocument.open(host, 4, 4);
    const colors = bindPrismColors(doc, () => {});
    await expect(colors.commit("foreground", { r: 256, g: 0, b: 0, alpha: 1 })).rejects.toBeInstanceOf(RangeError);
    await expect(doc.setColors({ foreground: [1, 2, 3, 999] as never })).rejects.toBeInstanceOf(EngineError);
    const after = await readPrismColors(doc);
    expect(after.pair.foreground).toEqual({ r: 0, g: 0, b: 0, alpha: 1 });
    expect(after.recent).toEqual([]);
    await doc.close();
  });

  it("only calls real ops, and deferred ops are absent from OPS", () => {
    const real = new Set<string>(Object.values(OPS));
    for (const op of PRISM_COLOR_OPS) expect(real.has(op)).toBe(true);
    for (const op of Object.keys(PRISM_COLOR_DEFERRED_OPS)) expect(real.has(op)).toBe(false);
  });

  it("converts alpha between 0..1 and 0..255", () => {
    expect(toEngineColor({ r: 1, g: 2, b: 3, alpha: 0.5 })).toEqual([1, 2, 3, 128]);
    expect(fromEngineColor([1, 2, 3, 255])).toEqual({ r: 1, g: 2, b: 3, alpha: 1 });
    expect(() => toEngineColor({ r: 1.5, g: 0, b: 0, alpha: 1 })).toThrow(RangeError);
  });
});

it('new canvas preserves the palette through undo/redo and fill commits',async()=>{
 const doc=await PrismDocument.open(host,8,8);try{
 const layer=(await doc.addShape({kind:'rect',x:1,y:1,w:3,h:3,fill:[1,2,3,255]})).data.layer_id;
 await doc.setColors({foreground:[20,30,40,255]});const before=(await doc.describe()).data;
 await doc.handle.apply('new',{width:4,height:4});expect((await doc.getColors()).data.foreground).toEqual([20,30,40,255]);
 await doc.undo();expect((await doc.describe()).data).toEqual(before);await doc.redo();expect((await doc.getColors()).data.foreground).toEqual([20,30,40,255]);await doc.undo();
 await commitPrismFill(doc,layer,{r:255,g:0,b:0,alpha:1});await doc.undo();expect((await doc.describe()).data).toEqual(before);
 }finally{await doc.close();}
});
