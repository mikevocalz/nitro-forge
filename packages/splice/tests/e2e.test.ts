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

describe("splice engine e2e (real Rust via nf-cli)", () => {
  it("builds a timeline, splits clips, computes duration", async () => {
    const doc = await SpliceDocument.open(host, 30);
    const src = (await doc.addSource(10, "take1.mp4")).data.source_id;
    const track = (await doc.addTrack("video")).data.track_id;
    const clip = (
      await doc.addClip({ track, source: src, in_s: 0, out_s: 8 })
    ).data.clip_id;
    const split = await doc.splitClip(clip, 4);
    expect(split.data.left_id).toBe(clip);
    expect((await doc.duration()).data.seconds).toBe(8);
    const plan = await doc.renderPlan<any>();
    const clips = plan.data.tracks[0];
    expect(clips).toHaveLength(2);
    await doc.close();
  });

  it("rejects overlaps and out-of-source trims", async () => {
    const doc = await SpliceDocument.open(host);
    const src = (await doc.addSource(5)).data.source_id;
    const tr = (await doc.addTrack("video")).data.track_id;
    await doc.addClip({ track: tr, source: src, in_s: 0, out_s: 5 });
    await expect(
      doc.addClip({ track: tr, source: src, in_s: 0, out_s: 5, start_s: 2 }),
    ).rejects.toBeInstanceOf(EngineError); // explicit overlap at t=2
    await expect(
      doc.addClip({ track: tr, source: src, in_s: 3, out_s: 9 }),
    ).rejects.toBeInstanceOf(EngineError); // out_s beyond source duration
    await expect(doc.trimClip(999, 1)).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("save/reopen preserves timeline", async () => {
    const doc = await SpliceDocument.open(host, 24);
    const src = (await doc.addSource(12, "b.mov")).data.source_id;
    const tr = (await doc.addTrack("video")).data.track_id;
    await doc.addClip({ track: tr, source: src, in_s: 2, out_s: 10, speed: 2 });
    const bytes = await doc.save();
    await doc.close();

    const re = await SpliceDocument.openSnapshot(host, bytes);
    // speed 2 over an 8s source span = 4s on the timeline
    expect((await re.duration()).data.seconds).toBeCloseTo(4, 5);
    await re.close();
  });

  it("undo restores a removed clip", async () => {
    const doc = await SpliceDocument.open(host);
    const src = (await doc.addSource(6)).data.source_id;
    const tr = (await doc.addTrack("video")).data.track_id;
    const c = (await doc.addClip({ track: tr, source: src, in_s: 0, out_s: 6 }))
      .data.clip_id;
    await doc.removeClip(c);
    expect(await doc.undo()).toBe(true);
    const tl = await doc.timeline<any>();
    expect(tl.data.tracks[0].clips).toHaveLength(1);
    await doc.close();
  });
});
