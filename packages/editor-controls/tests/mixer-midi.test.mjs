import test from "node:test";
import assert from "node:assert/strict";
import {
  describePan, dragToPan, formatPan, panToPosition, quantizePan, stepPan,
} from "../src/audio/pan.ts";
import { audibility, describeAudibility } from "../src/audio/mixer.ts";
import {
  TAP_RESET_MS, addTap, beatInBar, clampBpm, isValidTimeSignature, tapTempo,
} from "../src/audio/tempo.ts";
import {
  cellAt, describeNote, dragNote, dragNoteEnd, dragVelocity, gridSize, isSharp, noteKeyEdit, noteRect,
  pitchName, stepCells, velocityToHeight, visiblePitches,
} from "../src/midi/note-grid.ts";
import { rangePosition, scrollRange, slicePeaks } from "../src/waveform.ts";

test("pan maps -1..1 onto the track and snaps to centre", () => {
  assert.equal(panToPosition(-1), 0);
  assert.equal(panToPosition(0), 0.5);
  assert.equal(panToPosition(1), 1);
  // 100 pt track: 50 pt right is +1.
  assert.equal(dragToPan(0, 50, 100), 1);
  assert.equal(dragToPan(-0.5, 25, 100), 0, "lands inside the centre detent");
  assert.equal(dragToPan(-0.5, 20, 100), -0.1);
  assert.equal(dragToPan(1, 200, 100), 1, "clamped");
  assert.equal(quantizePan(0.30000000000000004), 0.3);
  assert.throws(() => dragToPan(0, 1, 0), /pan drag/);
  assert.throws(() => panToPosition(1.5), /Pan/);
});

test("pan steps stop on centre and format physically", () => {
  assert.equal(stepPan(-0.03, 1, 0.05), 0, "crossing centre stops there");
  assert.equal(stepPan(0, 1, 0.05), 0.05);
  assert.equal(stepPan(0.98, 1, 0.05), 1);
  assert.equal(formatPan(0), "C");
  assert.equal(formatPan(-0.25), "L 25");
  assert.equal(formatPan(1), "R 100");
  assert.equal(describePan(-0.25), "25 percent left");
  assert.equal(describePan(0.004), "centre");
});

test("solo takes precedence over mute, matching the engine render", () => {
  assert.deepEqual(audibility([{ muted: false, solo: false }, { muted: true, solo: false }]), ["audible", "muted"]);
  assert.deepEqual(
    audibility([{ muted: true, solo: true }, { muted: false, solo: false }, { muted: true, solo: false }]),
    ["audible", "silenced-by-solo", "silenced-by-solo"],
  );
  assert.deepEqual(audibility([]), []);
  assert.equal(describeAudibility("Bass", "silenced-by-solo", false), "Bass, silent while another channel is soloed");
  assert.equal(describeAudibility("Keys", "audible", true), "Keys, soloed");
});

test("tap tempo averages the window and resets on a long gap", () => {
  let taps = [];
  for (const t of [0, 500, 1000, 1500]) taps = addTap(taps, t);
  assert.equal(tapTempo(taps), 120);
  assert.equal(tapTempo([0]), undefined);
  taps = addTap(taps, 1500 + TAP_RESET_MS + 1);
  assert.equal(taps.length, 1, "long gap starts over");
  assert.deepEqual(addTap([1000], 900), [900], "clock going backwards starts over");
  let many = [];
  for (let i = 0; i < 20; i++) many = addTap(many, i * 400);
  assert.equal(many.length, 8);
  assert.equal(tapTempo(many), 150);
  assert.equal(tapTempo([0, 10]), 400, "clamped to the engine maximum");
  assert.equal(clampBpm(120.04), 120);
});

test("time signatures follow the engine's rules", () => {
  assert.ok(isValidTimeSignature([7, 8]));
  assert.ok(!isValidTimeSignature([3, 3]));
  assert.ok(!isValidTimeSignature([0, 4]));
  assert.ok(!isValidTimeSignature([4, 256]));
  assert.equal(beatInBar(0, 960, [4, 4]), 0);
  assert.equal(beatInBar(960 * 5, 960, [4, 4]), 1);
  assert.equal(beatInBar(480 * 7, 960, [7, 8]), 0, "eighth-note beats");
});

const grid = { clipTicks: 3840, lowestPitch: 48, highestPitch: 72, pixelsPerTick: 0.1, rowHeight: 44, snapTicks: 240 };
const note = { pitch: 60, velocity: 100, startTicks: 960, lengthTicks: 480 };

test("piano roll geometry", () => {
  assert.equal(pitchName(60), "C4");
  assert.equal(pitchName(58), "A♯3");
  assert.ok(isSharp(61) && !isSharp(60));
  const rows = visiblePitches(grid);
  assert.equal(rows[0], 72);
  assert.equal(rows.at(-1), 48);
  assert.deepEqual(gridSize(grid), { width: 384, height: 25 * 44 });
  assert.deepEqual(noteRect(note, grid), { x: 96, y: 12 * 44, width: 48, height: 44 });
  assert.equal(noteRect({ ...note, pitch: 90 }, grid), undefined);
});

