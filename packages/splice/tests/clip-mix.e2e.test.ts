// Per-clip mix fields (gain_db / pan via setClipMix) driven through the real
// Rust engine via nf-cli: patch semantics, bounds, undo, split carry-over,
// renderPlan exposure and snapshot round-trips. Storage metadata only — no
// audio is mixed.
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
  gain_db?: number;
  pan?: number;
}
interface Timeline {
  tracks: { id: number; clips: Clip[] }[];
}
interface PlanClip {
  clip_id: number;
  gain_db: number;
  pan: number;
}

async function setup() {
  const doc = await SpliceDocument.open(host, 30);
  const src = (await doc.addSource(20, "mix.mov")).data.source_id;
  const a = (await doc.addTrack("audio")).data.track_id;
  return { doc, src, a };
}
const clipAt = async (doc: SpliceDocument, i = 0) =>
  (await doc.timeline<Timeline>()).data.tracks[0]!.clips[i]!;

describe("splice clip mix e2e (real Rust via nf-cli)", () => {
  it("patches gain_db/pan, exposes them in renderPlan, and no-ops identical writes", async () => {
    const { doc, src, a } = await setup();
    const c = (await doc.addClip({ track: a, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    // Neutral mix serializes as absent (legacy bytes).
    expect((await clipAt(doc)).gain_db).toBeUndefined();
    expect((await clipAt(doc)).pan).toBeUndefined();
    await doc.setClipMix(c, { gain_db: -6 });
    let clip = await clipAt(doc);
    expect(clip.gain_db).toBe(-6);
    expect(clip.pan).toBeUndefined();
    // Partial patch keeps the other field.
    await doc.setClipMix(c, { pan: 0.5 });
    clip = await clipAt(doc);
    expect(clip.gain_db).toBe(-6);
    expect(clip.pan).toBe(0.5);
    const plan = await doc.renderPlan<{ tracks: PlanClip[][] }>();
    expect(plan.data.tracks[0]![0]).toMatchObject({ gain_db: -6, pan: 0.5 });
    // Identical write: no events, no state change.
    const before = await doc.timeline();
    const r = await doc.handle.apply<{ changed?: boolean }>("setClipMix", { id: c, gain_db: -6, pan: 0.5 });
    expect(r.events).toEqual([]);
    expect(r.data.changed).toBe(false);
    expect(await doc.timeline()).toEqual(before);
    await doc.close();
  });

  it("rejects out-of-range and empty payloads atomically", async () => {
    const { doc, src, a } = await setup();
    const c = (await doc.addClip({ track: a, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    const before = await doc.timeline();
    for (const mix of [
      {},
      { gain_db: 12.5 },
      { gain_db: -60.5 },
      { gain_db: Number.NaN },
      { pan: 1.5 },
      { pan: -1.5 },
    ]) {
      await expect(doc.setClipMix(c, mix)).rejects.toBeInstanceOf(EngineError);
      expect(await doc.timeline()).toEqual(before);
    }
    // Boundary values are accepted.
    await doc.setClipMix(c, { gain_db: -60, pan: -1 });
    await doc.setClipMix(c, { gain_db: 12, pan: 1 });
    await doc.close();
  });

  it("splitClip carries the mix to both halves; undo restores it", async () => {
    const { doc, src, a } = await setup();
    const c = (await doc.addClip({ track: a, source: src, in_s: 0, out_s: 8 })).data.clip_id;
    await doc.setClipMix(c, { gain_db: -3, pan: -1 });
    await doc.splitClip(c, 4);
    const clips = (await doc.timeline<Timeline>()).data.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    for (const half of clips) {
      expect(half.gain_db).toBe(-3);
      expect(half.pan).toBe(-1);
    }
    // One undo step reverts the mix on the unsplit clip.
    expect(await doc.undo()).toBe(true); // undo split
    expect(await doc.undo()).toBe(true); // undo setClipMix
    expect((await clipAt(doc)).gain_db).toBeUndefined();
    expect(await doc.redo()).toBe(true);
    expect((await clipAt(doc)).gain_db).toBe(-3);
    await doc.close();
  });

  it("save/reopen preserves the mix", async () => {
    const { doc, src, a } = await setup();
    const c = (await doc.addClip({ track: a, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    await doc.setClipMix(c, { gain_db: 6, pan: 1 });
    const bytes = await doc.save();
    await doc.close();
    const re = await SpliceDocument.openSnapshot(host, bytes);
    const clip = await clipAt(re);
    expect(clip.gain_db).toBe(6);
    expect(clip.pan).toBe(1);
    await re.close();
  });
});
