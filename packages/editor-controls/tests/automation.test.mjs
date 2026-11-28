import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_LANE_PAD, AUTOMATION_MODES, automationKeyEdit, automationSegments, canAddPointAt, clampAutomationValue,
  clampPointTicks, describeAutomationPoint, dragPoint, formatAutomationValue, formatPosition, hitTestPoint, neutralValue,
  pointBounds, positionToValue, snapTicksTo, stepAutomationValue, ticksToX, valueAt, valueToPosition, valueToY, xToTicks,
  yToValue,
} from "../src/audio/automation.ts";

const gain = { param: "gain", height: 132, pixelsPerTick: 0.1, lengthTicks: 7680 };
const pan = { ...gain, param: "pan" };
const pts = [{ ticks: 960, value: 1 }, { ticks: 1920, value: 0.5 }, { ticks: 3840, value: 0.25 }];
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("automation modes include host-gated live transport modes", () => {
  assert.deepEqual([...AUTOMATION_MODES], ["off", "read", "write", "touch", "latch", "trim"]);
  assert.equal(neutralValue("gain"), 1);
  assert.equal(neutralValue("pan"), 0);
});

test("value <-> y uses a cubic fader taper for gain and a linear scale for pan", () => {
  assert.equal(valueToY(1, gain), AUTOMATION_LANE_PAD, "0 dB at the top of travel");
  assert.equal(valueToY(0, gain), 132 - AUTOMATION_LANE_PAD, "silence at the bottom");
  close(valueToPosition("gain", 0.5), Math.cbrt(0.5));
  close(valueToPosition("gain", 0.1), Math.cbrt(0.1));
  assert.equal(valueToY(1, pan), AUTOMATION_LANE_PAD, "right at the top");
  assert.equal(valueToY(0, pan), 66);
  assert.equal(yToValue(66, pan), 0);
  assert.equal(yToValue(0, gain), 1, "above travel clamps to the max");
  assert.equal(yToValue(500, gain), 0, "below travel clamps to silence");
  assert.equal(yToValue(500, pan), -1);
  // Round trip lands on the 0.1 dB grid.
  assert.equal(formatAutomationValue("gain", yToValue(valueToY(0.5, gain), gain)), "-6.0 dB");
  assert.equal(positionToValue("pan", 0.505), 0, "tiny offsets from centre snap to centre");
});

test("ticks <-> x snap to the grid, clamp and follow scroll", () => {
  assert.equal(ticksToX(960, 0.1), 96);
  assert.equal(xToTicks(96, gain), 960);
  assert.equal(xToTicks(100, gain), 960, "snaps to 240");
  assert.equal(xToTicks(10, gain, 240, 86), 960, "scrollX shifts the viewport");
  assert.equal(xToTicks(-50, gain), 0);
  assert.equal(xToTicks(10_000, gain), 7680);
  assert.equal(snapTicksTo(130, 240, 7680), 240);
  assert.throws(() => snapTicksTo(1, 0, 10), /snapTicks/);
});

test("valueAt is linear between points and held at both ends", () => {
  assert.equal(valueAt([], 100), undefined);
  assert.equal(valueAt(pts, 0), 1, "held before the first point");
  assert.equal(valueAt(pts, 1440), 0.75);
  assert.equal(valueAt(pts, 2880), 0.375);
  assert.equal(valueAt(pts, 9999), 0.25, "held after the last point");
});

test("segments include held ends to the lane edges", () => {
  const s = automationSegments(pts, pan);
  assert.equal(s.length, 4, "pan: lead-in, two straight ramps, tail");
  close(s[0].centerX, 48); close(s[0].length, 96); close(s[0].angleDeg, 0);
  const tail = s[3];
  close(tail.centerX - tail.length / 2, 384); close(tail.centerX + tail.length / 2, 768);
  assert.ok(s[1].angleDeg > 0, "falling gain slopes downward");
  assert.deepEqual(automationSegments([], gain), []);
  assert.equal(automationSegments([{ ticks: 0, value: 0.5 }], gain).length, 1, "no zero-length lead-in");
  // Gain ramps follow the linear-gain render, which bows on the dB scale.
  const ramp = [{ ticks: 0, value: 1 }, { ticks: 3840, value: 0 }];
  const g = automationSegments(ramp, gain);
  assert.ok(g.length > 8);
  const mid = g.find(p => Math.abs(p.centerX + Math.cos(p.angleDeg * Math.PI / 180) * p.length / 2 - 192) < 1e-6);
  assert.ok(mid, "a piece ends at the ramp's midpoint");
  const endY = mid.centerY + Math.sin(mid.angleDeg * Math.PI / 180) * mid.length / 2;
  close(endY, valueToY(valueAt(ramp, 1920), gain), 1e-6);
  assert.throws(() => automationSegments(pts, { ...gain, height: 40 }), /height/);
});

