// Keyframed clip speed (speed_keys / setSpeedKeys) driven through the real
// Rust engine via nf-cli: footprint math, structural-op interplay, bounds,
// undo/redo, eventless writes and snapshot round-trips.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { SpliceDocument, type SpeedKey } from "../src/index";

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
  speed: number;
  speed_keys?: { t_s: number; speed: number }[];
}
interface Timeline {
  tracks: { id: number; clips: Clip[] }[];
}
interface PlanClip {
  clip_id: number;
  timeline_start_s: number;
  timeline_end_s: number;
  speed_keys: { t_s: number; speed: number }[];
}

const RAMP: SpeedKey[] = [
  { t_s: 0, speed: 1 },
  { t_s: 4, speed: 2 },
];
/** Footprint of RAMP over media 0..4: ∫ dt/(1+t/4) = 4·ln2. */
const RAMP_LEN = 4 * Math.LN2;

async function setup() {
  const doc = await SpliceDocument.open(host, 30);
  const src = (await doc.addSource(20, "ramp.mov")).data.source_id;
  const v = (await doc.addTrack("video")).data.track_id;
  return { doc, src, v };
}
const clipAt = async (doc: SpliceDocument, i = 0) =>
  (await doc.timeline<Timeline>()).data.tracks[0]!.clips[i]!;

