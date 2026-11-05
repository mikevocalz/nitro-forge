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
