import { describe, expect, it, vi } from "vitest";
import {
  PITCH_ANIMATION_EFFECTS, PITCH_DEFERRED_OPS, bindPitchAnimations, bindPitchSlideList, bindPitchCanvas, pitchId, pitchMovePlan, readPitchDeck,
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
function fake(snapshot: unknown = state) {
  const calls: unknown[][] = [];
  const rec = (name: string) => vi.fn((...args: unknown[]) => { calls.push([name, ...args]); return ok({ ok: true }); });
  const doc = {
    describe: vi.fn(() => ok(snapshot)), addSlide: rec("addSlide"), removeSlide: rec("removeSlide"), moveSlide: rec("moveSlide"), moveSlides: rec("moveSlides"), removeSlides: rec("removeSlides"),
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

  it("refuses shape presets the pinned renderer cannot draw and passes rect stroke through", async () => {
    const withShape = structuredClone(state) as { slides: { objects: Record<string, unknown>[] }[] };
    withShape.slides[0]!.objects.push({ id: 7, kind: "ellipse", x: 0, y: 0, w: 5, h: 5, rotation_deg: 0 });
    await expect(readPitchDeck(fake(withShape).doc)).rejects.toThrow(/newer NYC-Tron slide renderer/);
    const stroked = structuredClone(state) as { slides: { objects: Record<string, unknown>[] }[] };
    stroked.slides[0]!.objects[1]!["stroke"] = { width: 2, color: [1, 2, 3, 255] };
    const deck = await readPitchDeck(fake(stroked).doc);
    expect(deck.slides[0]!.objects[1]).toMatchObject({ kind: "rect", stroke: { width: 2, color: [1, 2, 3, 255] } });
    const withConnector = structuredClone(state) as { slides: { objects: Record<string, unknown>[] }[] };
    withConnector.slides[0]!.objects.push({
      id: 8, kind: "connector", x: 0, y: 0, w: 0, h: 0, rotation_deg: 0,
      connector: { from: { type: "free", x: 0, y: 0 }, to: { type: "free", x: 5, y: 5 }, route: "straight", arrows: "none" },
    });
    await expect(readPitchDeck(fake(withConnector).doc)).rejects.toThrow(/newer NYC-Tron slide renderer/);
    const withMedia = structuredClone(state) as { slides: { objects: Record<string, unknown>[] }[] };
    withMedia.slides[0]!.objects.push({
      id: 9, kind: "media", x: 0, y: 0, w: 10, h: 10, rotation_deg: 0,
      media: { src: "clip.mp4", kind: "video" },
    });
    await expect(readPitchDeck(fake(withMedia).doc)).rejects.toThrow(/newer NYC-Tron slide renderer/);
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

  it("refuses duplicate and unknown ids before any engine call", async () => {
    const { doc, calls } = fake();
    const b = await bindPitchSlideList(doc, () => {});
    await expect(b.onRemoveMany(["1", "2", "99"])).rejects.toThrow(/Unknown slide "99"/);
    await expect(b.onRemoveMany(["2", "2"])).rejects.toThrow(/Duplicate slide id/);
    await expect(b.onMove("9", 0)).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);
  });

  it("leaves the keep-one rule and order validation to the engine", async () => {
    const { doc, calls } = fake();
    const b = await bindPitchSlideList(doc, () => {});
    await b.onRemoveMany(["1", "2", "6"]);
    await b.onReorder(["6", "1"]);
    expect(calls).toEqual([["removeSlides", [1, 2, 6]], ["moveSlides", [6, 1]]]);
  });
});

describe("animation binding and deferrals", () => {
  it("offers only the effects Pitch plays and refuses others before the engine", async () => {
    const { doc, calls } = fake();
    const b = await bindPitchAnimations(doc, "1", () => {});
    expect(b.effects.map(e => e.kind)).toEqual(["fadeIn", "slideInLeft", "zoomIn", "pulse", "spin", "fadeOut", "zoomOut"]);
    await expect(b.onAdd({ objectId: "3", kind: "bounce", startS: 0, durationS: 1 })).rejects.toThrow(/cannot play/);
    expect(calls).toEqual([]);
    await b.onAdd({ objectId: "4", kind: "zoomIn", startS: 0.5, durationS: 2 });
    expect(calls).toEqual([["addAnimation", 1, 4, "zoomIn", 0.5, 2]]);
    await b.onRemove(0);
    expect(calls.at(-1)).toEqual(["removeAnimation", 1, 0]);
  });

  it("names deferred ops that Pitch's OPS does not have", () => {
    for (const op of Object.keys(PITCH_DEFERRED_OPS)) expect(Object.values(OPS)).not.toContain(op);
    for (const e of PITCH_ANIMATION_EFFECTS) expect(["fadeIn", "slideInLeft", "zoomIn", "pulse", "spin", "fadeOut", "zoomOut"]).toContain(e.kind);
  });
});

it("feeds persisted deck geometry to the canonical canvas, with legacy fallback", async () => {
  const { doc } = fake();
  const legacy = await bindPitchCanvas(doc, "1", () => {});
  expect(legacy.size).toEqual({ width: 960, height: 540 });
  const persisted = { describe: vi.fn(() => ok({ ...state, size: { width: 720, height: 1280 } })) };
  expect((await readPitchDeck(persisted as never)).size).toEqual({ width: 720, height: 1280 });
  const invalid = { describe: vi.fn(() => ok({ ...state, size: { width: 0, height: 1280 } })) };
  await expect(readPitchDeck(invalid as never)).rejects.toThrow("invalid slide dimensions");
});


describe('Pitch authoritative section metadata without pinned UI activation', () => {
  it('reads legacy defaults and stable boundary identities', async () => {
    expect((await readPitchDeck(fake().doc)).sections).toEqual([]);
    expect((await readPitchDeck(fake({ ...state, sections: [{ id: 7, label: 'Opening', start_slide_id: 2 }] }).doc)).sections)
      .toEqual([{ id: '7', label: 'Opening', startSlideId: '2' }]);
  });
  it('rejects malformed, duplicate and orphan boundary metadata', async () => {
    for (const sections of [[null], [{ id: 1, label: 'A', start_slide_id: 999 }], [{ id: 1, label: ' ', start_slide_id: 1 }], [{ id: 1, label: 'é'.repeat(513), start_slide_id: 1 }], [{ id: 1, label: 'A', start_slide_id: 1 }, { id: 2, label: 'B', start_slide_id: 1 }]])
      await expect(readPitchDeck(fake({ ...state, sections }).doc)).rejects.toThrow();
  });
});

it('retains trigger authority but gates unsupported timing UI under the pinned release',async()=>{
 const {doc}=fake();
 const triggered={...state,slides:state.slides.map((slide,index)=>index===0?{...slide,animations:slide.animations.map(animation=>({...animation,trigger:{type:'on-click',click_index:0}}))}:slide)};
 const document={...doc,describe:vi.fn(()=>ok(triggered))} as unknown as PitchOfficeDocument;
 expect((await readPitchDeck(document)).animations['1']![0]!.sourceTrigger).toEqual({type:'on-click',click_index:0});
 await expect(bindPitchAnimations(document,'1',()=>{})).rejects.toThrow('pinned animation pane');
});
