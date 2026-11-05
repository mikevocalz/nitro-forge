import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { CadenceDocument } from "../src/index";
import {
  createCadenceClipBindings, createCadenceMixerBindings, createCadenceTempoBindings,
  toMidiNotes, toMixerChannels, type CadenceDescribe,
} from "../src/editor-adapter";

// Calls the bindings the way NYC-Tron's mixer and MIDI editors call their
// commit props, against the compiled nf-cli engine, then reads the result
// back through the same mappers the editors render from.

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

async function project(doc: CadenceDocument): Promise<CadenceDescribe> {
  return (await doc.describe<CadenceDescribe>()).data;
}

async function withClip() {
  const doc = await CadenceDocument.open(host, 120);
  const keys = (await doc.addTrack("midi", "Keys")).data.track_id;
  const bass = (await doc.addTrack("midi", "Bass")).data.track_id;
  const clip = (await doc.addClip(keys, 0, 3840)).data.clip_id;
  return { doc, keys, bass, clip };
}

describe("mixer/MIDI editor adapter against the real Rust Cadence engine", () => {
  it("mixer strip commits land on the track and read back as channels", async () => {
    const { doc, keys, bass } = await withClip();
    try {
      const mixer = createCadenceMixerBindings(doc);
      await mixer.onGainCommit(keys, 0.5);
      await mixer.onPanCommit(String(bass), -0.3);
      await mixer.onMutedCommit(bass, true);
      await mixer.onSoloCommit(keys, true);
      expect(toMixerChannels(await project(doc))).toEqual([
        { id: keys, name: "Keys", gain: 0.5, pan: 0, muted: false, solo: true },
        { id: bass, name: "Bass", gain: 1, pan: -0.3, muted: true, solo: false },
      ]);
      expect(await doc.undo()).toBe(true);
      expect(toMixerChannels(await project(doc))[0]!.solo).toBe(false);
      await expect(mixer.onGainCommit(keys, 1.5)).rejects.toThrow(RangeError);
      await expect(mixer.onGainCommit("nope", 0.5)).rejects.toThrow(RangeError);
      await expect(mixer.onMutedCommit(999, true)).rejects.toBeInstanceOf(EngineError);
    } finally {
      await doc.close();
    }
  });

  it("piano roll, velocity lane and step commits are one op each", async () => {
    const { doc, clip } = await withClip();
    try {
      const roll = createCadenceClipBindings(doc, clip, { newNoteVelocity: 90 });
      await roll.onNoteAdd(0, 480, 60);
      await roll.onStepAdd(36, 960, 240, 127);
      await roll.onNoteMove(0, 480, 64);
      await roll.onNoteResize(0, 720);
      await roll.onVelocityCommit(0, 30);
      await roll.onStepVelocity(1, 96);
      expect(toMidiNotes(await project(doc), clip)).toEqual({
        clipTicks: 3840,
        notes: [
          { pitch: 64, velocity: 30, startTicks: 480, lengthTicks: 720 },
          { pitch: 36, velocity: 96, startTicks: 960, lengthTicks: 240 },
        ],
      });
      // One undo per gesture: step velocity, note velocity, resize, then the
      // pitch+time move.
      await doc.undo();
      await doc.undo();
      expect((toMidiNotes(await project(doc), clip)!.notes[0])).toEqual(
        { pitch: 64, velocity: 90, startTicks: 480, lengthTicks: 720 });
      await doc.undo();
      expect((toMidiNotes(await project(doc), clip)!.notes[0])!.lengthTicks).toBe(480);
      await doc.undo();
      expect((toMidiNotes(await project(doc), clip)!.notes[0])).toMatchObject({ pitch: 60, startTicks: 0 });
      await roll.onStepRemove(1);
      await roll.onNoteRemove(0);
      expect(toMidiNotes(await project(doc), clip)!.notes).toEqual([]);
    } finally {
      await doc.close();
    }
  });

  it("rejects edits the engine would refuse, before or by the engine", async () => {
    const { doc, clip } = await withClip();
    try {
      const roll = createCadenceClipBindings(doc, clip);
      await roll.onNoteAdd(0, 240, 60);
      await expect(roll.onNoteMove(0, 0, 128)).rejects.toThrow(RangeError);
      await expect(roll.onNoteMove(0, 1.5, 60)).rejects.toThrow(RangeError);
      await expect(roll.onNoteResize(0, 0)).rejects.toThrow(RangeError);
      await expect(roll.onVelocityCommit(0, 128)).rejects.toThrow(RangeError);
      const pastEnd = await roll.onNoteMove(0, 3700, 60).then(() => undefined, (e: unknown) => e);
      expect((pastEnd as EngineError).code).toBe("out_of_bounds");
      const missing = await roll.onNoteRemove(5).then(() => undefined, (e: unknown) => e);
      expect((missing as EngineError).code).toBe("out_of_bounds");
      expect(toMidiNotes(await project(doc), clip)!.notes).toEqual([
        { pitch: 60, velocity: 100, startTicks: 0, lengthTicks: 240 },
      ]);
      expect(toMidiNotes(await project(doc), 4242)).toBeUndefined();
      expect(() => createCadenceClipBindings(doc, 0)).toThrow(RangeError);
    } finally {
      await doc.close();
    }
  });

  it("tempo and time signature commits", async () => {
    const { doc } = await withClip();
    try {
      const tempo = createCadenceTempoBindings(doc);
      await tempo.onTempoCommit(128.5);
      await tempo.onTimeSignatureCommit([7, 8]);
      const p = await project(doc);
      expect(p.tempo_bpm).toBe(128.5);
      expect(p.time_sig).toEqual([7, 8]);
      await expect(tempo.onTempoCommit(401)).rejects.toThrow(RangeError);
      await expect(tempo.onTimeSignatureCommit([4, 3])).rejects.toThrow(RangeError);
      expect((await project(doc)).time_sig).toEqual([7, 8]);
    } finally {
      await doc.close();
    }
  });
});
