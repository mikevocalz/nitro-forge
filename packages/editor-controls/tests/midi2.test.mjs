import test from "node:test";
import assert from "node:assert/strict";
import {
  describeVelocityBatch, noteLaneX, notesInTimeOrder, rampRoom, rampVelocities, velocityAtY, velocityLineChanges,
} from "../src/midi/velocity-line.ts";
import {
  channelLabel, describeNote, isMidiChannel, usesSeveralChannels,
} from "../src/midi/note-grid.ts";

// Four notes a beat apart at 0.1 pt/tick: bars at x = 52, 148, 244, 340 with a 52 pt inset.
const notes = [
  { pitch: 60, velocity: 100, startTicks: 0, lengthTicks: 480 },
  { pitch: 64, velocity: 80, startTicks: 960, lengthTicks: 480 },
  { pitch: 67, velocity: 110, startTicks: 1920, lengthTicks: 480 },
  { pitch: 72, velocity: 60, startTicks: 2880, lengthTicks: 480 },
];
const g = { pixelsPerTick: 0.1, inset: 52, scrollX: 0, height: 127 };

test("velocityAtY maps the lane's top to 127 and bottom to 0, clamped", () => {
  assert.equal(velocityAtY(0, 127), 127);
  assert.equal(velocityAtY(127, 127), 0);
  assert.equal(velocityAtY(63.5, 127), 64);
  assert.equal(velocityAtY(-40, 127), 127);
  assert.equal(velocityAtY(400, 127), 0);
  assert.throws(() => velocityAtY(1, 0), /height/);
  assert.throws(() => velocityAtY(Number.NaN, 96), /y/);
});

test("noteLaneX follows inset, scale and scroll", () => {
  assert.equal(noteLaneX(notes[1], g), 148);
  assert.equal(noteLaneX(notes[1], { ...g, scrollX: 100 }), 48);
});

test("a line across all bars interpolates linearly, sorted, integer, changed only", () => {
  // From (52, top=127) to (340, bottom=0): 127, 85, 42, 0.
  const out = velocityLineChanges(notes, g, { x: 52, y: 0 }, { x: 340, y: 127 });
  assert.deepEqual(out, [
    { index: 0, velocity: 127 }, { index: 1, velocity: 85 }, { index: 2, velocity: 42 }, { index: 3, velocity: 0 },
  ]);
  for (const c of out) assert.ok(Number.isInteger(c.velocity));
});

test("a reversed drag gives the same batch: time stays left to right", () => {
  const forward = velocityLineChanges(notes, g, { x: 52, y: 0 }, { x: 340, y: 127 });
  const reversed = velocityLineChanges(notes, g, { x: 340, y: 127 }, { x: 52, y: 0 });
  assert.deepEqual(reversed, forward);
  // The earliest note always takes the line's left end, whichever way the drag ran.
  assert.equal(reversed[0].velocity, 127);
});

test("only notes inside the x span are hit; reach widens the span", () => {
  const mid = velocityLineChanges(notes, g, { x: 140, y: 27 }, { x: 250, y: 27 });
  assert.deepEqual(mid, [{ index: 1, velocity: 100 }, { index: 2, velocity: 100 }]);
  const narrow = velocityLineChanges(notes, g, { x: 150, y: 27 }, { x: 240, y: 27 });
  assert.deepEqual(narrow, []);
  const reached = velocityLineChanges(notes, g, { x: 150, y: 27 }, { x: 240, y: 27 }, 4);
  assert.deepEqual(reached.map(c => c.index), [1, 2]);
});

test("a single-point segment sets the bar under it to the point's height", () => {
  assert.deepEqual(velocityLineChanges(notes, g, { x: 148, y: 0 }, { x: 148, y: 0 }), [{ index: 1, velocity: 127 }]);
  // Straight-down drag on one bar: the end point wins.
  assert.deepEqual(velocityLineChanges(notes, g, { x: 148, y: 0 }, { x: 148, y: 100 }), [{ index: 1, velocity: 27 }]);
});

test("empty results: no hit, no change, no notes", () => {
  assert.deepEqual(velocityLineChanges(notes, g, { x: 0, y: 0 }, { x: 40, y: 0 }), []);
  // Line already at the notes' velocities.
  assert.deepEqual(velocityLineChanges([notes[0]], g, { x: 40, y: 27 }, { x: 60, y: 27 }), []);
  assert.deepEqual(velocityLineChanges([], g, { x: 0, y: 0 }, { x: 999, y: 0 }), []);
});

