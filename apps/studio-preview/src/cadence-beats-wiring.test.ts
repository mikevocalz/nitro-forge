import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addCadenceLaneMarker, cadenceBeatMarkerInputs, cadenceBeatSensitivity, cadenceLaneMarkers, cadenceSecondsToTicks, cadenceTicksToSeconds,
  detectCadenceBeats, removeCadenceLaneMarker, updateCadenceLaneMarker,
} from './cadence-beats-wiring.ts';

function recorder(data: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const doc = new Proxy({}, { get: (_, method: string) => async (...args: unknown[]) => {
    calls.push([method, ...args]);
    const value = data[method];
    return { data: typeof value === 'function' ? value(...args) : value ?? { ok: true }, events: [] };
  } });
  return { doc: doc as never, calls };
}
// 960 ppq at 120 BPM: 1920 ticks per second.
const time = { ppq: 960, tempo_bpm: 120 };
const fps30 = { numerator: 30, denominator: 1 };

test('E-35 ticks and seconds convert with ppq * bpm / 60; markers become lane markers in frames', () => {
  assert.equal(cadenceSecondsToTicks(0.5, time), 960);
  assert.equal(cadenceTicksToSeconds(2880, time), 1.5);
  assert.throws(() => cadenceSecondsToTicks(-1, time), /zero or later/);
  assert.throws(() => cadenceSecondsToTicks(1, { ppq: 0, tempo_bpm: 120 }), /not usable/);
  assert.deepEqual(cadenceLaneMarkers([
    { id: 3, ticks: 1920, length_ticks: 0, name: 'Beat 1' },
    { id: 4, ticks: 3840, length_ticks: 960, name: 'Drop', note: 'fill' },
  ], time, fps30), [
    { id: '3', frame: 30, name: 'Beat 1' },
    { id: '4', frame: 60, durationFrames: 15, name: 'Drop', note: 'fill' },
  ]);
});

test('E-35 sensitivity is host state checked to 0..1', () => {
  assert.equal(cadenceBeatSensitivity(0), 0);
  assert.equal(cadenceBeatSensitivity(1), 1);
  assert.throws(() => cadenceBeatSensitivity(1.01), /between 0 and 1/);
  assert.throws(() => cadenceBeatSensitivity(Number.NaN), /between 0 and 1/);
});

test('E-35 detection passes sensitivity, then adds only new onsets in one addMarkers call', async () => {
  const onsets = { onsets_seconds: [0.5, 1, 1.5], estimated_bpm: null, hop_seconds: 0.01 };
  const { doc, calls } = recorder({ detectBeats: onsets, addMarkers: { marker_ids: [7, 8] } });
  const out = await detectCadenceBeats(doc, { fromTicks: 0, toTicks: 7680 }, 0.8, [{ ticks: 1920 }], time);
  assert.equal(out.added, 2);
  assert.deepEqual(calls, [
    ['detectBeats', { fromTicks: 0, toTicks: 7680, sampleRate: 48000, includeMetronome: false }, { sensitivity: 0.8 }],
    ['addMarkers', [{ ticks: 960, name: 'Beat 1' }, { ticks: 2880, name: 'Beat 2' }]],
  ]);
  calls.length = 0;
  // Every onset already marked: read-only, nothing written.
  const again = await detectCadenceBeats(doc, { fromTicks: 0, toTicks: 7680 }, 0.5, [{ ticks: 960 }, { ticks: 1920 }, { ticks: 2880 }], time);
  assert.equal(again.added, 0);
  assert.deepEqual(calls.map(c => c[0]), ['detectBeats']);
  calls.length = 0;
  await assert.rejects(detectCadenceBeats(doc, { fromTicks: 0, toTicks: 0 }, 0.5, [], time), /Add a clip/);
  await assert.rejects(detectCadenceBeats(doc, { fromTicks: 0, toTicks: 10 }, 2, [], time), /between 0 and 1/);
  // A cancelled run writes nothing.
  const controller = new AbortController();
  controller.abort();
  assert.equal((await detectCadenceBeats(doc, { fromTicks: 0, toTicks: 7680 }, 0.5, [], time, controller.signal)).added, 0);
  assert.deepEqual(calls.map(c => c[0]), ['detectBeats']);
});

test('E-35 onsets offset by the range start, dedupe within one run, and respect the 8192-marker cap', () => {
  assert.deepEqual(cadenceBeatMarkerInputs({ onsets_seconds: [0, 0.0001, 1] }, 480, [], time), [{ ticks: 480, name: 'Beat 1' }, { ticks: 2400, name: 'Beat 2' }]);
  assert.throws(() => cadenceBeatMarkerInputs({ onsets_seconds: [10] }, 0, Array.from({ length: 8192 }, (_, ticks) => ({ ticks })), time), /8192 markers/);
});

test('E-35 lane add, update and remove map to addMarker, updateMarker and removeMarker in ticks', async () => {
  const { doc, calls } = recorder();
  await addCadenceLaneMarker(doc, { seconds: 1.5 }, time);
  await updateCadenceLaneMarker(doc, '4', { frame: 60, seconds: 2, durationFrames: 15, durationSeconds: 0.5, name: 'Drop', note: '' }, time);
  await updateCadenceLaneMarker(doc, '4', { frame: 30, seconds: 1 }, time);
  await removeCadenceLaneMarker(doc, '4');
  assert.deepEqual(calls, [
    ['addMarker', { ticks: 2880 }],
    ['updateMarker', 4, { ticks: 3840, lengthTicks: 960, name: 'Drop', note: null }],
    ['updateMarker', 4, { ticks: 1920 }],
    ['removeMarker', 4],
  ]);
  assert.throws(() => removeCadenceLaneMarker(doc, 'x'), /marker id/);
  assert.throws(() => updateCadenceLaneMarker(doc, '0', { frame: 0, seconds: 0 }, time), /marker id/);
});
