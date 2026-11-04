// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  meanSpeed, positionToSpeed, previewDurationSeconds,
  sampleSpeeds, speedToPosition, validateCurve,
} from "../src/math";

describe("speed curve parity and validation", () => {
  const flat = [{ at: 0, speed: 1 }, { at: 1, speed: 1 }];
  it("maps the three logarithmic speed positions", () => {
    expect(speedToPosition(0.1)).toBeCloseTo(0);
    expect(speedToPosition(1)).toBeCloseTo(0.5);
    expect(speedToPosition(10)).toBeCloseTo(1);
    expect(positionToSpeed(0.5)).toBeCloseTo(1);
  });
  it("averages by trapezoidal integration", () => {
    expect(meanSpeed(flat)).toBeCloseTo(1);
    expect(previewDurationSeconds(8, [{at:0,speed:2},{at:1,speed:2}])).toBeCloseTo(4);
  });
  it("samples linear segments", () => {
    expect(sampleSpeeds([{at:0,speed:1},{at:1,speed:3}],5))
      .toEqual([1, 1.5, 2, 2.5, 3]);
  });
  it("rejects duplicate, nonfinite and out-of-range input", () => {
    expect(() => validateCurve([{at:0,speed:1},{at:0,speed:2}])).toThrow();
    expect(() => validateCurve([{at:0,speed:1},{at:1,speed:Infinity}])).toThrow();
    expect(() => sampleSpeeds(flat,0)).toThrow();
  });
});
