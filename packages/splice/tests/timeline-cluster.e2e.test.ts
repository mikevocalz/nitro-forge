// The timeline adapter against the real Rust Splice engine via nf-cli: each
// NYC-Tron gesture lands as engine ops and is one undo step.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { SpliceDocument } from "../src/index";
import { SpliceTimelineAdapter, timelineClusterCallbacks } from "../src/timeline-cluster";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

const R24 = { numerator: 24, denominator: 1 };

/** Video track: three touching 2 s clips (frames 0, 48, 96) from a 20 s source; an empty audio track. */
async function setup() {
  const doc = await SpliceDocument.open(host, 24);
  const src = (await doc.addSource(20, "take.mov")).data.source_id;
  const v = (await doc.addTrack("video")).data.track_id;
  await doc.addTrack("audio");
  for (const m of [2, 4, 6]) await doc.addClip({ track: v, source: src, in_s: m, out_s: m + 2 });
  const a = new SpliceTimelineAdapter(doc, R24);
  const view = await a.read();
  const ids = view.tracks[0]!.clips.map((c) => c.id);
  return { doc, a, ids, trackId: view.tracks[0]!.id, audioId: view.tracks[1]!.id };
}
const startsOf = (view: Awaited<ReturnType<SpliceTimelineAdapter["read"]>>) =>
  view.tracks[0]!.clips.map((c) => c.startFrame);

