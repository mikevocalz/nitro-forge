// Ported from Nitro Forge PR #25 packages/media-ui/tests/timebase.test.ts
// (vitest) to node:test, unchanged in coverage.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FRAME_RATES, assertFrameRate, clampFrame,
  formatTimecode, framesToSeconds, secondsToFrame, frameToPosition, positionToFrame,
} from "../src/timebase.ts";

test("round trips frame indices through seconds", () => {
  for (const rate of Object.values(FRAME_RATES)) {
    for (const frame of [0, 1, 23, 1798, 1800, 17982, 250_000]) {
      assert.equal(secondsToFrame(framesToSeconds(frame, rate), rate), frame);
    }
  }
});
test("seconds use the exact rational rate", () => {
  assert.equal(framesToSeconds(24, FRAME_RATES.FILM_24), 1);
  assert.equal(framesToSeconds(30000, FRAME_RATES.NTSC_2997), 1001);
  assert.equal(secondsToFrame(1001, FRAME_RATES.NTSC_2997), 30000);
  assert.equal(secondsToFrame(0.02, FRAME_RATES.FILM_24), 0);
  assert.equal(secondsToFrame(0.03, FRAME_RATES.FILM_24), 1);
});
test("generates non-drop timecode", () => {
  assert.equal(formatTimecode(0, FRAME_RATES.VIDEO_30), "00:00:00:00");
  assert.equal(formatTimecode(1799, FRAME_RATES.VIDEO_30), "00:00:59:29");
  assert.equal(formatTimecode(1800, FRAME_RATES.VIDEO_30), "00:01:00:00");
  assert.equal(formatTimecode(108000, FRAME_RATES.VIDEO_30), "01:00:00:00");
});
test("uses SMPTE-style drop-frame labeling for 29.97fps", () => {
  assert.equal(formatTimecode(0, FRAME_RATES.NTSC_2997, { dropFrame: true }), "00:00:00;00");
  assert.equal(formatTimecode(1800, FRAME_RATES.NTSC_2997, { dropFrame: true }), "00:01:00;02");
  assert.equal(formatTimecode(17982, FRAME_RATES.NTSC_2997, { dropFrame: true }), "00:10:00;00");
});
test("uses drop frame labeling for 59.94fps", () => {
  assert.equal(formatTimecode(35964, FRAME_RATES.NTSC_5994, { dropFrame: true }), "00:10:00;00");
});
test("normalizes long media transport without exposing giant native step counts", () => {
  assert.equal(frameToPosition(0, 1000000), 0);
  assert.ok(Math.abs(frameToPosition(500000, 1000000) - 0.5) < 1e-9);
  assert.equal(positionToFrame(0.5, 1000000), 500000);
  assert.equal(positionToFrame(1, 1000000), 1000000);
  assert.equal(frameToPosition(0, 0), 0);
  assert.equal(positionToFrame(0.8, 0), 0);
  assert.throws(() => positionToFrame(NaN, 1), RangeError);
  assert.throws(() => positionToFrame(2, 1), RangeError);
});
test("clamps and rejects invalid timebases/frames", () => {
  assert.equal(clampFrame(-15, 100), 0);
  assert.equal(clampFrame(157.9, 100), 100);
  assert.throws(() => clampFrame(NaN, 20), RangeError);
  assert.throws(() => assertFrameRate({ numerator: 0, denominator: 1 }), RangeError);
  assert.throws(() => formatTimecode(0, FRAME_RATES.FILM_24, { dropFrame: true }), RangeError);
  assert.throws(() => secondsToFrame(-1, FRAME_RATES.FILM_24), RangeError);
  assert.throws(() => secondsToFrame(Infinity, FRAME_RATES.FILM_24), RangeError);
  assert.throws(() => framesToSeconds(1.5, FRAME_RATES.FILM_24), RangeError);
  assert.throws(() => framesToSeconds(-1, FRAME_RATES.FILM_24), RangeError);
  assert.throws(() => secondsToFrame(Number.MAX_SAFE_INTEGER, FRAME_RATES.VIDEO_60), /safe integer/);
});
