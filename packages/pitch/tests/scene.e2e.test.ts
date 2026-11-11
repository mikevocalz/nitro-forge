import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PitchDocument, type PitchScene } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("pitch slideScene (real Rust via nf-cli)", () => {
  it("describes chrome, z-ordered objects and payloads without mutating", async () => {
    const doc = await PitchDocument.open(host, "Scene");
    const slide = (await doc.describe<any>()).data.slides[0].id as number;
    const text = (await doc.addText(slide, 10, 20, 200, 40, "Title", 32)).data.object_id;
    const rect = (
      await doc.addRect(slide, 0, 0, 960, 540, [9, 8, 7, 255])
    ).data.object_id;
    const chart = (
      await doc.addChart(slide, 300, 100, 400, 200, {
        kind: "column",
        series: [{ id: "s1", label: "Rev", points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }],
      })
    ).data.object_id;
    await doc.setNotes(slide, "speaker note");
    await doc.setSlideTransition(slide, { kind: "fade", duration_ms: 400 });
    await doc.setSlideTiming(slide, { duration_ms: 5000, advance: "after" });
    await doc.addInkStroke(slide, {
      kind: "pen",
      points: [[0, 0], [1, 1]],
      width: 2,
      color: [0, 0, 0, 255],
    });

    const before = await doc.save();
    const scene = (await doc.slideScene(slide)).data as PitchScene;
    expect(await doc.save()).toEqual(before);

    expect(scene.slide).toBe(slide);
    expect(scene.index).toBe(0);
    expect(scene.size).toEqual({ width: 960, height: 540 });
    expect(scene.layout).toBe("blank");
    expect(scene.notes).toBe("speaker note");
    expect(scene.ink_count).toBe(1);
    expect(scene.transition).toMatchObject({ kind: "fade", duration_ms: 400 });
    expect(scene.timing).toMatchObject({ advance: "after" });
    expect(scene.schedule).toBeUndefined();
    expect(scene.animations).toEqual([]);

    expect(scene.objects.map((o) => o.id)).toEqual([text, rect, chart]);
    expect(scene.objects.map((o) => o.z)).toEqual([0, 1, 2]);
    const [title, backdrop, chartObj] = scene.objects;
    expect(title).toMatchObject({ kind: "text", x: 10, y: 20, rotation_deg: 0 });
    expect(title!.text).toMatchObject({ content: "Title", font_size: 32 });
    expect(backdrop!.fill).toEqual([9, 8, 7, 255]);
    expect(chartObj!.kind).toBe("chart");
    expect(chartObj!.chart).toMatchObject({ kind: "column" });
    expect(chartObj!.chart!.series[0]).toMatchObject({ id: "s1" });
    expect(title!.frame).toBeUndefined();
    await doc.close();
  });

  it("resolves animation frames at tS with explicit click history", async () => {
    const doc = await PitchDocument.open(host);
    const slide = (await doc.describe<any>()).data.slides[0].id as number;
    const object = (await doc.addRect(slide, 0, 0, 4, 4, [255, 0, 0, 255])).data.object_id;
    await doc.addAnimation(slide, object, "fadeIn", 0, 2, { type: "on-click", click_index: 0 });

    const pending = (await doc.slideScene(slide, { tS: 5 })).data;
    expect(pending.objects[0]!.frame!.opacity).toBe(0);
    expect(pending.schedule![0]!.start_s).toBeNull();

    const scene = (await doc.slideScene(slide, { tS: 2, clickTimes: [1] })).data;
    const at = (await doc.slideAt(slide, 2, [1])).data;
    expect(scene.objects[0]!.frame).toEqual(at.objects[0]);
    expect(scene.schedule).toEqual(at.schedule);
    // Static geometry stays alongside the evaluated frame.
    expect(scene.objects[0]!.x).toBe(0);
    expect(scene.objects[0]!.rotation_deg).toBe(0);
    expect(scene.animations).toHaveLength(1);
    expect(scene.animations[0]).toMatchObject({ object_id: object, kind: "fadeIn" });

    // clickTimes without tS rejects client-side; unknown slides reject engine-side.
    expect(() => doc.slideScene(slide, { clickTimes: [0] })).toThrow(RangeError);
    await expect(doc.slideScene(999999)).rejects.toThrow();
    await doc.close();
  });

  it("reports connector resolution and per-kind payloads", async () => {
    const doc = await PitchDocument.open(host);
    const slide = (await doc.describe<any>()).data.slides[0].id as number;
    const a = (await doc.addRect(slide, 10, 20, 100, 50, [0, 0, 0, 255])).data.object_id;
    const b = (await doc.addRect(slide, 300, 200, 80, 40, [0, 0, 0, 255])).data.object_id;
    const connector = (
      await doc.addConnector(
        slide,
        { type: "bound", object_id: a, side: "top" },
        { type: "bound", object_id: b, side: "left" },
      )
    ).data.object_id;
    const media = (
      await doc.addMedia(slide, 10, 20, 320, 180, { src: "clip.mp4", kind: "video" })
    ).data.object_id;

    const scene = (await doc.slideScene(slide)).data;
    const conn = scene.objects.find((o) => o.id === connector)!;
    expect(conn.kind).toBe("connector");
    expect(conn.resolved!.points).toEqual([[60, 20], [300, 220]]);
    const clip = scene.objects.find((o) => o.id === media)!;
    expect(clip.kind).toBe("media");
    expect(clip.media).toMatchObject({ src: "clip.mp4", kind: "video" });
    await doc.close();
  });
});