test("hit-testing finds the nearest point inside the 44 pt target", () => {
  const y = valueToY(0.5, gain);
  assert.equal(hitTestPoint(pts, 192 + 10, y - 5, gain), 1);
  assert.equal(hitTestPoint(pts, 192 + 30, y, gain), undefined);
  assert.equal(hitTestPoint(pts, 140, 200, gain), undefined);
});

test("drags keep a point strictly between its neighbours and snap", () => {
  assert.deepEqual(pointBounds(pts, 1, 7680), { min: 961, max: 3839 });
  assert.deepEqual(pointBounds(pts, 0, 7680), { min: 0, max: 1919 });
  assert.equal(clampPointTicks(pts, 1, 2400, 240, 7680), 2400);
  assert.equal(clampPointTicks(pts, 1, 500, 240, 7680), 1200, "nearest free grid line after the previous point");
  assert.equal(clampPointTicks(pts, 1, 9000, 240, 7680), 3600);
  const tight = [{ ticks: 0, value: 1 }, { ticks: 100, value: 1 }, { ticks: 200, value: 1 }];
  assert.equal(clampPointTicks(tight, 1, 400, 240, 7680), 199, "no grid line free: closest legal tick");
  const d = dragPoint(pts, 1, 50, 0, gain);
  assert.deepEqual(d, { ticks: 2400, value: 0.5 }, "a horizontal drag keeps the value exactly");
  const up = dragPoint(pts, 1, 0, -500, gain);
  assert.deepEqual(up, { ticks: 1920, value: 1 });
  const way = dragPoint(pts, 1, -5000, 0, gain);
  assert.ok(way.ticks > 960 && way.ticks < 3840);
  assert.throws(() => dragPoint(pts, 9, 0, 0, gain), /index 9/);
});

test("keyboard steps move value and time and never cross neighbours", () => {
  const o = { param: "gain", lengthTicks: 7680, snapTicks: 240, barTicks: 3840 };
  assert.deepEqual(automationKeyEdit(pts, 1, "ArrowRight", false, o), { kind: "move", ticks: 2160, value: 0.5 });
  assert.deepEqual(automationKeyEdit(pts, 1, "ArrowRight", true, o), { kind: "move", ticks: 3839, value: 0.5 });
  assert.equal(automationKeyEdit(pts, 0, "ArrowUp", false, o), undefined, "already at 0 dB");
  const down = automationKeyEdit(pts, 0, "ArrowDown", false, o);
  assert.equal(formatAutomationValue("gain", down.value), "-1.0 dB");
  const big = automationKeyEdit(pts, 0, "PageDown", false, o);
  assert.equal(formatAutomationValue("gain", big.value), "-6.0 dB");
  assert.deepEqual(automationKeyEdit(pts, 2, "Delete", false, o), { kind: "remove" });
  assert.deepEqual(automationKeyEdit(pts, 2, "Backspace", false, o), { kind: "remove" });
  assert.equal(automationKeyEdit(pts, 2, "x", false, o), undefined);
  const first = [{ ticks: 0, value: 0 }];
  assert.equal(automationKeyEdit(first, 0, "ArrowLeft", false, o), undefined, "lane start");
  assert.equal(stepAutomationValue("pan", 0.02, -1), 0, "pan stops on centre");
  assert.equal(stepAutomationValue("pan", -1, 1, true), -0.75);
});

test("value and position formatting", () => {
  assert.equal(formatAutomationValue("gain", 0), "-inf dB");
  assert.equal(formatAutomationValue("gain", 1), "0.0 dB");
  assert.equal(formatAutomationValue("gain", 0.5), "-6.0 dB");
  assert.equal(formatAutomationValue("pan", -0.3), "L 30");
  assert.equal(formatAutomationValue("pan", 0), "C");
  assert.equal(formatAutomationValue("pan", 0.3), "R 30");
  assert.equal(formatPosition(0), "Bar 1 beat 1");
  assert.equal(formatPosition(3840), "Bar 2 beat 1");
  assert.equal(formatPosition(1440), "Bar 1 beat 2.5");
  assert.equal(formatPosition(2880, 960, 3), "Bar 2 beat 1");
  assert.equal(describeAutomationPoint({ ticks: 3840, value: 0.5 }, "gain"), "Bar 2 beat 1, -6.0 dB");
  assert.throws(() => formatPosition(-1), /ticks/);
});

test("clamping and duplicate-tick guard", () => {
  assert.equal(clampAutomationValue("gain", 2), 1);
  assert.equal(clampAutomationValue("gain", 0.00001), 0, "below -90 dB is silence");
  assert.equal(formatAutomationValue("gain", clampAutomationValue("gain", 0.0001)), "-80.0 dB");
  assert.equal(clampAutomationValue("pan", -3), -1);
  assert.throws(() => clampAutomationValue("pan", NaN), /finite/);
  assert.equal(canAddPointAt(pts, 960), false);
  assert.equal(canAddPointAt(pts, 1200), true);
});
