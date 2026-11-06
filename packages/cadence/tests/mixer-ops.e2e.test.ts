import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { CadenceDocument, OPS } from "../src/index";

// Routing, inserts, groups, automation, batch velocity, MIDI channel,
// metronome and the analysis ops, driven through the compiled nf-cli binary
// so CadenceDocument's payload names are checked against the Rust engine.

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

interface Track {
  id: number;
  kind: string;
  output: number | null;
  sends: { bus: number; level: number }[];
  inserts: { id: number; kind: string; bypassed: boolean; params: Record<string, unknown> }[];
  group: string | null;
  solo: boolean;
  muted: boolean;
  solo_safe: boolean;
  automation: Record<"gain" | "pan", { mode: string; points: { ticks: number; value: number }[] }>;
  clips: { notes: { velocity: number; channel: number }[] }[];
}
interface Doc {
  tracks: Track[];
  metronome: { enabled: boolean; volume: number };
}

async function state(doc: CadenceDocument): Promise<Doc> {
  return (await doc.describe<Doc>()).data;
}

/** One midi track with a clip [0, 960) holding A4, plus one bus. */
async function setup() {
  const doc = await CadenceDocument.open(host, 120);
  const track = (await doc.addTrack("midi", "Keys")).data.track_id;
  const clip = (await doc.addClip(track, 0, 960)).data.clip_id;
  await doc.addNote(clip, 69, 0, 960, 127);
  const bus = (await doc.addTrack("bus", "Verb")).data.track_id;
  return { doc, track, clip, bus };
}

async function rejectsWith(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EngineError);
  expect((err as EngineError).code).toBe(code);
}

const RANGE = { fromTicks: 240, toTicks: 720, sampleRate: 8000 } as const;