test("note drags snap to the grid, stay in the clip and move pitch by rows", () => {
  assert.deepEqual(dragNote(note, 30, 0, grid), { startTicks: 1200, pitch: 60 }, "300 ticks snaps to 240");
  assert.deepEqual(dragNote(note, 0, -88, grid), { startTicks: 960, pitch: 62 }, "up two rows");
  assert.deepEqual(dragNote(note, 9999, 9999, grid), { startTicks: 3360, pitch: 48 });
  assert.deepEqual(dragNote(note, -9999, -9999, grid), { startTicks: 0, pitch: 72 });
  assert.equal(dragNoteEnd(note, 24, grid), 720);
  assert.equal(dragNoteEnd(note, -999, grid), 240, "at least one step");
  assert.equal(dragNoteEnd(note, 9999, grid), 2880, "ends at the clip end");
  assert.deepEqual(cellAt(100, 0, grid), { startTicks: 960, lengthTicks: 240, pitch: 72 });
  assert.deepEqual(cellAt(383, 1099, grid), { startTicks: 3600, lengthTicks: 240, pitch: 48 });
  assert.equal(cellAt(-1, 0, grid), undefined);
  assert.equal(cellAt(384, 0, grid), undefined);
});

test("keyboard edits move, resize and remove a focused note", () => {
  assert.deepEqual(noteKeyEdit(note, "ArrowRight", false, grid), { kind: "move", startTicks: 1200, pitch: 60 });
  assert.deepEqual(noteKeyEdit(note, "ArrowUp", false, grid), { kind: "move", startTicks: 960, pitch: 61 });
  assert.deepEqual(noteKeyEdit(note, "ArrowRight", true, grid), { kind: "resize", lengthTicks: 720 });
  assert.deepEqual(noteKeyEdit(note, "Delete", false, grid), { kind: "remove" });
  assert.equal(noteKeyEdit({ ...note, startTicks: 0 }, "ArrowLeft", false, grid), undefined, "no-op edits are dropped");
  assert.equal(noteKeyEdit({ ...note, lengthTicks: 240 }, "ArrowLeft", true, grid), undefined);
  assert.equal(noteKeyEdit(note, "x", false, grid), undefined);
  assert.equal(describeNote(note, 960), "C4, beat 2, 0.50 beats long, velocity 100");
});

test("velocity drags are relative and clamped", () => {
  assert.equal(velocityToHeight(127, 96), 96);
  assert.equal(dragVelocity(64, -48, 96), 127);
  assert.equal(dragVelocity(100, 0, 96), 100);
  assert.equal(dragVelocity(100, 96, 96), 0);
  assert.equal(dragVelocity(10, -24, 96), 42);
});

test("step cells read on-grid notes per lane", () => {
  const lanes = [{ pitch: 36, name: "Kick" }, { pitch: 38, name: "Snare" }];
  const notes = [
    { pitch: 36, velocity: 96, startTicks: 0, lengthTicks: 240 },
    { pitch: 38, velocity: 127, startTicks: 960, lengthTicks: 240 },
    { pitch: 36, velocity: 96, startTicks: 100, lengthTicks: 240 },
    { pitch: 36, velocity: 50, startTicks: 0, lengthTicks: 240 },
  ];
  const cells = stepCells(notes, lanes, 8, 240, 127);
  assert.deepEqual(cells[0][0], { on: true, noteIndex: 0, accent: false }, "first matching note wins");
  assert.deepEqual(cells[1][4], { on: true, noteIndex: 1, accent: true });
  assert.equal(cells[0].filter(c => c.on).length, 1, "off-grid note is not a step");
  assert.throws(() => stepCells(notes, lanes, 0, 240, 127), /steps/);
});

test("waveform range slicing scrolls and maps taps into the window", () => {
  const peaks = Array.from({ length: 1000 }, (_, i) => ({ min: -i / 1000, max: i / 1000 }));
  const slice = slicePeaks(peaks, { start: 0.5, end: 0.6 });
  assert.equal(slice.length, 100);
  assert.equal(slice[0].max, 0.5);
  assert.equal(slicePeaks(peaks, { start: 0, end: 1 }), peaks, "full range is not copied");
  assert.deepEqual(scrollRange({ start: 0.5, end: 0.6 }, 100, 200), { start: 0.45, end: 0.55 });
  assert.deepEqual(scrollRange({ start: 0.05, end: 0.15 }, 1000, 100), { start: 0, end: 0.1 });
  assert.deepEqual(scrollRange({ start: 0.85, end: 0.95 }, -1000, 100), { start: 0.9, end: 1 });
  assert.equal(rangePosition({ start: 0.5, end: 0.6 }, 100, 200), 0.55);
  assert.throws(() => slicePeaks(peaks, { start: 0.6, end: 0.5 }), /range/);
});
