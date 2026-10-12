import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { CadenceDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("cadence engine e2e (real Rust via nf-cli)", () => {
  it("builds a project and renders real audio", async () => {
    const doc = await CadenceDocument.open(host, 120);
    const track = (await doc.addTrack("midi", "keys")).data.track_id;
    const clip = (
      await doc.addClip(track, 0, 960) // 1 beat at 960ppq
    ).data.clip_id;
    await doc.addNote(clip, 69, 0, 960, 100); // A4 for the beat
    const { samples, frames } = await doc.render(0, 960, 22050);
    expect(frames).toBeGreaterThan(0);
    expect(samples.length).toBe(frames * 2);
    // A4 sine at nonzero amplitude somewhere in the middle
    const mid = Math.floor(frames / 2) * 2;
    expect(Math.abs(samples[mid]!)).toBeGreaterThan(0.01);
    await doc.close();
  });

  it("round-trips save/reopen", async () => {
    const doc = await CadenceDocument.open(host, 140);
    const t = (await doc.addTrack("midi")).data.track_id;
    const c = (await doc.addClip(t, 0, 480)).data.clip_id;
    await doc.addNote(c, 60, 0, 480);
    const bytes = await doc.save();
    await doc.close();

    const re = await CadenceDocument.openSnapshot(host, bytes);
    const p = await re.project();
    expect(p.data.tempo_bpm).toBe(140);
    expect(p.data.track_count).toBe(1);
    await re.close();
  });

  it("rejects overlapping clips and honors mute", async () => {
    const doc = await CadenceDocument.open(host);
    const t = (await doc.addTrack()).data.track_id;
    await doc.addClip(t, 0, 960);
    await expect(doc.addClip(t, 480, 960)).rejects.toBeInstanceOf(EngineError);
    const c = (await doc.addClip(t, 960, 480)).data.clip_id;
    await doc.addNote(c, 69, 0, 480);
    await doc.setMuted(t, true);
    const { samples } = await doc.render(960, 1440, 8000);
    expect(samples.every((s) => s === 0)).toBe(true);
    await doc.close();
  });

  it("undo removes an added clip", async () => {
    const doc = await CadenceDocument.open(host);
    const t = (await doc.addTrack()).data.track_id;
    await doc.addClip(t, 0, 960);
    expect(await doc.undo()).toBe(true);
    const p = await doc.project();
    expect((await doc.describe<any>()).data.tracks[0].clips).toHaveLength(0);
    void p;
    await doc.close();
  });
});
