import { describe, expect, it, vi } from "vitest";
import {
  PITCH_ANIMATION_EFFECTS, PITCH_DEFERRED_OPS, bindPitchAnimations, bindPitchSlideList, pitchId, pitchMovePlan, readPitchDeck,
  type PitchOfficeDocument,
} from "../src/office-cluster";
import { OPS } from "../src/index";

const ok = <T>(data: T) => Promise.resolve({ events: [], data });
const state = {
  meta: { title: "Deck" }, next_id: 9,
  slides: [
    { id: 1, layout: "title", background: [10, 20, 30, 255], animations: [{ object_id: 3, kind: "fadeIn", start_s: 0, duration_s: 1 }],
      objects: [{ id: 3, kind: "text", x: 1, y: 2, w: 3, h: 4, rotation_deg: 0, text: { content: "Hi", font_size: 40, color: [0, 0, 0, 255], bold: true, italic: false } },
        { id: 4, kind: "rect", x: 0, y: 0, w: 10, h: 10, rotation_deg: 45, fill: [255, 0, 0, 255] }] },
    { id: 2, layout: "blank", background: null, animations: [], objects: [{ id: 5, kind: "image", x: 0, y: 0, w: 5, h: 5, rotation_deg: 0, src: "a.png" }] },
    { id: 6, layout: "blank", background: null, animations: [], objects: [] },
  ],
};
function fake() {
  const calls: unknown[][] = [];
  const rec = (name: string) => vi.fn((...args: unknown[]) => { calls.push([name, ...args]); return ok({ ok: true }); });
  const doc = {
    describe: vi.fn(() => ok(state)), addSlide: rec("addSlide"), removeSlide: rec("removeSlide"), moveSlide: rec("moveSlide"), moveSlides: rec("moveSlides"), removeSlides: rec("removeSlides"),
    moveObject: rec("moveObject"), resizeObject: rec("resizeObject"), rotateObject: rec("rotateObject"), setText: rec("setText"),
    removeObject: rec("removeObject"), addAnimation: rec("addAnimation"), removeAnimation: rec("removeAnimation"), slideAt: rec("slideAt"),
  };
  return { doc: doc as unknown as PitchOfficeDocument, calls };
}

describe("Pitch deck read for J-01/J-02/J-05/J-09", () => {
  it("maps describe to slides, objects and animations with string ids", async () => {
    const deck = await readPitchDeck(fake().doc);
    expect(deck.slides.map(s => s.id)).toEqual(["1", "2", "6"]);
    expect(deck.slides[0]).toMatchObject({ background: [10, 20, 30, 255] });
    expect(deck.slides[0]!.objects).toEqual([
      { id: "3", kind: "text", x: 1, y: 2, w: 3, h: 4, rotation: 0, text: "Hi", fontSize: 40, bold: true, italic: false, color: [0, 0, 0, 255] },
      { id: "4", kind: "rect", x: 0, y: 0, w: 10, h: 10, rotation: 45, fill: [255, 0, 0, 255] },
    ]);
    expect(deck.slides[1]!.objects[0]).toMatchObject({ kind: "image", src: "a.png" });
    expect(deck.animations["1"]).toEqual([{ index: 0, objectId: "3", kind: "fadeIn", startS: 0, durationS: 1 }]);
  });

  it("rejects malformed decks and ids", async () => {
    await expect(readPitchDeck({ describe: () => ok({ slides: "x" }) } as never)).rejects.toThrow(/invalid deck/);
    expect(() => pitchId("-1")).toThrow(RangeError);
    expect(() => pitchId("01")).toThrow(RangeError);
    expect(pitchId("12")).toBe(12);
  });
});

describe("slide list binding", () => {
  it("commits the complete order atomically and re-reads", async () => {
    const { doc, calls } = fake();
    const changed = vi.fn();
    const b = await bindPitchSlideList(doc, changed);
    await b.onReorder(["6", "1", "2"]);
    expect(calls).toEqual([["moveSlides", [6, 1, 2]]]);
    expect(changed).toHaveBeenCalledTimes(1);
    await b.onMove("1", 2);
    expect(calls.at(-1)).toEqual(["moveSlide", 0, 2]);
    await b.onAdd();
    expect(calls.at(-1)).toEqual(["addSlide", "blank"]);
    await b.onRemove("6");
    expect(calls.at(-1)).toEqual(["removeSlide", 6]);
  });

  it("plans moves that reproduce any order", () => {
    const ids = ["a", "b", "c", "d"];
    for (const after of [["d", "c", "b", "a"], ["b", "d", "a", "c"], ids]) {
      const cur = [...ids];
      for (const { from, to } of pitchMovePlan(ids, after)) { const [x] = cur.splice(from, 1); cur.splice(to, 0, x!); }
      expect(cur).toEqual(after);
    }
    expect(() => pitchMovePlan(ids, ["a"])).toThrow(RangeError);
    expect(() => pitchMovePlan(ids, ["a", "a", "b", "c"])).toThrow(RangeError);
  });

  it("refuses to remove every slide before any engine call", async () => {
    const { doc, calls } = fake();
    const b = await bindPitchSlideList(doc, () => {});
    await expect(b.onRemoveMany(["1", "2", "6"])).rejects.toThrow(/at least one slide/);
    await expect(b.onRemoveMany(["1", "2", "99"])).rejects.toThrow(/Unknown slide "99"/);
    await expect(b.onRemoveMany(["2", "2"])).rejects.toThrow(/Duplicate slide id/);
    await expect(b.onReorder(["6", "1", "1"])).rejects.toThrow(RangeError);
    await expect(b.onMove("9", 0)).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);
  });
});

describe("animation binding and deferrals", () => {
  it("offers only the effects Pitch plays and refuses others before the engine", async () => {
    const { doc, calls } = fake();
    const b = await bindPitchAnimations(doc, "1", () => {});
    expect(b.effects.map(e => e.kind)).toEqual(["fadeIn", "slideInLeft", "zoomIn"]);
    await expect(b.onAdd({ objectId: "3", kind: "fadeOut", startS: 0, durationS: 1 })).rejects.toThrow(/cannot play/);
    expect(calls).toEqual([]);
    await b.onAdd({ objectId: "4", kind: "zoomIn", startS: 0.5, durationS: 2 });
    expect(calls).toEqual([["addAnimation", 1, 4, "zoomIn", 0.5, 2]]);
    await b.onRemove(0);
    expect(calls.at(-1)).toEqual(["removeAnimation", 1, 0]);
  });

  it("names deferred ops that Pitch's OPS does not have", () => {
    for (const op of Object.keys(PITCH_DEFERRED_OPS)) expect(Object.values(OPS)).not.toContain(op);
    for (const e of PITCH_ANIMATION_EFFECTS) expect(["fadeIn", "slideInLeft", "zoomIn"]).toContain(e.kind);
  });
});
