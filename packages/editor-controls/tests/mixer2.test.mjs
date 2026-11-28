import test from "node:test";
import assert from "node:assert/strict";
import { audibility, describeAudibility } from "../src/audio/mixer.ts";
import { createPeakHold, PEAK_HOLD_FLOOR } from "../src/audio/meter-ballistics.ts";
import { mixGroups } from "../src/audio/mix-groups.ts";
import { describeBalance } from "../src/audio/pan.ts";

const ch = (id, extra = {}) => ({ id, muted: false, solo: false, ...extra });

test("audibility: nothing soloed, every unmuted channel sounds", () => {
  assert.deepEqual(audibility([ch(1), ch(2, { muted: true }), ch(9, { kind: "bus" })]),
    ["audible", "muted", "audible"]);
});

test("audibility: solo-safe keeps an unmuted track heard; a muted safe track stays silent", () => {
  const states = audibility([
    ch(1, { solo: true }),
    ch(2, { soloSafe: true }),
    ch(3, { soloSafe: true, muted: true }),
    ch(4),
    ch(5, { solo: true, muted: true }),
  ]);
  assert.deepEqual(states, ["audible", "audible", "silenced-by-solo", "silenced-by-solo", "audible"],
    "solo beats mute on 5");
});

test("audibility: soloing a bus keeps every track routed or sent into it", () => {
  const states = audibility([
    ch(1, { output: 9 }),
    ch(2, { sends: [{ bus: 9, level: 0.5 }] }),
    ch(3, { output: 8 }),
    ch(4),
    ch(9, { kind: "bus", solo: true }),
    ch(8, { kind: "bus" }),
  ]);
  assert.deepEqual(states, ["audible", "audible", "silenced-by-solo", "silenced-by-solo", "audible", "silenced-by-solo"]);
});

test("audibility: soloing a track keeps the bus it feeds; other buses go silent", () => {
  const states = audibility([
    ch(1, { output: 9, solo: true }),
    ch(2, { sends: [{ bus: 8, level: 1 }] }),
    ch(9, { kind: "bus" }),
    ch(8, { kind: "bus" }),
    ch(7, { kind: "bus", soloSafe: true }),
  ]);
  assert.deepEqual(states, ["audible", "silenced-by-solo", "audible", "silenced-by-solo", "audible"]);
});

test("audibility: a track feeding a soloed track (not a bus) is not kept", () => {
  assert.deepEqual(audibility([ch(1, { output: 2 }), ch(2, { solo: true })]), ["silenced-by-solo", "audible"]);
});

test("describeAudibility speaks bus, group and solo safe; the old 3-argument form is unchanged", () => {
  assert.equal(describeAudibility("Bass", "silenced-by-solo", false), "Bass, silent while another channel is soloed");
  assert.equal(describeAudibility("Drum bus", "audible", true, { kind: "bus", group: "Drums" }),
    "Drum bus, bus, group Drums, soloed");
  assert.equal(describeAudibility("Pad", "audible", false, { soloSafe: true }), "Pad, solo safe");
});

test("mixGroups: first-seen order, all/mixed solo and mute, ungrouped skipped", () => {
  const groups = mixGroups([
    { id: 1, group: "Drums", solo: true, muted: false },
    { id: 2, group: "Keys", solo: false, muted: true },
    { id: 3, group: "Drums", solo: false, muted: false },
    { id: 4, solo: true, muted: true },
    { id: 5, group: "", solo: false, muted: false },
    { id: 6, group: "Keys", solo: false, muted: true },
  ]);
  assert.deepEqual(groups, [
    { name: "Drums", memberIds: [1, 3], solo: false, muted: false, mixed: true, mutedMixed: false },
    { name: "Keys", memberIds: [2, 6], solo: false, muted: true, mixed: false, mutedMixed: false },
  ]);
  assert.equal(mixGroups([{ id: 1, group: "A", solo: true, muted: false }])[0].solo, true);
  assert.deepEqual(mixGroups([]), []);
});

test("peak hold: instant attack, hold for holdMs, then fall at the dB rate", () => {
  const meter = createPeakHold({ holdMs: 1000, fallDbPerSecond: 20 });
  assert.deepEqual(meter(1, 0), { level: 1, hold: 1 });
  // 500 ms at 20 dB/s: the bar is 10 dB down; the hold has not moved.
  let r = meter(0, 500);
  assert.ok(Math.abs(r.level - 10 ** (-10 / 20)) < 1e-9);
  assert.equal(r.hold, 1);
  r = meter(0, 1000);
  assert.equal(r.hold, 1, "still held at exactly holdMs");
  // 1500 ms: hold has fallen for 500 ms, 10 dB.
  r = meter(0, 1500);
  assert.ok(Math.abs(r.hold - 10 ** (-10 / 20)) < 1e-9);
  assert.ok(r.hold >= r.level);
  // A new louder peak resets the hold timer.
  r = meter(0.5, 1600);
  assert.equal(r.level, 0.5);
  assert.ok(r.hold >= 0.5);
});

test("peak hold: falls to zero under the floor; backwards clock adds no time", () => {
  const meter = createPeakHold({ holdMs: 0, fallDbPerSecond: 60 });
  meter(0.5, 0);
  // 2 s at 60 dB/s is 120 dB down: below the -60 dB floor.
  assert.deepEqual(meter(0, 2000), { level: 0, hold: 0 });
  const m2 = createPeakHold();
  m2(0.8, 1000);
  assert.deepEqual(m2(0, 500), { level: 0.8, hold: 0.8 }, "clock went backwards");
  assert.ok(PEAK_HOLD_FLOOR > 0);
});

test("peak hold: rejects bad input", () => {
  assert.throws(() => createPeakHold({ fallDbPerSecond: 0 }), /fallDbPerSecond/);
  assert.throws(() => createPeakHold({ holdMs: -1 }), /holdMs/);
  const meter = createPeakHold();
  assert.throws(() => meter(-0.1, 0), /Meter peak/);
  assert.throws(() => meter(Number.NaN, 0), /Meter peak/);
  assert.throws(() => meter(0.1, Number.NaN), /nowMs/);
  assert.doesNotThrow(() => meter(1.4, 0), "engine peaks over full scale are allowed");
});

test("describeBalance names the attenuated far side", () => {
  assert.equal(describeBalance(0), "centre");
  assert.equal(describeBalance(0.25), "25 percent right, left side at 75 percent");
  assert.equal(describeBalance(-1), "100 percent left, right side at 0 percent");
  assert.throws(() => describeBalance(2), /Pan/);
});
