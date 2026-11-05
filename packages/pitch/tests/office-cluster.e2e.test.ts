import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PitchDocument } from "../src/index";
import { bindPitchAnimations, bindPitchCanvas, bindPitchSlideList, readPitchDeck, readPitchSlideAt, type PitchSlideListBinding, type PitchCanvasBinding } from "../src/office-cluster";

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

describe("real Rust Pitch engine behind the NYC-Tron slide controls", () => {
  it("drives the filmstrip and sorter: add, reorder, remove, engine refusal", async () => {
    const doc = await PitchDocument.open(host, "Board");
    try {
      let latest: PitchSlideListBinding | undefined;
      const first = await bindPitchSlideList(doc, next => { latest = next; });
      expect(first.slides).toHaveLength(1);
      await first.onAdd();
      await latest!.onAdd();
      const ids = latest!.slides.map(s => s.id);
      expect(ids).toHaveLength(3);
      await latest!.onReorder([ids[2]!, ids[0]!, ids[1]!]);
      expect(latest!.slides.map(s => s.id)).toEqual([ids[2], ids[0], ids[1]]);
      await doc.undo();
      expect((await readPitchDeck(doc)).slides.map(s => s.id)).toEqual(ids);
      await doc.redo();
      await latest!.onMove(ids[2]!, 2);
      expect(latest!.slides.map(s => s.id)).toEqual([ids[0], ids[1], ids[2]]);
      await latest!.onRemoveMany([ids[1]!, ids[2]!]);
      expect(latest!.slides.map(s => s.id)).toEqual([ids[0]]);
      await doc.undo();
      expect((await readPitchDeck(doc)).slides.map(s => s.id)).toEqual(ids);
      await doc.redo();
      const before = latest!;
      await expect(before.onRemove(ids[0]!)).rejects.toThrow(/at least one slide/);
      expect(latest).toBe(before);
    } finally {
      await doc.close();
    }
  });

  it("drives the canvas and animation pane, and previews with slideAt", async () => {
    const doc = await PitchDocument.open(host, "Board");
    try {
      const slide = String((await doc.addSlide("blank")).data.slide_id);
      const box = String((await doc.addRect(Number(slide), 100, 100, 200, 100, [200, 74, 40, 255])).data.object_id);
      const title = String((await doc.addText(Number(slide), 40, 20, 600, 60, "Ridership", 40)).data.object_id);
      let canvas: PitchCanvasBinding | undefined;
      const c = await bindPitchCanvas(doc, slide, next => { canvas = next; });
      await c.onMoveObject(box, 200, 120);
      await canvas!.onResizeObject(box, 90, 310);
      await canvas!.onRotateObject(box, 15);
      await canvas!.onSetText(title, "Ridership since launch");
      expect(canvas!.slide.objects.find(o => o.id === box)).toMatchObject({ x: 200, y: 120, w: 90, h: 310, rotation: 15 });
      expect(canvas!.slide.objects.find(o => o.id === title)).toMatchObject({ text: "Ridership since launch", fontSize: 40 });
      await expect(canvas!.onResizeObject(box, 0, 10)).rejects.toThrow(/must be > 0/);

      let pane = await bindPitchAnimations(doc, slide, next => { pane = next; });
      await pane.onAdd({ objectId: box, kind: "zoomIn", startS: 0.5, durationS: 1 });
      expect(pane.animations).toEqual([{ index: 0, objectId: box, kind: "zoomIn", startS: 0.5, durationS: 1 }]);
      const mid = await readPitchSlideAt(doc, slide, 1);
      const o = mid.objects.find(x => x.id === box)!;
      expect(o.opacity).toBeGreaterThan(0);
      expect(o.opacity).toBeLessThan(1);
      expect(o.w).toBeLessThan(90);
      await canvas!.onRemoveObject(box);
      expect((await readPitchDeck(doc)).animations[slide]).toEqual([]);
    } finally {
      await doc.close();
    }
  });
});
