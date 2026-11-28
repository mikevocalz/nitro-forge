import test from "node:test";
import assert from "node:assert/strict";
import {
  FADER_RANGES, assertFaderRange, clampGain, dbToGain, dragToGain, formatDb,
  gainToDb, gainToPosition, maxGain, positionToGain, stepGain,
} from "../src/audio/level.ts";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const U = FADER_RANGES.UNITY;

test("gain and dB convert both ways, silence is -Infinity", () => {
  assert.equal(gainToDb(1), 0);
  near(gainToDb(0.5), -6.020599913279624);
  assert.equal(gainToDb(0), -Infinity);
  assert.equal(dbToGain(-Infinity), 0);
  near(dbToGain(-6), 0.5011872336272722);
  near(dbToGain(gainToDb(0.25)), 0.25);
  assert.throws(() => gainToDb(-0.1), RangeError);
  assert.throws(() => gainToDb(NaN), RangeError);
  assert.throws(() => dbToGain(Infinity), RangeError);
});
test("travel is linear in dB with silence at the bottom", () => {
  assert.equal(gainToPosition(0, U), 0);
  assert.equal(gainToPosition(1, U), 1);
  near(gainToPosition(dbToGain(-30), U), 0.5);
  assert.equal(gainToPosition(dbToGain(-80), U), 0);
  assert.equal(gainToPosition(4, U), 1);
  assert.equal(positionToGain(0, U), 0);
  assert.equal(positionToGain(1, U), 1);
  near(positionToGain(0.5, U), dbToGain(-30));
  near(gainToPosition(positionToGain(0.9, FADER_RANGES.CHANNEL), FADER_RANGES.CHANNEL), 0.9, 1e-3);
  assert.throws(() => positionToGain(1.2, U), RangeError);
  assert.throws(() => positionToGain(NaN, U), RangeError);
});
test("ranges are validated and bound the gain ceiling", () => {
  near(maxGain(FADER_RANGES.CHANNEL), dbToGain(6));
  assert.equal(clampGain(3, U), 1);
  assert.equal(clampGain(-1, U), 0);
  assert.throws(() => assertFaderRange({ minDb: 0, maxDb: 0 }), RangeError);
  assert.throws(() => assertFaderRange({ minDb: -60, maxDb: 30 }), RangeError);
  assert.throws(() => assertFaderRange({ minDb: -200, maxDb: 0 }), RangeError);
  assert.throws(() => clampGain(NaN, U), RangeError);
});
test("drag is relative to the grab point and clamps at both ends", () => {
  near(dragToGain(0.5, 0, 100, U), dbToGain(-30));
  near(dragToGain(0.5, 25, 100, U), dbToGain(-15));
  assert.equal(dragToGain(0.5, 500, 100, U), 1);
  assert.equal(dragToGain(0.5, -500, 100, U), 0);
  assert.throws(() => dragToGain(0.5, 10, 0, U), RangeError);
});
test("steps move in dB, enter from and fall to silence", () => {
  near(stepGain(dbToGain(-6), 1, 1, U), dbToGain(-5));
  near(stepGain(dbToGain(-6), -1, 1, U), dbToGain(-7));
  assert.equal(stepGain(1, 1, 1, U), 1);
  near(stepGain(0, 1, 1, U), dbToGain(-60));
  assert.equal(stepGain(dbToGain(-60), -1, 1, U), 0);
  assert.equal(stepGain(0, -1, 1, U), 0);
  assert.throws(() => stepGain(1, 1, 0, U), RangeError);
});
test("readout uses signed dB and an infinity sign for silence", () => {
  assert.equal(formatDb(1), "0.0 dB");
  assert.equal(formatDb(dbToGain(-6)), "-6.0 dB");
  assert.equal(formatDb(dbToGain(3.5)), "+3.5 dB");
  assert.equal(formatDb(0), "-∞ dB");
  assert.equal(formatDb(dbToGain(-0.04)), "0.0 dB");
});

test("steps leave the bottom stop of a deep range in both directions", () => {
  // Below about -100 dB, dbToGain then gainToDb lands under the 0.1 dB grid.
  for (let tenths = -1440; tenths <= -10; tenths++) {
    const range = { minDb: tenths / 10, maxDb: 0 };
    const floor = dbToGain(range.minDb);
    assert.ok(stepGain(floor, 1, 1, range) > floor, `up from minDb ${range.minDb}`);
    const above = dbToGain(range.minDb + 1);
    assert.ok(stepGain(above, -1, 1, range) > 0, `down to minDb ${range.minDb}`);
  }
});
