import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { CadenceDocument, OPS } from "../src/index";

// Drives moveNote / resizeNote / setVelocity through the compiled nf-cli
// binary, so the payload names in CadenceDocument are checked against the
// Rust engine rather than a mock.

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
}

async function notes(doc: CadenceDocument): Promise<Note[]> {
  const d = await doc.describe<{ tracks: { clips: { notes: Note[] }[] }[] }>();
  return d.data.tracks[0]!.clips[0]!.notes;
}

async function withTwoNotes(): Promise<{ doc: CadenceDocument; clip: number }> {
  const doc = await CadenceDocument.open(host, 120);
  const track = (await doc.addTrack("midi", "keys")).data.track_id;
  const clip = (await doc.addClip(track, 0, 960)).data.clip_id;
  await doc.addNote(clip, 60, 0, 240, 100);
  await doc.addNote(clip, 64, 240, 240, 90);
  return { doc, clip };
}

describe("note edit ops against the real Rust Cadence engine", () => {
  it("exposes the op names", () => {
    expect(OPS.moveNote).toBe("moveNote");
    expect(OPS.resizeNote).toBe("resizeNote");
    expect(OPS.setVelocity).toBe("setVelocity");
  });

  it("moves, resizes and re-velocities a note in place", async () => {
    const { doc, clip } = await withTwoNotes();
    try {
      await doc.moveNote(clip, 0, 480, 67);
      await doc.resizeNote(clip, 0, 360);
      await doc.setVelocity(clip, 0, 12);
      const [a, b] = await notes(doc);
      expect(a).toEqual({ pitch: 67, velocity: 12, start_ticks: 480, length_ticks: 360, channel: 0 });
      expect(b).toEqual({ pitch: 64, velocity: 90, start_ticks: 240, length_ticks: 240, channel: 0 });

      // A time-only move leaves the pitch alone.
      await doc.moveNote(clip, 0, 0);
      expect((await notes(doc))[0]).toMatchObject({ pitch: 67, start_ticks: 0 });
    } finally {
      await doc.close();
    }
  });

  it("undoes each edit as one step, including a pitch+time move", async () => {
    const { doc, clip } = await withTwoNotes();
    try {
      const base = await notes(doc);
      await doc.moveNote(clip, 1, 600, 48);
      await doc.resizeNote(clip, 1, 120);
      await doc.setVelocity(clip, 1, 127);
      expect(await doc.undo()).toBe(true);
      expect((await notes(doc))[1]).toMatchObject({ velocity: 90, length_ticks: 120 });
      expect(await doc.undo()).toBe(true);
      expect((await notes(doc))[1]).toMatchObject({ length_ticks: 240, start_ticks: 600, pitch: 48 });
      expect(await doc.undo()).toBe(true);
      expect(await notes(doc)).toEqual(base);
      expect(await doc.redo()).toBe(true);
      expect((await notes(doc))[1]).toMatchObject({ start_ticks: 600, pitch: 48 });
    } finally {
      await doc.close();
    }
  });

  it("rejects bad edits with the engine's error code and leaves the note", async () => {
    const { doc, clip } = await withTwoNotes();
    try {
      const before = await notes(doc);
      const cases: [Promise<unknown>, string][] = [
        [doc.moveNote(clip, 0, 721), "out_of_bounds"],
        [doc.moveNote(clip, 0, 0, 128), "validation"],
        [doc.resizeNote(clip, 0, 961), "out_of_bounds"],
        [doc.resizeNote(clip, 0, 0), "validation"],
        [doc.setVelocity(clip, 0, 128), "validation"],
        [doc.setVelocity(clip, 5, 10), "out_of_bounds"],
        [doc.moveNote(999, 0, 0), "not_found"],
      ];
      for (const [pending, code] of cases) {
        const error = await pending.then(() => undefined, (e: unknown) => e);
        expect(error).toBeInstanceOf(EngineError);
        expect((error as EngineError).code).toBe(code);
      }
      expect(await notes(doc)).toEqual(before);
    } finally {
      await doc.close();
    }
  });

  it("renders the edited velocity: velocity 0 everywhere is silence", async () => {
    const { doc, clip } = await withTwoNotes();
    try {
      await doc.setVelocity(clip, 0, 0);
      await doc.setVelocity(clip, 1, 0);
      const silent = await doc.render(0, 960, 8000);
      expect(silent.samples.every((s) => s === 0)).toBe(true);
      await doc.setVelocity(clip, 1, 127);
      const loud = await doc.render(0, 960, 8000);
      expect(loud.samples.some((s) => s !== 0)).toBe(true);
    } finally {
      await doc.close();
    }
  });
});
