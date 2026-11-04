import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forgeInstrumentBlueprints,
  instrumentsForStudio,
  scrubPrecision,
  nearestTimeUnit,
  timeAtUnit,
  temporalRulerTicks,
  type ForgeStudio,
  type ForgeTimebase,
} from './instrument-system.ts';

const studios: ForgeStudio[] = ['prism', 'cadence', 'splice', 'quill', 'tally', 'pitch', 'folio', 'board'];

test('every instrument has a unique identity and accountable release status', () => {
  assert.equal(new Set(forgeInstrumentBlueprints.map(x => x.id)).size, forgeInstrumentBlueprints.length);
  for (const instrument of forgeInstrumentBlueprints) {
    assert.ok(instrument.id.startsWith('forge.'));
    assert.ok(instrument.label.length > 3);
    assert.ok(instrument.intent.length > 20);
    assert.equal(instrument.releaseVerified, false, 'unverified native work cannot be marked release-ready');
    assert.ok(instrument.input.includes('accessibility'), `${instrument.id} lacks an accessible interaction contract`);
    assert.ok(instrument.studios === 'all' || instrument.studios.every(studio => studios.includes(studio)));
  }
  for (const studio of studios) {
    assert.ok(instrumentsForStudio(studio).length >= 3, `${studio} needs a specialist toolset`);
    assert.ok(instrumentsForStudio(studio).some(x => x.id === 'forge.precision-scrubber'));
    assert.ok(instrumentsForStudio(studio).some(x => x.id === 'forge.export-chamber'));
  }
});

test('precision scrub normal/fine/coarse are absolute, deterministic and mode aware', () => {
  const base = { min: 0, max: 100, step: 1, startValue: 10, deltaPixels: 80, pixelsPerStep: 8 };
  assert.equal(scrubPrecision(base), 20);
  assert.equal(scrubPrecision({ ...base, mode: 'fine' }), 11);
  assert.equal(scrubPrecision({ ...base, mode: 'coarse' }), 100);
  assert.equal(scrubPrecision({ ...base, deltaPixels: 0, startValue: 10.125 }), 10.125);
  assert.equal(scrubPrecision({ ...base, deltaPixels: -800 }), 0);
});

test('precision scrub accepts semantic detents and validates broken controls', () => {
  assert.equal(scrubPrecision({
    min: 0, max: 100, step: 1, startValue: 40, deltaPixels: 78, pixelsPerStep: 8,
    detents: [50],
  }), 50);
  assert.throws(() => scrubPrecision({ min: 5, max: 1, step: 1, startValue: 2, deltaPixels: 4 }), RangeError);
  assert.throws(() => scrubPrecision({ min: 0, max: 10, step: 0, startValue: 2, deltaPixels: 4 }), RangeError);
  assert.throws(() => scrubPrecision({ min: 0, max: 10, step: 1, startValue: 2, deltaPixels: Number.NaN }), RangeError);
  assert.throws(() => scrubPrecision({ min: 0, max: 10, step: 1, startValue: 2, deltaPixels: 4, pixelsPerStep: 0 }), RangeError);
});

const frames: ForgeTimebase = { kind: 'frames', rate: { numerator: 24000, denominator: 1001 } };
const beats: ForgeTimebase = { kind: 'beats', bpm: 120, beatsPerBar: 4 };

test('media timeline honors rational frame rate and musical beats', () => {
  assert.equal(nearestTimeUnit(1001 / 24000, frames), 1);
  assert.ok(Math.abs(timeAtUnit(1001, frames) - (1001 * 1001 / 24000)) < 1e-9);
  assert.equal(nearestTimeUnit(1.24, beats), 2);
  assert.equal(timeAtUnit(3, beats), 1.5);
  assert.throws(() => nearestTimeUnit(1, { kind: 'frames', rate: { numerator: 24, denominator: 0 } }), RangeError);
  assert.throws(() => nearestTimeUnit(1, { kind: 'beats', bpm: 0, beatsPerBar: 4 }), RangeError);
});

test('temporal ruler renders bounded, ordered, zoom-adaptive true unit ticks', () => {
  const query = { timebase: frames, startSeconds: 0, endSeconds: 8, pixelsPerSecond: 250, maxTicks: 512 };
  const ticks = temporalRulerTicks(query);
  assert.ok(ticks.length > 8 && ticks.length < 512);
  assert.equal(ticks[0]?.unit, 0);
  assert.equal(ticks[0]?.major, true);
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(ticks[i]!.unit > ticks[i - 1]!.unit);
    assert.ok(ticks[i]!.seconds > ticks[i - 1]!.seconds);
  }
  const moved = temporalRulerTicks({ ...query, startSeconds: 1 });
  for (const tick of moved) assert.deepEqual(tick, ticks.find(x => x.unit === tick.unit));
  const tight = temporalRulerTicks({ ...query, maxTicks: 8 });
  assert.equal(tight.length, 8);
});

test('invalid time ruler inputs fail before generating anything', () => {
  assert.throws(() => temporalRulerTicks({ timebase: beats, startSeconds: 2, endSeconds: 1, pixelsPerSecond: 100 }), RangeError);
  assert.throws(() => temporalRulerTicks({ timebase: beats, startSeconds: 0, endSeconds: 1, pixelsPerSecond: 0 }), RangeError);
  assert.throws(() => temporalRulerTicks({ timebase: beats, startSeconds: 0, endSeconds: 1, pixelsPerSecond: 100, maxTicks: 5000 }), RangeError);
});
