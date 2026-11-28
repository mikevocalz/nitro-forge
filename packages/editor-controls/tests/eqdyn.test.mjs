import test from "node:test";
import assert from "node:assert/strict";
import {
  EQ_DEFAULT_RANGE_DB, bandTypeName, clampFreq, dbToY, describeBand, describeGain, dragBand, eqFrequencyGridlines,
  eqGainGridlines, eqHandlePosition, eqResponseSegments, formatFreq, formatFreqShort, formatGain, formatQ, freqToX,
  isPassBand, polylineSegments, roundFreq, roundGain, stepBand, xToFreq, yToDb,
} from "../src/audio/eq-graph.ts";
import {
  RATIO_STEPS, clampThreshold, curveOutputAt, describeDynamics, dragThreshold, dynamicsCurveSegments,
  dynamicsGridlines, dynamicsPoint, formatKnee, formatMakeup, formatRatio, formatThreshold, levelToOffset,
  stepRatio, unitySegment,
} from "../src/audio/dynamics-graph.ts";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const plot = { width: 300, height: 200, rangeDb: EQ_DEFAULT_RANGE_DB };

test("log frequency maps 20 Hz..20 kHz across the width, one decade per third", () => {
  assert.equal(freqToX(20, 300), 0);
  near(freqToX(200, 300), 100);
  near(freqToX(2000, 300), 200);
  near(freqToX(20000, 300), 300);
  near(xToFreq(150, 300), 20 * 10 ** 1.5);
  near(xToFreq(freqToX(1234, 300), 300), 1234, 1e-6);
  assert.equal(freqToX(5, 300), 0, "below 20 Hz clamps");
  assert.equal(freqToX(50000, 300), 300, "above 20 kHz clamps");
  assert.throws(() => freqToX(100, 0), /Width/);
  assert.throws(() => clampFreq(NaN), /finite/);
});

test("dB maps around the centre line and clamps to the visible range", () => {
  assert.equal(dbToY(0, 200, 18), 100);
  assert.equal(dbToY(18, 200, 18), 0);
  assert.equal(dbToY(-18, 200, 18), 200);
  assert.equal(dbToY(24, 200, 18), 0, "past range rides the top edge");
  near(yToDb(50, 200, 18), 9);
  near(yToDb(dbToY(-7.5, 200, 18), 200, 18), -7.5);
  assert.throws(() => dbToY(0, 200, 0), /positive/);
});

test("gridlines: 100 Hz, 1k, 10k labelled; 0 and ±6, ±12 dB", () => {
  const f = eqFrequencyGridlines(300);
  assert.deepEqual(f.filter(g => g.major).map(g => g.label), ["100", "1k", "10k"]);
  near(f.find(g => g.label === "1k").at, Math.log10(50) * 100);
  assert.ok(f.length > 20 && f.every(g => g.at > 0 && g.at < 300));
  const g = eqGainGridlines(200, 18);
  assert.deepEqual(g.map(l => l.label), ["+12", "+6", "0", "-6", "-12"]);
  assert.equal(g.find(l => l.major).at, 100);
  assert.deepEqual(eqGainGridlines(200, 9).map(l => l.label), ["+6", "0", "-6"], "lines outside a narrow range drop");
  assert.equal(formatFreqShort(20000), "20k");
});

test("response segments join points and skip junk; segment geometry matches the sparkline convention", () => {
  const segs = polylineSegments([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 4 }, { x: 6, y: 0 }]);
  assert.equal(segs.length, 2, "zero-length piece dropped");
  assert.deepEqual(segs[0], { centerX: 1.5, centerY: 2, length: 5, angleDeg: (Math.atan2(4, 3) * 180) / Math.PI });
  const resp = [{ hz: 20, db: 0 }, { hz: 200, db: 6 }, { hz: NaN, db: 1 }, { hz: 2000, db: -40 }, { hz: 30000, db: 0 }];
  const s = eqResponseSegments(resp, plot);
  assert.equal(s.length, 2);
  near(s[1].centerY, (dbToY(6, 200, 18) + 200) / 2, 1e-9);
  assert.deepEqual(eqResponseSegments([], plot), []);
});

