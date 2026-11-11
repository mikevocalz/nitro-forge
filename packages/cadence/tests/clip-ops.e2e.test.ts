import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { CadenceDocument, OPS } from "../src/index";

// splitClip / setClipGain / setClipMute through the compiled nf-cli binary,
// so the payload names and clip fields are checked against the Rust engine.

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

interface Note {
  pitch: number;
  velocity: number;
  start_ticks: number;
  length_ticks: number;
  channel: number;
}
interface Clip {
  id: number;
  start_ticks: number;
  length_ticks: number;
  gain_db: number;
  muted: boolean;
  notes: Note[];
}
async function clips(doc: CadenceDocument): Promise<Clip[]> {
  const d = await doc.describe<{ tracks: { clips: Clip[] }[] }>();
  return d.data.tracks[0]!.clips;
}
async function rejectsWith(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EngineError);
  expect((err as EngineError).code).toBe(code);
}

describe("clip ops against the real Rust Cadence engine", () => {
  it("exposes the op names", () => {
    expect(OPS.splitClip).toBe("splitClip");
    expect(OPS.setClipGain).toBe("setClipGain");
    expect(OPS.setClipMute).toBe("setClipMute");
  });

  it("splits a clip and cuts a spanning note at the boundary", async () => {
    const doc = await CadenceDocument.open(host, 120);
    try {
      const track = (await doc.addTrack("midi", "keys")).data.track_id;
      const clip = (await doc.addClip(track, 0, 960)).data.clip_id;
      await doc.addNote(clip, 60, 0, 960, 100);
      await doc.addNote(clip, 64, 480, 240, 90);
      await doc.setClipGain(clip, -3);
      const r = (await doc.splitClip(clip, 480)).data;
      expect(r.left_id).toBe(clip);
      const cs = await clips(doc);
      expect(cs).toHaveLength(2);
      expect(cs[0]).toMatchObject({ id: clip, start_ticks: 0, length_ticks: 480, gain_db: -3 });
      expect(cs[1]).toMatchObject({ id: r.right_id, start_ticks: 480, length_ticks: 480, gain_db: -3 });
      // Both notes spanned the cut: each became a pair sharing pitch/velocity.
      expect(cs[0]!.notes).toEqual([
        { pitch: 60, velocity: 100, start_ticks: 0, length_ticks: 480, channel: 0 },
      ]);
      expect(cs[1]!.notes).toEqual([
        { pitch: 60, velocity: 100, start_ticks: 0, length_ticks: 480, channel: 0 },
        { pitch: 64, velocity: 90, start_ticks: 0, length_ticks: 240, channel: 0 },
      ]);
      // One undo step restores the single clip.
      await doc.undo();
      expect(await clips(doc)).toHaveLength(1);
      await rejectsWith(doc.splitClip(clip, 0), "validation");
      await rejectsWith(doc.splitClip(clip, 960), "validation");
      await rejectsWith(doc.splitClip(9999, 480), "not_found");
    } finally {
      await doc.close();
    }
  });

  it("applies clip gain and mute to the rendered mix", async () => {
    const doc = await CadenceDocument.open(host, 120);
    try {
      const track = (await doc.addTrack("midi", "keys")).data.track_id;
      const clip = (await doc.addClip(track, 0, 960)).data.clip_id;
      await doc.addNote(clip, 69, 0, 960, 127);
      const peak = async () => {
        const r = await doc.render(240, 720, 8000);
        return r.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      };
      const unity = await peak();
      expect(unity).toBeCloseTo(Math.SQRT1_2, 1);
      await doc.setClipGain(clip, -6.0206);
      expect(await peak()).toBeCloseTo(Math.SQRT1_2 * 0.5, 1);
      await doc.setClipMute(clip, true);
      expect(await peak()).toBe(0);
      await doc.setClipMute(clip, false);
      expect(await peak()).toBeCloseTo(Math.SQRT1_2 * 0.5, 1);
      const c = (await clips(doc))[0]!;
      expect(c).toMatchObject({ gain_db: -6.0206, muted: false });
      await rejectsWith(doc.setClipGain(clip, 13), "validation");
      await rejectsWith(doc.setClipGain(clip, -61), "validation");
      await rejectsWith(doc.setClipMute(9999, true), "not_found");
    } finally {
      await doc.close();
    }
  });
});
