import { describe, expect, it } from "vitest";
import { normalizePeak, peaksToBars, resamplePeaks } from "../src/waveform";

describe("cross-platform waveform geometry", () => {
  it("preserves min/max extrema while resampling", () => {
    const peaks = [
      { min: -0.3, max: 0.4 }, { min: -1, max: 0.9 },
      { min: -0.2, max: 0.1 }, { min: -0.8, max: 1 },
    ];
    expect(resamplePeaks(peaks, 2)).toEqual([
      { min: -1, max: 0.9 }, { min: -0.8, max: 1 },
    ]);
  });
  it("duplicates sparse bins to fill a responsive lane", () => {
    expect(resamplePeaks([{ min: -0.2, max: 0.5 }], 3))
      .toEqual(Array(3).fill({ min: -0.2, max: 0.5 }));
  });
  it("produces silence when no peaks exist", () => {
    expect(resamplePeaks([], 2)).toEqual([
      { min: 0, max: 0 }, { min: 0, max: 0 },
    ]);
  });
  it("calculates vertically offset bars", () => {
    expect(peaksToBars([{ min: -1, max: 1 }], 80)).toEqual([
      { top: 0, height: 80 },
    ]);
    expect(peaksToBars([{ min: 0, max: 0 }], 80)).toEqual([
      { top: 40, height: 1 },
    ]);
  });
  it("rejects malformed peaks and out-of-range sizes", () => {
    expect(() => normalizePeak({ min: 2, max: -2 })).toThrow();
    expect(() => normalizePeak({ min: NaN, max: 1 })).toThrow();
    expect(() => resamplePeaks([], 0)).toThrow();
    expect(() => peaksToBars([], Infinity)).toThrow();
  });
});
