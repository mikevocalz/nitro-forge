// Covers the seconds helpers media-ui re-exports from NYC-Tron UI.
import { describe, expect, it } from "vitest";
import { FRAME_RATES, framesToSeconds, secondsToFrame } from "../src/timebase";

describe("NYC-Tron seconds helpers through media-ui", () => {
  it("round trips frame indices through seconds", () => {
    for (const rate of Object.values(FRAME_RATES)) {
      for (const frame of [0, 1, 23, 1798, 1800, 17982, 250_000]) {
        expect(secondsToFrame(framesToSeconds(frame, rate), rate)).toBe(frame);
      }
    }
  });
  it("rejects invalid input", () => {
    expect(() => secondsToFrame(-1, FRAME_RATES.FILM_24)).toThrow();
    expect(() => framesToSeconds(1.5, FRAME_RATES.FILM_24)).toThrow();
    expect(() => framesToSeconds(1, { numerator: 0, denominator: 1 })).toThrow();
  });
});
