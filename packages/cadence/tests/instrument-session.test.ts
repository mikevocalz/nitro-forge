import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { CadenceDocument } from "../src/index";
import { CadenceInstrumentSession } from "../src/instrument-session";

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

describe("native instrument session (real Rust host, no fake UI document)", () => {
  it("keeps initialization out of history and commits both XY axes as one undo entry", async () => {
    const session = await CadenceInstrumentSession.open(host);
    expect(await session.undo()).toBe(false);
    expect(session.state).toMatchObject({ gain: 1, pan: 0 });
    expect(session.xyPad).toMatchObject({ x: 0.5, y: 1 });
    await session.xyPad.onCommit({ x: 0.75, y: 0.4 });
    expect(session.state).toMatchObject({ gain: 0.4, pan: 0.5 });
    await session.undo(); expect(session.state).toMatchObject({ gain: 1, pan: 0 });
    expect(await session.undo()).toBe(false);
    await session.redo(); expect(session.state).toMatchObject({ gain: 0.4, pan: 0.5 });
    await expect(session.setGainAndPan(0.8, 2)).rejects.toThrow("range");
    expect(session.state).toMatchObject({ gain: 0.4, pan: 0.5 });
    await session.close();
  });
  it("reads acknowledged gain/pan, serializes edits, and correctly undoes/redoes", async () => {
    const session = await CadenceInstrumentSession.open(host, {
      tempoBpm: 128,
      trackName: "Native instrument test",
    });
    const seen: number[] = [];
    const off = session.subscribe((state) => seen.push(state.gain));
    expect(session.state).toMatchObject({
      trackName: "Native instrument test", gain: 1, pan: 0, tempoBpm: 128,
    });

    // Native onCommit handlers must await the real Rust engine result.
    const gain = session.controls.gain;
    const pan = session.controls.pan;
    await Promise.all([gain.onCommit(0.41), pan.onCommit(-0.35)]);
    expect(session.state.gain).toBe(0.41);
    expect(session.state.pan).toBe(-0.35);
    expect(seen).toHaveLength(2);

    // InstrumentKnob (@nyc-tron/ui) props share the same serialized Rust path.
    const knob = session.knobs.gain;
    expect(knob).toMatchObject({ min: 0, max: 1, step: 0.01, unit: "" });
    expect(gain).toMatchObject({ minimum: 0, maximum: 1, step: 0.01 });
    const committed = await knob.onCommit(0.52);
    expect(committed.gain).toBe(0.52);
    expect(session.state.gain).toBe(0.52);
    expect(seen).toHaveLength(3);
    expect(await session.undo()).toBe(true);
    expect(session.state.gain).toBe(0.41);

    expect(await session.undo()).toBe(true);
    expect(session.state.pan).toBe(0);
    expect(await session.redo()).toBe(true);
    expect(session.state.pan).toBe(-0.35);

    const bytes = await session.save();
    expect(bytes.length).toBeGreaterThan(20);
    off();
    await session.close();
    const reopened = await CadenceDocument.openSnapshot(host, bytes);
    const state = (await reopened.describe<{ tracks: Array<{ volume: number; pan: number }> }>()).data;
    expect(state.tracks[0]?.volume).toBe(0.41);
    expect(state.tracks[0]?.pan).toBe(-0.35);
    await reopened.close();
    await expect(session.setGain(0.9)).rejects.toThrow(/closed/);
  });

  it("rejects invalid values without mutating the engine or notifying listeners", async () => {
    const session = await CadenceInstrumentSession.open(host);
    let notifications = 0;
    session.subscribe(() => { notifications++; });
    const actual = session.state;
    await expect(session.setGain(9)).rejects.toThrow(/range/);
    await expect(session.setPan(Number.NaN)).rejects.toThrow(/range/);
    expect(session.state).toBe(actual);
    expect(notifications).toBe(0);
    await session.setGain(0.64);
    expect(session.state.gain).toBe(0.64);
    expect(notifications).toBe(1);
    await session.close();
  });

  it("does not misreport a failed open and validates constraints first", async () => {
    await expect(CadenceInstrumentSession.open(host, { tempoBpm: 800 }))
      .rejects.toThrow(/tempo/);
    await expect(CadenceInstrumentSession.open(host, { trackName: " " }))
      .rejects.toThrow(/Track name/);
  });
});
