import { describe, expect, it } from "vitest";
import { createRecordingStore } from "../src/recording";
import { PcmCaptureSession, SOURCE_COLUMNS } from "../src/pcmCapture";

const RATE = 48000;
function int16(values: number[]) {
  return { data: Int16Array.from(values).buffer, channels: 1, sampleRate: RATE, timestamp: 0 };
}

describe("PCM capture window follows the WAV file", () => {
  it("ignores buffers before the file starts and after it stops", () => {
    const store = createRecordingStore();
    store.setState({ phase: { kind: "recording", durationMs: 0 } });
    const session = new PcmCaptureSession(store);
    session.onBuffer(int16([32767, 32767]));
    expect(session.frames).toBe(0);
    session.openFileWindow();
    session.onBuffer(int16([100, -100, 50, -50]));
    session.closeFileWindow();
    store.setState({ phase: { kind: "stopping", durationMs: 0 } });
    session.onBuffer(int16([-32768, -32768]));
    expect(session.frames).toBe(4);
    const peaks = session.finalize();
    expect(Math.max(...peaks.map((p) => p.max))).toBeCloseTo(100 / 32768);
  });

  it("derives elapsed time from the frames in the file, not stream timestamps", () => {
    const store = createRecordingStore();
    store.setState({ phase: { kind: "recording", durationMs: 0 } });
    const session = new PcmCaptureSession(store);
    session.openFileWindow();
    session.onBuffer({ ...int16(new Array(4800).fill(10)), timestamp: 9 });
    expect(store.getState().phase).toEqual({ kind: "recording", durationMs: 100 });
  });

  it("advances the timeline over a malformed buffer and counts it", () => {
    const store = createRecordingStore();
    store.setState({ phase: { kind: "recording", durationMs: 0 } });
    const session = new PcmCaptureSession(store);
    session.openFileWindow();
    session.onBuffer(int16([1000, 1000]));
    session.onBuffer({ data: new ArrayBuffer(7), channels: 1, sampleRate: RATE, timestamp: 0 });
    session.onBuffer(int16([-20000, -20000]));
    expect(session.frames).toBe(2 + 3 + 2);
    expect(session.droppedBuffers).toBe(1);
    const columns = session.finalize(7);
    expect(columns[6]!.min).toBeCloseTo(-20000 / 32768);
    expect(columns[3]).toEqual({ min: 0, max: 0 });
  });

  it("fails loudly when a buffer's frame count cannot be derived", () => {
    const store = createRecordingStore();
    store.setState({ phase: { kind: "recording", durationMs: 0 } });
    const session = new PcmCaptureSession(store);
    session.openFileWindow();
    session.onBuffer({ data: new ArrayBuffer(8), channels: 0, sampleRate: RATE, timestamp: 0 });
    expect(store.getState().phase.kind).toBe("error");
  });

  it("finalize returns full-recording columns for the saved lane", () => {
    const store = createRecordingStore();
    store.setState({ phase: { kind: "recording", durationMs: 0 } });
    const session = new PcmCaptureSession(store);
    session.openFileWindow();
    for (let i = 0; i < 400; i++) session.onBuffer(int16(i === 3 ? [32767] : [10]));
    expect(store.getState().levelHistory.length).toBeLessThanOrEqual(160);
    const columns = session.finalize();
    expect(columns).toHaveLength(SOURCE_COLUMNS);
    expect(columns.slice(0, 8).some((p) => p.max > 0.99)).toBe(true);
  });
});

describe("Audio API planar buffers follow the WAV file", () => {
  const recording = () => {
    const store = createRecordingStore();
    store.setState({ phase: { kind: "recording", durationMs: 0 } });
    return store;
  };

  it("keeps asymmetric planar extrema and ignores buffers outside the file window", () => {
    const store = recording();
    const session = new PcmCaptureSession(store);
    session.onPlanarBuffer([new Float32Array([0.9, 0.9])], 2, RATE);
    session.openFileWindow();
    session.onPlanarBuffer([new Float32Array([-0.5, 0.25]), new Float32Array([-0.75, 0.1])], 2, RATE);
    session.closeFileWindow();
    session.onPlanarBuffer([new Float32Array([-1, -1])], 2, RATE);
    expect(session.frames).toBe(2);
    expect(store.getState().levelHistory.at(-1)).toEqual({ min: -0.75, max: 0.25 });
  });

  it("derives elapsed time from file frames at the callback rate", () => {
    const store = recording();
    const session = new PcmCaptureSession(store);
    session.openFileWindow();
    session.onPlanarBuffer([new Float32Array(4800)], 4800, RATE);
    expect(store.getState().phase).toEqual({ kind: "recording", durationMs: 100 });
  });

  it("skips a malformed planar buffer with a known frame count and counts it", () => {
    const store = recording();
    const session = new PcmCaptureSession(store);
    session.openFileWindow();
    session.onPlanarBuffer([new Float32Array([0.5, 0.5])], 2, RATE);
    session.onPlanarBuffer([new Float32Array([Number.NaN, 0, 0])], 3, RATE);
    session.onPlanarBuffer([new Float32Array([-0.6, -0.6])], 2, RATE);
    expect(session.frames).toBe(7);
    expect(session.droppedBuffers).toBe(1);
    const columns = session.finalize(7);
    expect(columns[3]).toEqual({ min: 0, max: 0 });
    expect(columns[6]!.min).toBeCloseTo(-0.6);
  });

  it("aborts when the planar frame count is not a positive integer", () => {
    const store = recording();
    const messages: string[] = [];
    const session = new PcmCaptureSession(store, "int16", (m) => messages.push(m));
    session.openFileWindow();
    session.onPlanarBuffer([new Float32Array(4)], Number.NaN, RATE);
    expect(messages).toHaveLength(1);
    session.onPlanarBuffer([new Float32Array([0.5])], 1, RATE);
    expect(session.frames).toBe(0);
  });

  it("pads the timeline to the finalized file duration so columns stay positioned", () => {
    const store = recording();
    const session = new PcmCaptureSession(store);
    session.openFileWindow();
    session.onPlanarBuffer([new Float32Array(48000).fill(0.5)], 48000, RATE);
    // The file is 2 s long; the last second never reached the callback.
    const columns = session.finalize(4, 2);
    expect(columns[1]!.max).toBeCloseTo(0.5);
    expect(columns[3]).toEqual({ min: 0, max: 0 });
    expect(store.getState().levelHistory).toEqual(columns);
  });
});