test("band handles: pass bands sit on 0 dB", () => {
  near(eqHandlePosition({ type: "peak", freqHz: 2000, gainDb: 9 }, plot).y, 50);
  assert.equal(eqHandlePosition({ type: "high_pass", freqHz: 80, gainDb: 12 }, plot).y, 100);
  assert.ok(isPassBand("low_pass") && !isPassBand("low_shelf"));
});

test("drag moves log frequency and gain, rounds, clamps; pass bands keep gain", () => {
  // 100 pt right on a 300 pt plot is one decade.
  assert.deepEqual(dragBand({ freqHz: 1000, gainDb: 0 }, "peak", 100, 0, plot), { freqHz: 10000, gainDb: 0 });
  assert.deepEqual(dragBand({ freqHz: 1000, gainDb: 0 }, "peak", 0, -50, plot), { freqHz: 1000, gainDb: 9 });
  assert.deepEqual(dragBand({ freqHz: 1000, gainDb: 3 }, "peak", 0, -500, plot), { freqHz: 1000, gainDb: 18 },
    "gain stops at the visible range");
  assert.deepEqual(dragBand({ freqHz: 1000, gainDb: 0 }, "peak", 999, 0, plot).freqHz, 20000);
  assert.deepEqual(dragBand({ freqHz: 1000, gainDb: 0 }, "peak", -999, 0, plot).freqHz, 20);
  assert.equal(dragBand({ freqHz: 1000, gainDb: 0 }, "peak", 7, 0, plot).freqHz % 10, 0, "10 Hz resolution in the 1k decade");
  assert.deepEqual(dragBand({ freqHz: 80, gainDb: 4 }, "high_pass", 0, -80, plot), { freqHz: 80, gainDb: 4 });
  assert.throws(() => dragBand({ freqHz: 80, gainDb: 0 }, "peak", NaN, 0, plot), /drag/);
});

test("rounding: decade resolution, gain to 0.1 within ±24, no negative zero", () => {
  assert.equal(roundFreq(31.46), 31.5);
  assert.equal(roundFreq(123.4), 123);
  assert.equal(roundFreq(1234), 1230);
  assert.equal(roundFreq(12345), 12300);
  assert.equal(roundGain(30), 24);
  assert.equal(roundGain(-0.04), 0);
  assert.ok(!Object.is(roundGain(-0.04), -0));
});

test("keyboard steps: twelfth octave, 0.5 dB, 3 dB pages, Shift fine, Home zero", () => {
  const b = { type: "peak", freqHz: 1000, gainDb: 0 };
  assert.deepEqual(stepBand(b, "ArrowRight"), { freqHz: 1060, gainDb: 0 });
  assert.deepEqual(stepBand(b, "ArrowLeft"), { freqHz: 944, gainDb: 0 });
  assert.deepEqual(stepBand(b, "ArrowRight", true), { freqHz: 1010, gainDb: 0 });
  assert.deepEqual(stepBand(b, "ArrowUp"), { freqHz: 1000, gainDb: 0.5 });
  assert.deepEqual(stepBand(b, "ArrowDown", true), { freqHz: 1000, gainDb: -0.1 });
  assert.deepEqual(stepBand(b, "PageUp"), { freqHz: 1000, gainDb: 3 });
  assert.deepEqual(stepBand(b, "PageDown", true), { freqHz: 1000, gainDb: -1 });
  assert.deepEqual(stepBand({ ...b, gainDb: 23 }, "PageUp"), { freqHz: 1000, gainDb: 24 });
  assert.deepEqual(stepBand({ ...b, gainDb: 5 }, "Home"), { freqHz: 1000, gainDb: 0 });
  assert.deepEqual(stepBand({ ...b, freqHz: 20 }, "ArrowRight", true), { freqHz: 20.3, gainDb: 0 }, "fine steps still move at 20 Hz");
  assert.deepEqual(stepBand({ ...b, freqHz: 20 }, "ArrowLeft"), { freqHz: 20, gainDb: 0 });
  assert.deepEqual(stepBand({ type: "low_pass", freqHz: 8000, gainDb: 0 }, "ArrowUp"), { freqHz: 8000, gainDb: 0 });
  assert.equal(stepBand(b, "Enter"), undefined);
});