describe("splice keyframed speed e2e (real Rust via nf-cli)", () => {
  it("set/replace/clear keys and footprint matches duration + renderPlan", async () => {
    const { doc, src, v } = await setup();
    const c = (await doc.addClip({ track: v, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    // Constant clips serialize without speed_keys.
    expect((await clipAt(doc)).speed_keys).toBeUndefined();
    await doc.setSpeedKeys(c, RAMP);
    const clip = await clipAt(doc);
    expect(clip.speed_keys).toEqual(RAMP);
    // duration = renderPlan end = 4·ln2 ≈ 2.7726.
    expect((await doc.duration()).data.seconds).toBeCloseTo(RAMP_LEN, 9);
    const plan = await doc.renderPlan<{ tracks: PlanClip[][] }>();
    const pc = plan.data.tracks[0]![0]!;
    expect(pc.timeline_end_s).toBeCloseTo(RAMP_LEN, 9);
    expect(pc.speed_keys).toEqual(RAMP);
    // Unsorted input stores sorted; equal write is a no-op.
    await doc.setSpeedKeys(c, [RAMP[1]!, RAMP[0]!]);
    expect((await clipAt(doc)).speed_keys).toEqual(RAMP);
    const before = await doc.timeline();
    const r = await doc.handle.apply("setSpeedKeys", { id: c, keys: RAMP });
    expect(r.events).toEqual([]);
    expect(await doc.timeline()).toEqual(before);
    // keys:[] restores constant speed (footprint 4 s at speed 1).
    await doc.setSpeedKeys(c, []);
    expect((await clipAt(doc)).speed_keys).toBeUndefined();
    expect((await doc.duration()).data.seconds).toBe(4);
    await doc.close();
  });

  it("rejects bad keys atomically", async () => {
    const { doc, src, v } = await setup();
    const c = (await doc.addClip({ track: v, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    const before = await doc.timeline();
    for (const keys of [
      [{ t_s: 0, speed: 0.05 }],
      [{ t_s: 0, speed: 11 }],
      [{ t_s: -1, speed: 1 }],
      [
        { t_s: 1, speed: 1 },
        { t_s: 1, speed: 2 },
      ],
      Array.from({ length: 300 }, (_, i) => ({ t_s: i, speed: 1 })),
    ]) {
      await expect(doc.setSpeedKeys(c, keys)).rejects.toBeInstanceOf(EngineError);
      expect(await doc.timeline()).toEqual(before);
    }
    await doc.close();
  });

  it("split partitions the curve; halves' footprints sum to the whole", async () => {
    const { doc, src, v } = await setup();
    const c = (await doc.addClip({ track: v, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    await doc.setSpeedKeys(c, RAMP);
    // Split 2 timeline-seconds in: media point m solves 4·ln(1+m/4) = 2.
    const m = 4 * (Math.exp(0.5) - 1);
    const r = await doc.splitClip(c, 2);
    const clips = (await doc.timeline<Timeline>()).data.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.out_s).toBeCloseTo(m, 6);
    expect(clips[1]!.in_s).toBeCloseTo(m, 6);
    expect(clips[1]!.timeline_start_s).toBe(2);
    // Boundary key preserves the interpolated speed on both halves.
    const bk = clips[0]!.speed_keys!.at(-1)!;
    expect(bk.t_s).toBeCloseTo(m, 6);
    expect(bk.speed).toBeCloseTo(1 + m / 4, 6);
    const plan = await doc.renderPlan<{ tracks: PlanClip[][] }>();
    const ends = plan.data.tracks[0]!.map((p) => p.timeline_end_s);
    expect(ends[0]).toBeCloseTo(2, 6);
    expect(ends[1]).toBeCloseTo(RAMP_LEN, 6);
    expect(r.data.right_id).not.toBe(c);
    await doc.close();
  });

  it("trim, move and rippleDelete account for the integral", async () => {
    const { doc, src, v } = await setup();
    const c = (await doc.addClip({ track: v, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    await doc.setSpeedKeys(c, RAMP);
    // Trim media to 0..2: footprint = ∫₀² dt/(1+t/4) = 4·ln(1.5).
    await doc.trimClip(c, 0, 2);
    expect((await doc.duration()).data.seconds).toBeCloseTo(4 * Math.log(1.5), 9);
    // moveClip keeps curve and footprint, just re-places it.
    await doc.moveClip(c, 10);
    const moved = await clipAt(doc);
    expect(moved.timeline_start_s).toBe(10);
    expect(moved.speed_keys).toHaveLength(2);
    expect((await doc.duration()).data.seconds).toBeCloseTo(10 + 4 * Math.log(1.5), 9);
    // A neighbour blocks a footprint-growing curve change.
    await doc.addClip({ track: v, source: src, in_s: 0, out_s: 1, start_s: 12 });
    const before = await doc.timeline();
    await expect(
      doc.setSpeedKeys(c, [
        { t_s: 0, speed: 0.1 },
        { t_s: 2, speed: 0.1 },
      ]),
    ).rejects.toBeInstanceOf(EngineError);
    expect(await doc.timeline()).toEqual(before);
    // rippleDelete removes the keyed clip and closes its gap: the neighbour
    // at 12 shifts left by the deleted footprint 4·ln(1.5) ≈ 1.6219.
    await doc.rippleDelete(c);
    const rest = (await doc.timeline<Timeline>()).data.tracks[0]!.clips;
    expect(rest).toHaveLength(1);
    expect(rest[0]!.timeline_start_s).toBeCloseTo(12 - 4 * Math.log(1.5), 6);
    await doc.close();
  });

  it("roll, slip and slide handle keyed clips honestly", async () => {
    const { doc, src, v } = await setup();
    // Keyed left clip (footprint 4·ln2), constant right clip touching it.
    const l = (await doc.addClip({ track: v, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    await doc.setSpeedKeys(l, RAMP);
    const r = (
      await doc.addClip({
        track: v,
        source: src,
        in_s: 5,
        out_s: 7,
        start_s: RAMP_LEN,
      })
    ).data.clip_id;
    // rollEdit +0.25: left tail extends at held tail speed 2.0 → out_s 4.5;
    // right in-point advances 0.25 media-s and start follows the cut.
    await doc.rollEdit(l, r, 0.25);
    let clips = (await doc.timeline<Timeline>()).data.tracks[0]!.clips;
    expect(clips[0]!.out_s).toBeCloseTo(4.5, 6);
    expect(clips[1]!.in_s).toBeCloseTo(5.25, 6);
    expect(clips[1]!.timeline_start_s).toBeCloseTo(RAMP_LEN + 0.25, 6);
    // slipClip cannot preserve a keyframed footprint → clean rejection.
    const before = await doc.timeline();
    await expect(doc.slipClip(l, 0.5)).rejects.toBeInstanceOf(EngineError);
    expect(await doc.timeline()).toEqual(before);
    // slideClip on the constant right clip shrinks the keyed left tail.
    await doc.slideClip(r, -0.25);
    clips = (await doc.timeline<Timeline>()).data.tracks[0]!.clips;
    expect(clips[0]!.out_s).toBeCloseTo(4.0, 6);
    await doc.close();
  });

  it("undo/redo and save/reopen preserve the curve", async () => {
    const { doc, src, v } = await setup();
    const c = (await doc.addClip({ track: v, source: src, in_s: 0, out_s: 4 })).data.clip_id;
    await doc.setSpeedKeys(c, RAMP);
    expect(await doc.undo()).toBe(true);
    expect((await clipAt(doc)).speed_keys).toBeUndefined();
    expect(await doc.redo()).toBe(true);
    expect((await clipAt(doc)).speed_keys).toEqual(RAMP);
    const bytes = await doc.save();
    await doc.close();
    const re = await SpliceDocument.openSnapshot(host, bytes);
    expect((await clipAt(re)).speed_keys).toEqual(RAMP);
    expect((await re.duration()).data.seconds).toBeCloseTo(RAMP_LEN, 9);
    await re.close();
  });

  it("addClip accepts speed_keys; setSpeed flattens them", async () => {
    const { doc, src, v } = await setup();
    const c = (
      await doc.addClip({
        track: v,
        source: src,
        in_s: 0,
        out_s: 4,
        speed_keys: [
          { t_s: 0, speed: 2 },
          { t_s: 4, speed: 2 },
        ],
      })
    ).data.clip_id;
    // Constant 2x expressed as keys: footprint exactly 2 s.
    expect((await doc.duration()).data.seconds).toBe(2);
    // setSpeed replaces the curve with constant speed.
    await doc.setSpeed(c, 1);
    expect((await clipAt(doc)).speed_keys).toBeUndefined();
    expect((await doc.duration()).data.seconds).toBe(4);
    await doc.close();
  });
});
