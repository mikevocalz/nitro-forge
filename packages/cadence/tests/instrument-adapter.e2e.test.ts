import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { CadenceDocument } from "../src/index";
import { createCadenceTrackInstrumentBindings } from "../src/instrument-adapter";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

interface TrackState {
  volume: number;
  pan: number;
}

async function trackState(doc: CadenceDocument): Promise<TrackState> {
  const d = (await doc.describe<{ tracks: TrackState[] }>()).data;
  return d.tracks[0]!;
}

describe("instrument adapter against the real Rust Cadence engine", () => {
  it("commits knob gestures as engine ops that undo", async () => {
    const doc = await CadenceDocument.open(host, 120);
    try {
      const trackId = (await doc.addTrack("midi", "keys")).data.track_id;
      const controls = createCadenceTrackInstrumentBindings(doc, trackId);

      await controls.gain.onCommit(0.25);
      await controls.pan.onCommit(-0.5);
      expect(await trackState(doc)).toMatchObject({ volume: 0.25, pan: -0.5 });

      expect(await doc.undo()).toBe(true);
      expect(await trackState(doc)).toMatchObject({ volume: 0.25, pan: 0 });

      await expect(controls.gain.onCommit(1.5)).rejects.toThrow(RangeError);
      expect((await trackState(doc)).volume).toBe(0.25);
    } finally {
      await doc.close();
    }
  });

  it("surfaces engine rejection for a track that does not exist", async () => {
    const doc = await CadenceDocument.open(host, 120);
    try {
      const controls = createCadenceTrackInstrumentBindings(doc, 999);
      await expect(controls.gain.onCommit(0.5)).rejects.toThrow();
    } finally {
      await doc.close();
    }
  });
});
