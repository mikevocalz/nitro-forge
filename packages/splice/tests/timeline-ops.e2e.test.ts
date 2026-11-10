// Track flags, ripple/roll/slip/slide, placement modes, transitions, markers,
// loop range and batch, driven through the real Rust engine via nf-cli.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { SpliceDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

interface Clip {
  id: number;
  timeline_start_s: number;
  in_s: number;
  out_s: number;
}
interface Timeline {
  tracks: {
    id: number;
    kind: string;
    name?: string;
    locked: boolean;
    clips: Clip[];
    transitions: { id: number; left_id: number }[];
  }[];
  markers: { id: number; time_s: number; name: string }[];
  loop_range?: { in_s: number; out_s: number };
}

/** Video track with three touching 2 s clips at 0, 2, 4 from a 20 s source. */
async function threeClips() {
  const doc = await SpliceDocument.open(host, 30);
  const src = (await doc.addSource(20, "take.mov")).data.source_id;
  const v = (await doc.addTrack("video")).data.track_id;
  const ids: number[] = [];
  for (const m of [2, 4, 6]) {
    ids.push((await doc.addClip({ track: v, source: src, in_s: m, out_s: m + 2 })).data.clip_id);
  }
  return { doc, src, v, ids };
}
const starts = async (doc: SpliceDocument, track = 0) =>
  (await doc.timeline<Timeline>()).data.tracks[track]!.clips.map((c) => c.timeline_start_s);

describe("splice timeline ops e2e (real Rust via nf-cli)", () => {
  it("ripple delete closes the gap and undoes in one step", async () => {
    const { doc, ids } = await threeClips();
    await doc.rippleDelete(ids[1]!);
    expect(await starts(doc)).toEqual([0, 2]);
    expect(await doc.undo()).toBe(true);
    expect(await starts(doc)).toEqual([0, 2, 4]);
    await doc.close();
  });

  it("ripple trim, roll, slip and slide", async () => {
    const { doc, ids } = await threeClips();
    await doc.rippleTrim(ids[0]!, "tail", 1);
    expect(await starts(doc)).toEqual([0, 3, 5]);
    await doc.rollEdit(ids[0]!, ids[1]!, -0.5);
    let clips = (await doc.timeline<Timeline>()).data.tracks[0]!.clips;
    expect(clips[0]!.out_s).toBeCloseTo(4.5);
    expect(clips[1]!.timeline_start_s).toBeCloseTo(2.5);
    await doc.slipClip(ids[2]!, -1);
    clips = (await doc.timeline<Timeline>()).data.tracks[0]!.clips;
    expect([clips[2]!.in_s, clips[2]!.out_s]).toEqual([5, 7]);
    await doc.slideClip(ids[1]!, 0.25);
    clips = (await doc.timeline<Timeline>()).data.tracks[0]!.clips;
    expect(clips[0]!.out_s).toBeCloseTo(4.75);
    expect(clips[2]!.timeline_start_s).toBeCloseTo(5.25);
    // Not touching: roll refuses, state intact.
    const before = await doc.timeline();
    await expect(doc.rollEdit(ids[0]!, ids[2]!, 0.1)).rejects.toBeInstanceOf(EngineError);
    expect(await doc.timeline()).toEqual(before);
    await doc.close();
  });

  it("insert and overwrite placement report split-off clips", async () => {
    const { doc, src, v, ids } = await threeClips();
    const ins = await doc.addClip({ track: v, source: src, in_s: 0, out_s: 1, start_s: 3, mode: "insert" });
    expect(ins.data.created).toHaveLength(1);
    expect(await starts(doc)).toEqual([0, 2, 3, 4, 5]);
    await doc.undo();
    const over = await doc.moveClip(ids[2]!, 1, { mode: "overwrite" });
    // 1..3 cuts clip 0 at 1 and clip 1 at 3; the piece of clip 1 after 3 survives.
    expect(over.data.created).toHaveLength(1);
    expect(await starts(doc)).toEqual([0, 1, 3]);
    await doc.close();
  });

  it("locked tracks refuse edits; flags and names round-trip", async () => {
    const { doc, v, ids } = await threeClips();
    await doc.renameTrack(v, "A-roll");
    expect((await doc.setTrackFlags(v, { locked: true })).data.changed).toBe(true);
    expect((await doc.setTrackFlags(v, { locked: true })).data.changed).toBe(false);
    await expect(doc.moveClip(ids[0]!, 10)).rejects.toThrow(/locked/);
    await expect(doc.setTrackFlags(v, { muted: true })).rejects.toBeInstanceOf(EngineError);
    const t = (await doc.timeline<Timeline>()).data.tracks[0]!;
    expect([t.name, t.locked]).toEqual(["A-roll", true]);
    await doc.close();
  });

  it("transitions: add, appear in renderPlan, drop when the cut breaks", async () => {
    const { doc, ids } = await threeClips();
    const t = (await doc.addTransition(ids[0]!, ids[1]!, "cross_dissolve", 1)).data.transition_id;
    const plan = await doc.renderPlan<{ transitions: { transition_id: number; start_s: number }[][] }>();
    expect(plan.data.transitions[0]![0]).toMatchObject({ transition_id: t, start_s: 1.5 });
    await expect(doc.addTransition(ids[0]!, ids[1]!, "cross_fade", 1)).rejects.toBeInstanceOf(EngineError);
    const moved = await doc.moveClip(ids[1]!, 10);
    expect(moved.data.removed_transitions).toEqual([t]);
    await doc.undo();
    expect((await doc.timeline<Timeline>()).data.tracks[0]!.transitions[0]!.id).toBe(t);
    await doc.close();
  });

  it("markers and loop range survive save and reopen", async () => {
    const { doc } = await threeClips();
    await doc.addMarker({ time_s: 4, name: "Beat" });
    await doc.setLoopRange(1, 3);
    const bytes = await doc.save();
    await doc.close();
    const re = await SpliceDocument.openSnapshot(host, bytes);
    const tl = (await re.timeline<Timeline>()).data;
    expect(tl.markers[0]).toMatchObject({ time_s: 4, name: "Beat" });
    expect(tl.loop_range).toEqual({ in_s: 1, out_s: 3 });
    await re.close();
  });

  it("batch applies all ops as one undo step or none of them", async () => {
    const { doc, ids } = await threeClips();
    const r = await doc.batch([
      { op: "setSpeed", payload: { id: ids[0], speed: 2 } },
      { op: "rippleDelete", payload: { id: ids[1] } },
    ]);
    expect(r.data.results).toHaveLength(2);
    expect(await starts(doc)).toEqual([0, 2]);
    expect(await doc.undo()).toBe(true);
    expect(await starts(doc)).toEqual([0, 2, 4]);
    const before = await doc.timeline();
    await expect(
      doc.batch([
        { op: "removeClip", payload: { id: ids[0] } },
        { op: "removeClip", payload: { id: ids[0] } },
      ]),
    ).rejects.toThrow(/ops\[1\] removeClip/);
    expect(await doc.timeline()).toEqual(before);
    await doc.close();
  });
});
