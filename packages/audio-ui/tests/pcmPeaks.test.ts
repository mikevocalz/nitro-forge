import { describe, expect, it } from "vitest";
import { peakFromPcmBuffer, WaveformPeakAccumulator } from "../src/pcmPeaks";

describe("actual PCM source peak extraction", () => {
  it("reads mono signed 16-bit WAV samples without inventing peaks", () => {
    const values = Int16Array.from([-32768, -16384, 0, 16384, 32767]);
    const out = peakFromPcmBuffer(values.buffer, 1, "int16");
    expect(out.frames).toBe(5);
    expect(out.peak.min).toBe(-1);
    expect(out.peak.max).toBeCloseTo(32767 / 32768);
  });

  it("reads interleaved stereo frames across both channels", () => {
    const values = Int16Array.from([1000, -32000, 20000, -1000]);
    const out = peakFromPcmBuffer(values.buffer, 2, "int16");
    expect(out.frames).toBe(2);
    expect(out.peak.min).toBeCloseTo(-32000 / 32768);
    expect(out.peak.max).toBeCloseTo(20000 / 32768);
  });

  it("handles normalized float PCM and rejects NaN frames", () => {
    const values = Float32Array.from([-0.6, 0.25, 0.9]);
    expect(peakFromPcmBuffer(values.buffer, 1, "float32").peak)
      .toEqual({ min: -0.6000000238418579, max: 0.8999999761581421 });
    const invalid = Float32Array.from([Number.NaN, 0.5]);
    expect(() => peakFromPcmBuffer(invalid.buffer, 1, "float32")).toThrow();
  });

  it("rejects partial PCM frames and unknown formats", () => {
    expect(() => peakFromPcmBuffer(new ArrayBuffer(3), 1, "int16")).toThrow();
    expect(() => peakFromPcmBuffer(new ArrayBuffer(2), 0, "int16")).toThrow();
  });
});

describe("bounded long-recording peak pyramid", () => {
  it("never retains PCM source bytes and does not drop max transient", () => {
    const acc = new WaveformPeakAccumulator(8);
    for (let i = 0; i < 200; i++) {
      acc.append(i === 61 ? { min: -1, max: 1 } : { min: -0.1, max: 0.1 }, 1024);
    }
    expect(acc.frames).toBe(200 * 1024);
    expect(acc.segments).toBeLessThanOrEqual(8);
    const output = acc.toColumns(16);
    expect(output).toHaveLength(16);
    expect(Math.max(...output.map((p) => p.max))).toBe(1);
    expect(Math.min(...output.map((p) => p.min))).toBe(-1);
  });

  it("preserves timeline ranges even when PCM chunks have different lengths", () => {
    const acc = new WaveformPeakAccumulator(8);
    acc.append({ min: 0, max: 1 }, 100);
    acc.append({ min: -1, max: 0 }, 900);
    const output = acc.toColumns(10);
    expect(output[0]!.max).toBe(1);
    expect(output[9]!.min).toBe(-1);
  });

  it("resets between recording sessions and emits bounded silence", () => {
    const acc = new WaveformPeakAccumulator(4);
    acc.append({ min: -0.4, max: 0.4 }, 1024);
    acc.reset();
    expect(acc.frames).toBe(0);
    expect(acc.toColumns(2)).toEqual([{ min: 0, max: 0 }, { min: 0, max: 0 }]);
    expect(() => acc.append({ min: -2, max: 2 }, 30)).toThrow();
  });
});