describe("mixer ops against the real Rust Cadence engine", () => {
  it("exposes the op names", () => {
    for (const op of ["setTrackOutput", "addInsert", "setGroupSolo", "setVelocities", "meter", "spectrogram"] as const) {
      expect(OPS[op]).toBe(op);
    }
  });

  it("routes a track through a bus and meters both", async () => {
    const { doc, track, bus } = await setup();
    try {
      await doc.setTrackOutput(track, bus);
      await doc.setSend(track, bus, 0.25);
      await doc.setTrackGain(bus, 0.5);
      const s = await state(doc);
      expect(s.tracks[0]).toMatchObject({ output: bus, sends: [{ bus, level: 0.25 }] });
      expect(s.tracks[1]!.kind).toBe("bus");
      const m = (await doc.meter(RANGE, 1000)).data;
      expect(m.tracks.map(t => t.id)).toEqual([track, bus]);
      // Dry through the bus plus a quarter send, all at the bus's half gain.
      expect(m.master.max_peak).toBeCloseTo(Math.SQRT1_2 * 1.25 * 0.5, 1);
      await rejectsWith(doc.setTrackOutput(bus, bus), "validation");
      await doc.removeTrack(bus);
      expect((await state(doc)).tracks[0]).toMatchObject({ output: null, sends: [] });
    } finally {
      await doc.close();
    }
  });

  it("runs insert effects and reads their curves", async () => {
    const { doc, track } = await setup();
    try {
      const eq = (await doc.addInsert(track, "eq", { params: { bands: [{ type: "peak", freq_hz: 1000, gain_db: 6, q: 1 }] } })).data.insert_id;
      const comp = (await doc.addInsert(track, "compressor")).data.insert_id;
      await doc.moveInsert(comp, 0);
      await doc.setInsertBypass(comp, true);
      await doc.setInsertParams(comp, { ratio: 6 });
      const ins = (await state(doc)).tracks[0]!.inserts;
      expect(ins.map(i => [i.id, i.kind, i.bypassed])).toEqual([[comp, "compressor", true], [eq, "eq", false]]);
      expect(ins[0]!.params.ratio).toBe(6);
      const response = (await doc.eqResponse(eq, 513)).data.points;
      expect(Math.max(...response.map(p => p.db))).toBeCloseTo(6, 1);
      const curve = (await doc.dynamicsCurve(comp)).data.points;
      expect(curve).toHaveLength(61);
      const presets = (await doc.insertPresets("eq")).data.presets;
      expect(presets.map(p => p.id)).toContain("vocal-presence");
      await doc.applyInsertPreset(eq, "telephone");
      expect(((await state(doc)).tracks[0]!.inserts[1]!.params.bands as unknown[]).length).toBe(3);
      await rejectsWith(doc.setInsertParams(comp, { ratio: 40 }), "validation");
      await rejectsWith(doc.removeInsert(9999), "not_found");
    } finally {
      await doc.close();
    }
  });

  it("solos a group in one undo step and honours solo-safe", async () => {
    const { doc, track } = await setup();
    try {
      const other = (await doc.addTrack("midi", "Pad")).data.track_id;
      await doc.setTrackGroup(track, "Keys");
      await doc.setTrackGroup(other, "Keys");
      expect((await doc.setGroupSolo("Keys", true)).data.tracks).toBe(2);
      expect((await state(doc)).tracks.filter(t => t.solo)).toHaveLength(2);
      await doc.undo();
      expect((await state(doc)).tracks.some(t => t.solo)).toBe(false);
      await doc.setSoloSafe(other, true);
      expect((await state(doc)).tracks[2]!.solo_safe).toBe(true);
      await rejectsWith(doc.setGroupMuted("Nope", true), "not_found");
    } finally {
      await doc.close();
    }
  });

  it("automates gain in read mode", async () => {
    const { doc, track } = await setup();
    try {
      await doc.addAutomationPoint(track, "gain", 0, 0.25);
      await doc.addAutomationPoint(track, "gain", 960, 0.25);
      await doc.moveAutomationPoint(track, "gain", 1, 900, 0.25);
      const offPeak = (await doc.meter(RANGE, 1000)).data.master.max_peak;
      await doc.setAutomationMode(track, "gain", "read");
      const readPeak = (await doc.meter(RANGE, 1000)).data.master.max_peak;
      expect(readPeak / offPeak).toBeCloseTo(0.25, 1);
      await rejectsWith(doc.addAutomationPoint(track, "gain", 0, 0.5), "validation");
      await doc.removeAutomationPoint(track, "gain", 0);
      expect((await state(doc)).tracks[0]!.automation.gain.points).toEqual([{ ticks: 900, value: 0.25 }]);
    } finally {
      await doc.close();
    }
  });

  it("sets many velocities as one atomic step and carries a MIDI channel", async () => {
    const { doc, clip } = await setup();
    try {
      await doc.addNote(clip, 60, 0, 240, 100, 9);
      const before = await state(doc);
      expect(before.tracks[0]!.clips[0]!.notes.map(n => n.channel)).toEqual([0, 9]);
      await rejectsWith(doc.setVelocities(clip, [{ index: 0, velocity: 1 }, { index: 5, velocity: 1 }]), "out_of_bounds");
      expect(await state(doc)).toEqual(before);
      expect((await doc.setVelocities(clip, [{ index: 0, velocity: 20 }, { index: 1, velocity: 40 }])).data.changed).toBe(2);
      expect((await state(doc)).tracks[0]!.clips[0]!.notes.map(n => n.velocity)).toEqual([20, 40]);
      await doc.undo();
      expect(await state(doc)).toEqual(before);
      await doc.setNoteChannel(clip, 0, 3);
      expect((await state(doc)).tracks[0]!.clips[0]!.notes[0]!.channel).toBe(3);
      await rejectsWith(doc.setNoteChannel(clip, 0, 16), "validation");
    } finally {
      await doc.close();
    }
  });

  it("clicks the metronome only when enabled and requested", async () => {
    const doc = await CadenceDocument.open(host, 120);
    try {
      await doc.setMetronome(true, 0.8);
      expect((await state(doc)).metronome).toEqual({ enabled: true, volume: 0.8 });
      const bounce = await doc.render(0, 3840, 8000);
      expect(bounce.samples.every(v => v === 0)).toBe(true);
      const preview = await doc.render(0, 3840, 8000, true);
      expect(preview.samples.some(v => v !== 0)).toBe(true);
    } finally {
      await doc.close();
    }
  });

  it("measures loudness and a spectrogram", async () => {
    const { doc } = await setup();
    try {
      const l = (await doc.loudness({ fromTicks: 0, toTicks: 960 })).data;
      expect(l.integrated_lufs).toBeLessThan(0);
      expect(l.sample_peak_dbfs).toBeCloseTo(-3, 0);
      const s = (await doc.spectrogram({ fromTicks: 0, toTicks: 960 }, { fftSize: 1024, bands: 24 })).data;
      expect(s.bands_hz).toHaveLength(24);
      expect(s.frames[0]).toHaveLength(24);
      await rejectsWith(doc.spectrogram({ fromTicks: 0, toTicks: 960 }, { fftSize: 1000 }), "validation");
    } finally {
      await doc.close();
    }
  });
});
