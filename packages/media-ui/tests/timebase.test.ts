import { describe, expect, it } from "vitest";
import {
  FRAME_RATES, assertFrameRate, clampFrame,
  formatTimecode, framesToSeconds, secondsToFrame,
} from "../src/timebase";

describe("frame-accurate transport math", () => {
  it("round trips frame indices through seconds", () => {
    for (const rate of Object.values(FRAME_RATES)) {
      for (const frame of [0, 1, 23, 1798, 1800, 17982, 250_000]) {
        expect(secondsToFrame(framesToSeconds(frame, rate), rate)).toBe(frame);
      }
    }
  });
  it("generates non-drop timecode", () => {
    expect(formatTimecode(0, FRAME_RATES.VIDEO_30)).toBe("00:00:00:00");
    expect(formatTimecode(1799, FRAME_RATES.VIDEO_30)).toBe("00:00:59:29");
    expect(formatTimecode(1800, FRAME_RATES.VIDEO_30)).toBe("00:01:00:00");
    expect(formatTimecode(108000, FRAME_RATES.VIDEO_30)).toBe("01:00:00:00");
  });
  it("uses SMPTE-style drop-frame labeling for 29.97fps", () => {
    expect(formatTimecode(0, FRAME_RATES.NTSC_2997, { dropFrame: true }))
      .toBe("00:00:00;00");
    expect(formatTimecode(1800, FRAME_RATES.NTSC_2997, { dropFrame: true }))
      .toBe("00:01:00;02");
    expect(formatTimecode(17982, FRAME_RATES.NTSC_2997, { dropFrame: true }))
      .toBe("00:10:00;00");
  });
  it("uses drop frame labeling for 59.94fps", () => {
    expect(formatTimecode(35964, FRAME_RATES.NTSC_5994, { dropFrame: true }))
      .toBe("00:10:00;00");
  });
  it("clamps and rejects invalid timebases/frames", () => {
    expect(clampFrame(-15, 100)).toBe(0);
    expect(clampFrame(157.9, 100)).toBe(100);
    expect(() => clampFrame(NaN, 20)).toThrow();
    expect(() => assertFrameRate({ numerator: 0, denominator: 1 })).toThrow();
    expect(() => formatTimecode(0, FRAME_RATES.FILM_24, { dropFrame: true }))
      .toThrow();
    expect(() => secondsToFrame(-1, FRAME_RATES.FILM_24)).toThrow();
  });
});