test("formatters and spoken values", () => {
  assert.equal(formatFreq(1200), "1.2 kHz");
  assert.equal(formatFreq(1000), "1 kHz");
  assert.equal(formatFreq(1250), "1.25 kHz");
  assert.equal(formatFreq(12500), "12.5 kHz");
  assert.equal(formatFreq(120), "120 Hz");
  assert.equal(formatFreq(31.5), "31.5 Hz");
  assert.equal(formatGain(3), "+3.0 dB");
  assert.equal(formatGain(-2.5), "-2.5 dB");
  assert.equal(formatGain(0), "0.0 dB");
  assert.equal(formatQ(0.7071), "0.71");
  assert.equal(describeGain(-2.5), "minus 2.5 dB");
  assert.equal(bandTypeName("high_shelf"), "High shelf");
  assert.equal(describeBand({ type: "peak", freqHz: 1200, gainDb: 3, q: 1, enabled: true }), "Peak 1.2 kHz, plus 3 dB");
  assert.equal(describeBand({ type: "high_pass", freqHz: 80, gainDb: 3, q: 0.7, enabled: false }), "High pass 80 Hz, bypassed");
});

test("dynamics plot: -60..0 on both axes, unity diagonal, gridlines every 12 dB", () => {
  assert.equal(levelToOffset(-60, 240), 0);
  assert.equal(levelToOffset(0, 240), 240);
  assert.equal(levelToOffset(-30, 240), 120);
  assert.equal(levelToOffset(-90, 240), 0);
  assert.deepEqual(dynamicsPoint(-60, -60, 240), { x: 0, y: 240 });
  assert.deepEqual(dynamicsPoint(0, 0, 240), { x: 240, y: 0 });
  assert.deepEqual(dynamicsGridlines(240).map(g => g.label), ["-48", "-36", "-24", "-12"]);
  const u = unitySegment(240);
  near(u.angleDeg, -45);
  near(u.length, 240 * Math.SQRT2);
  const curve = Array.from({ length: 61 }, (_, i) => ({ inDb: i - 60, outDb: i - 60 > -18 ? -18 + (i - 60 + 18) / 3 : i - 60 }));
  assert.equal(dynamicsCurveSegments(curve, 240).length, 60);
  assert.deepEqual(dynamicsCurveSegments([], 240), []);
  assert.throws(() => levelToOffset(-10, 0), /size/);
});

test("curve lookup interpolates engine points only", () => {
  const curve = [{ inDb: -20, outDb: -20 }, { inDb: -10, outDb: -16 }, { inDb: 0, outDb: -12 }];
  assert.equal(curveOutputAt(curve, -15), -18);
  assert.equal(curveOutputAt(curve, -40), -20, "below the first point holds");
  assert.equal(curveOutputAt(curve, 5), -12);
  assert.equal(curveOutputAt([], -10), undefined);
});

test("threshold drag and ratio steps", () => {
  assert.equal(dragThreshold(-18, 40, 240), -8);
  assert.equal(dragThreshold(-18, -1000, 240), -60);
  assert.equal(dragThreshold(-2, 100, 240), 0);
  assert.equal(clampThreshold(-17.6), -18);
  assert.ok(!Object.is(clampThreshold(-0.2), -0));
  assert.deepEqual(RATIO_STEPS, [1, 1.5, 2, 3, 4, 6, 8, 10, 20]);
  assert.equal(stepRatio(3, 1), 4);
  assert.equal(stepRatio(3, -1), 2);
  assert.equal(stepRatio(2.5, 1), 3, "between stops moves to the neighbour");
  assert.equal(stepRatio(2.5, -1), 2);
  assert.equal(stepRatio(20, 1), 20);
  assert.equal(stepRatio(1, -1), 1);
});

test("dynamics readouts", () => {
  assert.equal(formatThreshold(-18), "-18 dB");
  assert.equal(formatRatio(3), "3:1");
  assert.equal(formatRatio(1.5), "1.5:1");
  assert.equal(formatKnee(6), "6 dB");
  assert.equal(formatMakeup(0), "+0 dB");
  assert.equal(formatMakeup(2.5), "+2.5 dB");
  assert.equal(describeDynamics({ thresholdDb: -18, ratio: 3, kneeDb: 6, makeupDb: 0 }),
    "Threshold minus 18 dB, ratio 3 to 1, knee 6 dB, makeup 0 dB");
  assert.match(describeDynamics({ thresholdDb: -18, ratio: 3, kneeDb: 6, makeupDb: 0 }, -12.4), /input minus 12.4 dB$/);
});