describe("SpliceTimelineAdapter e2e", () => {
  it("a head trim is one undo step", async () => {
    const { doc, a, ids } = await setup();
    // Head of the middle clip 12 frames later: trim the in-point, then move the start.
    let v = await a.applyEdit({
      kind: "trim", clipId: ids[1]!, startSeconds: 2.5, inSeconds: 4.5, outSeconds: 6, order: "trim-then-move",
    });
    expect(startsOf(v)).toEqual([0, 60, 96]);
    expect(await a.undo()).toBe(true);
    v = await a.read();
    expect(startsOf(v)).toEqual([0, 48, 96]);
    expect(v.tracks[0]!.clips[1]!.sourceIn).toBe(96);
    await doc.close();
  });

  it("ripple, roll, slip and slide gestures", async () => {
    const { doc, a, ids } = await setup();
    let v = await a.applyEdit({ kind: "rippleDelete", clipId: ids[0]!, scope: "track" });
    expect(startsOf(v)).toEqual([0, 48]);
    v = await a.applyEdit({ kind: "roll", leftClipId: ids[1]!, rightClipId: ids[2]!, deltaSeconds: 0.5 });
    expect(startsOf(v)).toEqual([0, 60]);
    v = await a.applyEdit({ kind: "slip", clipId: ids[2]!, deltaSeconds: 1 });
    expect(v.tracks[0]!.clips[1]!.sourceIn).toBe((6.5 + 1) * 24);
    v = await a.applyEdit({ kind: "slide", clipId: ids[2]!, deltaSeconds: 0.5 });
    expect(startsOf(v)).toEqual([0, 72]);
    await expect(a.applyEdit({ kind: "slip", clipId: ids[2]!, deltaSeconds: 30 })).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("track headers, transitions, markers and loop range", async () => {
    const { doc, a, ids, trackId, audioId } = await setup();
    let v = await a.setTrackFlag(audioId, "solo", true);
    expect(v.tracks[1]!.solo).toBe(true);
    v = await a.renameTrack(trackId, "A-roll");
    expect(v.tracks[0]!.label).toBe("A-roll");
    v = await a.addTransition({ leftClipId: ids[0]!, rightClipId: ids[1]!, kind: "dip_to_black", durationSeconds: 0.5 });
    expect(v.transitions).toEqual([
      expect.objectContaining({ leftClipId: ids[0], rightClipId: ids[1], kind: "dip_to_black", durationFrames: 12 }),
    ]);
    v = await a.setTransition(v.transitions[0]!.id, { durationSeconds: 1 });
    expect(v.transitions[0]!.durationFrames).toBe(24);
    v = await a.addMarker({ seconds: 3, name: "Beat" });
    v = await a.updateMarker(v.markers[0]!.id, { seconds: 3.5 });
    expect(v.markers[0]!.frame).toBe(84);
    v = await a.setLoopRange({ inSeconds: 1, outSeconds: 4 });
    expect(v.loopRange).toEqual({ inFrame: 24, outFrame: 96 });
    v = await a.setLoopRange(undefined);
    expect(v.loopRange).toBeUndefined();
    v = await a.setTrackFlag(trackId, "locked", true);
    await expect(a.applyEdit({ kind: "move", clipId: ids[2]!, startSeconds: 10 })).rejects.toThrow(/locked/);
    v = await a.addTrack("overlay");
    expect(v.tracks.map((t) => t.label)).toEqual(["A-roll", "A1", "O1"]);
    v = await a.moveTrack(v.tracks[2]!.id, 0);
    expect(v.tracks[0]!.kind).toBe("overlay");
    await doc.close();
  });

  it("batch panel: a later shift of every clip is one undo step", async () => {
    const { doc, a, ids } = await setup();
    let v = await a.applyBatch(ids.map((clipId, i) => ({ kind: "move", clipId, startSeconds: 2 * i + 1 })));
    expect(startsOf(v)).toEqual([24, 72, 120]);
    expect(await a.undo()).toBe(true);
    v = await a.read();
    expect(startsOf(v)).toEqual([0, 48, 96]);
    v = await a.applyBatch([
      { kind: "speed", clipId: ids[0]!, speed: 2 },
      { kind: "rippleDelete", clipId: ids[1]!, scope: "track" },
    ]);
    expect(startsOf(v)).toEqual([0, 48]);
    await doc.close();
  });

  it("insert move across into place reports through the view", async () => {
    const { doc, a, ids } = await setup();
    const v = await a.applyEdit({ kind: "move", clipId: ids[2]!, startSeconds: 1, mode: "insert", scope: "track" });
    // Clip 0 split at 1 s; the moved clip sits at 1..3; the rest shift 2 s.
    expect(startsOf(v)).toEqual([0, 24, 72, 96]);
    await doc.close();
  });
});


describe("bound timeline cluster callbacks", () => {
  it("keeps adapter ownership when callbacks are passed directly to controls", async () => {
    const { doc, a, ids, trackId } = await setup();
    try {
      const c = timelineClusterCallbacks(a);
      const rename = c.onRename;
      expect((await rename(trackId, "Picture")).tracks[0]!.label).toBe("Picture");
      const mark = await c.onAddMarker({ seconds: 1 });
      const markerId = mark.markers[0]!.id;
      const changed = await c.onUpdateMarker(markerId, { seconds: 1.5, name: "Cue", note: "Cut here" });
      expect(changed.markers[0]).toMatchObject({ frame: 36, name: "Cue", note: "Cut here" });
      const t = await c.onAddTransition({ leftClipId: ids[0]!, rightClipId: ids[1]!, kind: "cross_dissolve", durationSeconds: 0.5 });
      expect(t.transitions[0]!.durationFrames).toBe(12);
      expect((await c.onCommitLoop({ inSeconds: 1, outSeconds: 3 })).loopRange).toEqual({ inFrame: 24, outFrame: 72 });
    } finally { await doc.close(); }
  });

  it("rejects an unavailable preset or a locked edit without publishing changed state", async () => {
    const { doc, a, ids, trackId } = await setup();
    try {
      const c = timelineClusterCallbacks(a);
      const before = await a.read();
      await expect(c.onAddTransition({ leftClipId: ids[0]!, rightClipId: ids[1]!, kind: "unavailable", durationSeconds: 1 })).rejects.toThrow(/Unsupported transition/);
      expect(await a.read()).toEqual(before);
      const locked = await c.onSetFlag(trackId, "locked", true);
      await expect(c.onEdit({ kind: "slip", clipId: ids[1]!, deltaSeconds: 1 })).rejects.toThrow(/locked/);
      expect(await a.read()).toEqual(locked);
    } finally { await doc.close(); }
  });
});
