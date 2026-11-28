import test from "node:test";
import assert from "node:assert/strict";
import {
  LOUDNESS_TARGETS, barCountForWidth, describeLoudness, formatDbfs, formatLufs, historySeconds,
  lufsToFraction, momentaryBars, peakSeverity, targetDelta,
} from "../src/audio/loudness.ts";
import {
  SPECTROGRAM_MAX_COLUMNS, SPECTROGRAM_MAX_ROWS, columnsForWidth, describeSpectrogram, formatHz,
  frequencyTicks, intensityStep, poolSpectrogram, spectrogramRuns, timeTicks,
} from "../src/audio/spectrogram.ts";

const M = "−";

test("loudness formatting and target delta", () => {
  assert.equal(formatLufs(-14.24), M + "14.2 LUFS");
  assert.equal(formatLufs(null), "No reading");
  assert.equal(formatDbfs(0.3), "0.3 dBFS");
  assert.equal(formatDbfs(-0.04), "0.0 dBFS");
  assert.deepEqual(targetDelta(-12.2, -14), { lu: 1.8, direction: "over", text: "1.8 LU over target" });
  assert.equal(targetDelta(-14.6, -14).text, "0.6 LU under target");
  assert.equal(targetDelta(-14.04, -14).direction, "on");
  assert.equal(targetDelta(null, -14), undefined);
  assert.deepEqual(LOUDNESS_TARGETS.map(t => t.lufs), [-14, -16, -23]);
});

test("peak severity uses danger only above -1 dBFS", () => {
  assert.equal(peakSeverity(null), "none");
  assert.equal(peakSeverity(-1), "ok");
  assert.equal(peakSeverity(-0.5), "near");
  assert.equal(peakSeverity(0), "near");
  assert.equal(peakSeverity(0.2), "over");
});

test("fixed -60..0 scale and bounded momentary bars", () => {
  assert.equal(lufsToFraction(-60), 0);
  assert.equal(lufsToFraction(-90), 0);
  assert.equal(lufsToFraction(0), 1);
  assert.equal(lufsToFraction(-30), 0.5);
  const history = Array.from({ length: 6000 }, (_, i) => (i % 50 === 0 ? -6 : i % 7 === 0 ? null : -30));
  const bars = momentaryBars(history, 120);
  assert.equal(bars.length, 120);
  assert.ok(bars.every(b => b.lufs === -6), "max-pool keeps the loudest block");
  const silent = momentaryBars([null, null, null], 10);
  assert.equal(silent.length, 3);
  assert.ok(silent.every(b => b.lufs === null && b.fraction === 0));
  assert.equal(barCountForWidth(10000, 10000), 120);
  assert.equal(barCountForWidth(200, 10000), 50);
  assert.equal(barCountForWidth(0, 0), 1);
  assert.throws(() => momentaryBars([], 0), RangeError);
  assert.ok(Math.abs(historySeconds(100, 0.1) - 10.3) < 1e-9);
});

test("loudness summary names omissions-free readings and the peak warning", () => {
  const text = describeLoudness({ integratedLufs: -12.2, shortTermMaxLufs: -9, momentaryMaxLufs: -7.5, samplePeakDbfs: 0.4, target: -14 });
  assert.match(text, /^Integrated −12\.2 LUFS, 1\.8 LU over target of −14\.0 LUFS/);
  assert.match(text, /Over 0 dBFS, the mixdown clips\.$/);
  assert.doesNotMatch(text, /LRA|true peak/i);
});

test("spectrogram intensity steps", () => {
  assert.equal(intensityStep(-120), 0);
  assert.equal(intensityStep(-90), 1);
  assert.equal(intensityStep(-60), 2);
  assert.equal(intensityStep(-40), 3);
  assert.equal(intensityStep(-20), 4);
  assert.equal(intensityStep(0), 5);
  assert.equal(intensityStep(Number.NaN), 0);
});

test("pooling caps columns at 96 and rows at 32 and keeps transients", () => {
  const bands = 128, frames = Array.from({ length: 5000 }, () => new Array(bands).fill(-120));
  frames[2501][100] = -3;
  const grid = poolSpectrogram(frames, bands, 500, 500);
  assert.equal(grid.columns, SPECTROGRAM_MAX_COLUMNS);
  assert.equal(grid.rows, SPECTROGRAM_MAX_ROWS);
  assert.equal(grid.db.length, 96 * 32);
  assert.equal(Math.max(...grid.db), -3);
  const runs = spectrogramRuns(grid);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].step, 5);
  assert.equal(runs[0].row, Math.floor(100 * 32 / 128));
});

test("drawn views stay bounded for the worst-case checkerboard", () => {
  const frames = Array.from({ length: 4000 }, (_, f) => Array.from({ length: 64 }, (_, b) => ((f + b) % 2 ? -10 : -120)));
  const grid = poolSpectrogram(frames, 64, columnsForWidth(5000, frames.length));
  const runs = spectrogramRuns(grid);
  assert.ok(runs.length <= SPECTROGRAM_MAX_COLUMNS * SPECTROGRAM_MAX_ROWS);
  const uniform = poolSpectrogram(Array.from({ length: 300 }, () => new Array(64).fill(-40)), 64, 96);
  assert.equal(spectrogramRuns(uniform).length, uniform.rows, "equal cells merge into one run per row");
  assert.equal(columnsForWidth(120, 1000), 40);
  assert.equal(columnsForWidth(9999, 10), 10);
});

test("frequency and time axis labels", () => {
  const bands = Array.from({ length: 32 }, (_, i) => 31.25 * Math.pow(2, i / 3));
  const ticks = frequencyTicks(bands);
  assert.deepEqual(ticks.map(t => t.label), ["100 Hz", "1 kHz", "10 kHz"]);
  assert.ok(ticks[0].position < ticks[1].position && ticks[1].position < ticks[2].position);
  assert.ok(ticks.every(t => t.position > 0 && t.position < 1));
  assert.deepEqual(frequencyTicks([200, 400, 800]).map(t => t.label), []);
  assert.equal(formatHz(12500), "12.5k");
  assert.equal(formatHz(63), "63 Hz");
  assert.deepEqual(timeTicks(12.4).map(t => t.label), ["0 s", "5 s", "10 s"]);
  assert.deepEqual(timeTicks(0.8).map(t => t.label), ["0.0 s", "0.2 s", "0.4 s", "0.6 s", "0.8 s"]);
  assert.deepEqual(timeTicks(0), []);
});

test("spectrogram summary names duration, loudest band and time", () => {
  const frames = Array.from({ length: 100 }, () => [-120, -60, -90]);
  frames[42][1] = -6;
  assert.equal(describeSpectrogram(frames, [100, 1000, 10000], 0.05),
    "Spectrogram, 5.0 seconds, 100 Hz to 10 kHz. Loudest: 1 kHz band at 2.1 s, " + M + "6 dB.");
  assert.match(describeSpectrogram([[-120]], [100], 1), /Silent throughout/);
});
