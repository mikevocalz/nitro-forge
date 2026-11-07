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

describe("pitch engine e2e (real Rust via nf-cli)", () => {
  it("builds slides and resolves animation timing", async () => {
    const doc = await PitchDocument.open(host, "Demo");
    const slide = (await doc.addSlide("titleBody")).data.slide_id;
    const title = (
      await doc.addText(slide, 100, 60, 400, 60, "Hello", 44)
    ).data.object_id;
    await doc.addAnimation(slide, title, "fadeIn", 0, 1);

    const before = await doc.slideAt(slide, -0.1);
    expect(before.data.objects.find((o) => o.id === title)!.opacity).toBe(0);
    const during = await doc.slideAt(slide, 0.5);
    const mid = during.data.objects.find((o) => o.id === title)!.opacity;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    const after = await doc.slideAt(slide, 2);
    expect(after.data.objects.find((o) => o.id === title)!.opacity).toBe(1);
    await doc.close();
  });

  it("save/reopen preserves deck", async () => {
    const doc = await PitchDocument.open(host, "Q4");
    const s = (await doc.addSlide("title")).data.slide_id;
    await doc.addText(s, 0, 0, 500, 80, "Revenue", 36);
    const bytes = await doc.save();
    await doc.close();

    const re = await PitchDocument.openSnapshot(host, bytes);
    const deck = await re.deck();
    expect(deck.data.title).toBe("Q4");
    expect(deck.data.slide_count).toBe(2);
    await re.close();
  });

  it("enforces the at-least-one-slide rule and object validation", async () => {
    const doc = await PitchDocument.open(host);
    const deck = await doc.deck();
    const only = (await doc.describe<any>()).data.slides[0].id;
    await expect(doc.removeSlide(only)).rejects.toBeInstanceOf(EngineError);
    expect(deck.data.slide_count).toBe(1);
    await doc.close();
  });

  it("undo restores removed objects", async () => {
    const doc = await PitchDocument.open(host);
    const slide = (await doc.describe<any>()).data.slides[0].id;
    const o = (await doc.addRect(slide, 10, 10, 100, 50, [255, 0, 0, 255])).data
      .object_id;
    await doc.removeObject(slide, o);
    expect(await doc.undo()).toBe(true);
    const at = await doc.slideAt(slide, 0);
    expect(at.data.objects.some((x) => x.id === o)).toBe(true);
    await doc.close();
  });

  it("speaker notes set/read/clear and persist through snapshots", async () => {
    const doc = await PitchDocument.open(host, "Notes");
    const slide = (await doc.describe<any>()).data.slides[0].id;
    expect((await doc.slideNotes(slide)).data.notes).toBeNull();
    await doc.setNotes(slide, "remember the demo");
    expect((await doc.slideNotes(slide)).data.notes).toBe("remember the demo");
    const described = await doc.describe<any>();
    expect(described.data.slides[0].notes).toBe("remember the demo");

    const bytes = await doc.save();
    const re = await PitchDocument.openSnapshot(host, bytes);
    expect((await re.slideNotes(slide)).data.notes).toBe("remember the demo");

    await re.setNotes(slide, "");
    expect((await re.slideNotes(slide)).data.notes).toBeNull();
    await re.undo();
    expect((await re.slideNotes(slide)).data.notes).toBe("remember the demo");
    await expect(
      re.setNotes(slide, "x".repeat(32769)),
    ).rejects.toThrow();
    await re.close();
    await doc.close();
  });

  it("ink strokes persist through snapshots with undo and bounds", async () => {
    const doc = await PitchDocument.open(host, "Ink");
    const slide = (await doc.describe<any>()).data.slides[0].id;
    expect((await doc.slideInk(slide)).data.strokes).toEqual([]);

    const strokeId = (
      await doc.addInkStroke(slide, {
        kind: "pen",
        points: [
          [10, 20],
          [30, 40],
        ],
        width: 4,
        color: [255, 0, 0, 200],
      })
    ).data.stroke_id;
    await doc.updateInkStroke(slide, strokeId, {
      kind: "highlighter",
      width: 12,
      opacity: 0.5,
    });
    const strokes = (await doc.slideInk(slide)).data.strokes;
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!).toMatchObject({
      id: strokeId,
      kind: "highlighter",
      width: 12,
      opacity: 0.5,
      points: [
        [10, 20],
        [30, 40],
      ],
    });
    expect((await doc.describe<any>()).data.slides[0].ink).toHaveLength(1);

    const bytes = await doc.save();
    const re = await PitchDocument.openSnapshot(host, bytes);
    expect((await re.slideInk(slide)).data.strokes[0]!.id).toBe(strokeId);

    await re.removeInkStroke(slide, strokeId);
    expect((await re.slideInk(slide)).data.strokes).toEqual([]);
    await re.undo();
    expect((await re.slideInk(slide)).data.strokes).toHaveLength(1);
    await re.clearInk(slide);
    expect((await re.slideInk(slide)).data.strokes).toEqual([]);

    await expect(
      re.addInkStroke(slide, {
        kind: "marker" as never,
        points: [[0, 0]],
        width: 1,
        color: [0, 0, 0, 255],
      }),
    ).rejects.toThrow();
    await expect(
      re.addInkStroke(slide, {
        kind: "pen",
        points: [],
        width: 1,
        color: [0, 0, 0, 255],
      }),
    ).rejects.toThrow();
    await re.close();
    await doc.close();
  });

  it("slide transitions and rehearsal timing persist through snapshots", async () => {
    const doc = await PitchDocument.open(host, "Transitions");
    const slide = (await doc.describe<any>()).data.slides[0].id;
    expect((await doc.slideTransition(slide)).data.transition).toBeNull();
    expect((await doc.slideTiming(slide)).data.timing).toBeNull();

    await doc.setSlideTransition(slide, {
      kind: "wipe",
      duration_ms: 500,
      direction: "left",
    });
    await doc.setSlideTiming(slide, { duration_ms: 45000, advance: "after" });
    expect((await doc.slideTransition(slide)).data.transition).toEqual({
      kind: "wipe",
      duration_ms: 500,
      direction: "left",
    });
    expect((await doc.slideTiming(slide)).data.timing).toEqual({
      duration_ms: 45000,
      advance: "after",
    });
    const described = await doc.describe<any>();
    expect(described.data.slides[0].transition.kind).toBe("wipe");
    expect(described.data.slides[0].timing.advance).toBe("after");

    const bytes = await doc.save();
    const re = await PitchDocument.openSnapshot(host, bytes);
    expect((await re.slideTransition(slide)).data.transition?.kind).toBe("wipe");
    expect((await re.slideTiming(slide)).data.timing?.duration_ms).toBe(45000);

    // kind "none" clears like clearSlideTransition; undo restores
    await re.setSlideTransition(slide, { kind: "none" });
    expect((await re.slideTransition(slide)).data.transition).toBeNull();
    await re.undo();
    expect((await re.slideTransition(slide)).data.transition?.kind).toBe("wipe");
    await re.clearSlideTiming(slide);
    expect((await re.slideTiming(slide)).data.timing).toBeNull();
    await re.undo();
    expect((await re.slideTiming(slide)).data.timing?.advance).toBe("after");

    // bounds and hostile payloads reject without mutating
    await expect(
      re.setSlideTransition(slide, { kind: "fade", duration_ms: 0 }),
    ).rejects.toThrow();
    await expect(
      re.setSlideTransition(slide, { kind: "morph" as never, duration_ms: 100 }),
    ).rejects.toThrow();
    await expect(
      re.setSlideTiming(slide, { duration_ms: 3600001, advance: "manual" }),
    ).rejects.toThrow();
    await expect(
      re.setSlideTiming(slide, { duration_ms: 1000, advance: "auto" as never }),
    ).rejects.toThrow();
    expect((await re.slideTransition(slide)).data.transition?.kind).toBe("wipe");
    await re.close();
    await doc.close();
  });

  it("shape presets add/read/persist/undo with stroke and bounds", async () => {
    const doc = await PitchDocument.open(host, "Shapes");
    const slide = (await doc.describe<any>()).data.slides[0].id;
    for (const kind of [
      "rect", "roundedRect", "ellipse", "triangle", "diamond", "line", "arrow", "star",
    ] as const) {
      const id = (
        await doc.addShape(slide, kind, 10, 20, 100, 50, [10, 20, 30, 255], {
          width: 2.5,
          color: [200, 100, 50, 128],
        })
      ).data.object_id;
      const described = await doc.describe<any>();
      const obj = described.data.slides[0].objects.find((o: any) => o.id === id);
      expect(obj.kind).toBe(kind);
      expect(obj.stroke).toEqual({ width: 2.5, color: [200, 100, 50, 128] });
    }
    // minimal payload omits fill/stroke
    const bare = (
      await doc.addShape(slide, "ellipse", 0, 0, 40, 40)
    ).data.object_id;
    const described = await doc.describe<any>();
    const bareObj = described.data.slides[0].objects.find((o: any) => o.id === bare);
    expect(bareObj.kind).toBe("ellipse");
    expect(bareObj.fill).toBeUndefined();
    expect(bareObj.stroke).toBeUndefined();

    // bounds and hostile payloads reject without mutating
    await expect(
      doc.addShape(slide, "hexagon" as never, 0, 0, 1, 1),
    ).rejects.toThrow();
    await expect(
      doc.addShape(slide, "ellipse", 0, 0, 1, 1, null, { width: 0, color: [0, 0, 0, 255] }),
    ).rejects.toThrow();
    await expect(
      doc.addShape(slide, "ellipse", 0, 0, 1, 1, [1, 2, 3] as never),
    ).rejects.toThrow();

    // persist through snapshot, undo removes the last add
    const bytes = await doc.save();
    const re = await PitchDocument.openSnapshot(host, bytes);
    const reDescribed = await re.describe<any>();
    expect(
      reDescribed.data.slides[0].objects.filter((o: any) => o.kind === "star"),
    ).toHaveLength(1);
    const star = reDescribed.data.slides[0].objects.find((o: any) => o.kind === "star");
    expect(star.stroke.width).toBe(2.5);
    await re.removeObject(slide, star.id);
    expect(
      (await re.describe<any>()).data.slides[0].objects.some((o: any) => o.id === star.id),
    ).toBe(false);
    await re.undo();
    expect(
      (await re.describe<any>()).data.slides[0].objects.some((o: any) => o.id === star.id),
    ).toBe(true);
    await re.close();
    await doc.close();
  });
});