test("the result never depends on layout direction", () => {
  // The function has no direction input: x is physical. The same drag must
  // give the same batch whether the page around it is LTR or RTL, which the
  // browser lane checks end to end. Here: scroll shifts the hit set, not the order.
  const scrolled = velocityLineChanges(notes, { ...g, scrollX: 96 }, { x: 52, y: 0 }, { x: 244, y: 127 });
  assert.deepEqual(scrolled.map(c => c.index), [1, 2, 3]);
  assert.ok(scrolled[0].velocity > scrolled[2].velocity);
});

test("duplicate indices cannot appear even for chords", () => {
  const chord = [...notes, { pitch: 55, velocity: 10, startTicks: 0, lengthTicks: 480 }];
  const out = velocityLineChanges(chord, g, { x: 0, y: 0 }, { x: 400, y: 0 });
  assert.equal(new Set(out.map(c => c.index)).size, out.length);
  assert.deepEqual(out.map(c => c.index), [0, 1, 2, 3, 4]);
});

test("invalid geometry and points throw", () => {
  assert.throws(() => velocityLineChanges(notes, { ...g, height: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), /height/);
  assert.throws(() => velocityLineChanges(notes, { ...g, pixelsPerTick: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), /pixelsPerTick/);
  assert.throws(() => velocityLineChanges(notes, g, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }), /finite/);
  assert.throws(() => velocityLineChanges(notes, g, { x: 0, y: 0 }, { x: 1, y: 1 }, -1), /reach/);
});

test("ramp runs from the selected note's velocity over the next notes in time", () => {
  // From note 1 (80) over 3 notes to 20: 80, 50, 20.
  assert.deepEqual(rampVelocities(notes, 1, 3, 20), [{ index: 2, velocity: 50 }, { index: 3, velocity: 20 }]);
  // Count past the end covers what is there.
  assert.deepEqual(rampVelocities(notes, 2, 10, 0), [{ index: 3, velocity: 0 }]);
  // Last note alone: nothing to ramp.
  assert.deepEqual(rampVelocities(notes, 3, 2, 0), []);
  // Time order, not array order.
  const shuffled = [notes[2], notes[0], notes[3], notes[1]];
  assert.deepEqual(notesInTimeOrder(shuffled), [1, 3, 0, 2]);
  assert.deepEqual(rampVelocities(shuffled, 1, 4, 127), [
    { index: 0, velocity: 127 - 9 }, { index: 2, velocity: 127 }, { index: 3, velocity: 100 + 9 },
  ].sort((a, b) => a.index - b.index));
  assert.equal(rampRoom(notes, 1), 3);
  assert.equal(rampRoom(notes, 9), 0);
  assert.throws(() => rampVelocities(notes, 4, 2, 0), /fromIndex/);
  assert.throws(() => rampVelocities(notes, 0, 1, 0), /count/);
});

test("batch summary", () => {
  assert.equal(describeVelocityBatch([]), "No velocities changed");
  assert.equal(describeVelocityBatch([{ index: 0, velocity: 1 }]), "1 velocity changed");
  assert.equal(describeVelocityBatch([{ index: 0, velocity: 1 }, { index: 1, velocity: 2 }]), "2 velocities changed");
});

test("channels are 0..15 and read as 1..16", () => {
  assert.equal(channelLabel(0), "Channel 1");
  assert.equal(channelLabel(15), "Channel 16");
  assert.throws(() => channelLabel(16), /0\.\.15/);
  assert.throws(() => channelLabel(1.5), /0\.\.15/);
  assert.equal(isMidiChannel(-1), false);
  assert.equal(usesSeveralChannels(notes), false);
  assert.equal(usesSeveralChannels([notes[0], { ...notes[1], channel: 0 }]), false, "missing channel counts as 0");
  assert.equal(usesSeveralChannels([notes[0], { ...notes[1], channel: 9 }]), true);
  assert.equal(describeNote({ ...notes[0], channel: 9 }, 960, true), "C4, beat 1, 0.50 beats long, velocity 100, channel 10");
  assert.equal(describeNote(notes[0], 960), "C4, beat 1, 0.50 beats long, velocity 100");
});
