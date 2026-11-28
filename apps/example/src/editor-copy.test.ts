import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionTitles, plural, studioRows } from './editor-copy.ts';

// Engine and payload syntax that leaked into the Actions panel before.
const DEVELOPER = /[=→+★]|\bt=|\bop\b|\bsnapshot\b|\bbytes?\b|\bengine\b|\bpayload\b|\brect\b|\bsegs?\b|\bpts\b/i;

test('every action label is plain words', () => {
  for (const [studio, titles] of Object.entries(actionTitles)) for (const [id, title] of Object.entries(titles)) {
    assert.doesNotMatch(title, DEVELOPER, `${studio}/${id}: ${title}`);
    assert.match(title, /^[A-Z]/, `${studio}/${id} starts with a capital verb or noun`);
    assert.match(id, /^[a-z0-9-]+$/, `${studio}/${id} is a stable test id`);
  }
});

test('outline rows count from 1 for unnamed items', () => {
  const prism = studioRows.prism({ width: 256, height: 256, layers: [{ name: '', opacity: 0.5, visible: true }, { name: 'Sky', opacity: 1, visible: false }] });
  assert.deepEqual(prism.map(row => row.label), ['Canvas', 'Layer 1', 'Sky']);
  assert.deepEqual(prism.map(row => row.value), ['256 × 256 px', 'Opacity 50%', 'Opacity 100% · Hidden']);
  const cadence = studioRows.cadence({ tempo_bpm: 120, time_sig: [4, 4], tracks: [{ clips: [{}] }, { name: 'Bass', clips: [], muted: true }] });
  assert.deepEqual(cadence.slice(2), [{ label: 'Track 1', value: '1 clip' }, { label: 'Bass', value: '0 clips · Muted' }]);
  const tally = studioRows.tally({ sheets: [{ name: 'Sheet1', cells: { A1: {} } }, { name: '', cells: {} }] });
  assert.deepEqual(tally, [{ label: 'Sheet1', value: '1 filled cell' }, { label: 'Sheet 2', value: '0 filled cells' }]);
  const splice = studioRows.splice({ fps: 24, tracks: [{ kind: 'video', clips: [{}, {}] }] });
  assert.deepEqual(splice, [{ label: 'Frame rate', value: '24 fps' }, { label: 'Video track 1', value: '2 clips' }]);
});

test('no studio row reads as a 0-indexed or engine label', () => {
  const sample = {
    width: 1, height: 1, layers: [{ id: 0, kind: 'shape' }], tracks: [{ id: 0, kind: 'audio' }], sheets: [{ cells: {} }],
    blocks: [{ kind: 'para', inlines: [] }], originals: { a: { rating: 1 } }, versions: {}, frame_rate: { num: 30, den: 1 },
    duration_s: 4, nodes: { 1: {} }, points: {}, segments: {}, circles: {}, constraints: {}, pages: 2, slides: [], fps: 30,
  };
  for (const [studio, rows] of Object.entries(studioRows)) for (const row of rows(sample)) {
    assert.doesNotMatch(`${row.label} ${row.value}`, /\b(Layer|Track|Sheet|track) 0\b|\bundefined\b|\bNaN\b/, `${studio}: ${row.label} ${row.value}`);
    assert.doesNotMatch(`${row.label} ${row.value}`, DEVELOPER, `${studio}: ${row.label} ${row.value}`);
  }
});

test('plural agrees with its count', () => {
  assert.equal(plural(1, 'clip'), '1 clip');
  assert.equal(plural(0, 'clip'), '0 clips');
  assert.equal(plural(3, 'star'), '3 stars');
});
