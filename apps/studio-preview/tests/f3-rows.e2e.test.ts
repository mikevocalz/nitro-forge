import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliHost } from '@nitro-forge/ignition/cli';
import { TallyDocument } from '../../../packages/tally/src/index';
import { CadenceDocument } from '../../../packages/cadence/src/index';
import { assignTallyPivotField, commitTallyPivot, EMPTY_TALLY_PIVOT_SPEC, readTallyPivot, readTallyPivotSource } from '../src/tally-pivot-wiring';
import { cadenceLaneMarkers, detectCadenceBeats, updateCadenceLaneMarker } from '../src/cadence-beats-wiring';

// F3 I-15 and E-35 wiring against the real Rust engines through nf-cli
// (`cargo build --locked -p nf-cli` first). The node tests in src/ cover the
// same modules with recorded calls; these prove the engine accepts them.

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

describe('I-15 PivotFieldList wiring on Tally', () => {
  it('a filters assignment stores an "All" filter and refreshes to the unfiltered grid', async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setRange('A1', [['east', '1', '10'], ['west', '2', '20'], ['east', '3', '30'], ['west', '4', '40']]);
      const source = await readTallyPivotSource(doc, { from: 'A1', to: 'C4' });
      expect(source.numeric).toEqual([false, true, true]);

      // Filters first: still a draft, so nothing is stored.
      let spec = assignTallyPivotField(EMPTY_TALLY_PIVOT_SPEC, source, 'f2', 'filters');
      expect(await commitTallyPivot(doc, 'Sheet1', null, source, spec)).toEqual({ stored: false });
      expect((await doc.listPivots('Sheet1')).data.pivots).toEqual([]);
      spec = assignTallyPivotField(spec, source, 'f0', 'rows');
      spec = assignTallyPivotField(spec, source, 'f1', 'values');
      const created = await commitTallyPivot(doc, 'Sheet1', null, source, spec);
      expect(created.stored).toBe(true);
      const id = (created as { id: number }).id;
      await doc.refreshPivot(id);
      const grid = async () => (await doc.exportCsv({ sheet: 'Sheet1', range: { from: 'E1', to: 'F3' } })).data.text;
      expect(await grid()).toBe(',sum:1\r\neast,4\r\nwest,6\r\n');

      const read = await readTallyPivot(doc, 'Sheet1');
      expect(read?.spec.filters).toEqual([{ field: 2, values: [] }]);
      expect(read?.output?.anchor).toBe('E1');

      // A second "All" filter is one undo step and leaves the refreshed grid unchanged.
      await commitTallyPivot(doc, 'Sheet1', id, source, assignTallyPivotField(read!.spec, source, 'f0', 'filters'));
      expect((await doc.refreshPivot(id)).data.changed).toBe(0);
      expect(await doc.undo()).toBe(true);
      expect((await readTallyPivot(doc, 'Sheet1'))?.spec.filters).toEqual([{ field: 2, values: [] }]);
    } finally {
      await doc.close();
    }
  });
});

describe('E-35 BeatDetectionMarkerLane wiring on Cadence', () => {
  it('detects at two sensitivities, stores beats as markers, and undoes each run as one step', async () => {
    const doc = await CadenceDocument.open(host, 120);
    try {
      const track = (await doc.addTrack('midi')).data.track_id;
      const clip = (await doc.addClip(track, 0, 7680)).data.clip_id;
      for (let i = 0; i < 16; i++) await doc.addNote(clip, 81, i * 480, 96, i % 2 === 0 ? 127 : 30);
      const time = { ppq: 960, tempo_bpm: 120 }, range = { fromTicks: 0, toTicks: 7680 };
      const list = async () => (await doc.listMarkers()).data.markers;

      const half = await detectCadenceBeats(doc, range, 0.5, [], time);
      const atHalf = await list();
      expect(half.added).toBe(atHalf.length);
      expect(atHalf.length).toBeGreaterThan(0);
      const loose = await detectCadenceBeats(doc, range, 1, atHalf, time);
      expect(loose.added).toBeGreaterThan(0);
      const atLoose = await list();
      expect(atLoose.length).toBe(atHalf.length + loose.added);

      expect(await doc.undo()).toBe(true);
      expect(await list()).toEqual(atHalf);
      expect(await doc.redo()).toBe(true);
      expect(await list()).toEqual(atLoose);

      // A lane rename keeps the id and the tick position.
      const first = atLoose[0]!;
      const lane = cadenceLaneMarkers([first], time, { numerator: 30, denominator: 1 })[0]!;
      await updateCadenceLaneMarker(doc, lane.id, { frame: lane.frame, seconds: first.ticks / 1920, name: 'Downbeat' }, time);
      expect((await list())[0]).toMatchObject({ id: first.id, ticks: first.ticks, name: 'Downbeat' });
    } finally {
      await doc.close();
    }
  });
});
