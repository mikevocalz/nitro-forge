import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILT_IN_PERSONAS, PERSONA_SURFACES, composePersona, exportPersona, importPersona,
  personaCapabilities, personaManifest, personasOn, switchPersona,
  type ContinuityState, type PersonaSession,
} from './persona.ts';
import { forgeInstrumentBlueprints } from './instrument-system.ts';

const continuity: ContinuityState = { selectedLayerId: 3, viewport: { zoom: 2, panX: 10, panY: -4 }, color: [255, 80, 0, 255], brushSizePx: 12 };
const start: PersonaSession = { personaId: 'vector', continuity };

test('built-in personas reference only real instruments and capabilities', () => {
  const instruments = new Set(forgeInstrumentBlueprints.map(i => i.id));
  const caps = new Set(personaCapabilities.map(c => c.id));
  assert.deepEqual(BUILT_IN_PERSONAS.map(p => p.id), ['vector', 'pixel', 'layout', 'sketch']);
  for (const p of BUILT_IN_PERSONAS) {
    for (const id of p.rail) assert.ok(instruments.has(id), `${p.id} rail ${id}`);
    for (const id of p.capabilities) assert.ok(caps.has(id), `${p.id} capability ${id}`);
  }
});

test('available capabilities name real engine ops; missing ones name none', () => {
  for (const c of personaCapabilities) assert.equal(c.ops.length > 0, c.engine === 'available', c.id);
});

test('continuity survives every persona pair on every surface it can reach', () => {
  for (const surface of PERSONA_SURFACES) {
    const stops = personasOn(BUILT_IN_PERSONAS, surface);
    for (const from of stops) for (const to of stops) {
      const next = switchPersona({ personaId: from.id, continuity }, to.id, BUILT_IN_PERSONAS, surface);
      assert.equal(next.personaId, to.id);
      assert.equal(next.continuity, continuity, `${from.id}->${to.id} on ${surface}`);
    }
  }
});

test('Sketch is a stop only on iPad and XR and says why elsewhere', () => {
  assert.deepEqual(PERSONA_SURFACES.filter(s => personasOn(BUILT_IN_PERSONAS, s).some(p => p.id === 'sketch')), ['ipad', 'xr']);
  assert.throws(() => switchPersona(start, 'sketch', BUILT_IN_PERSONAS, 'iphone'), /Sketch: iPad and XR only/);
  assert.throws(() => switchPersona(start, 'nope', BUILT_IN_PERSONAS, 'web'), /Unknown persona 'nope'/);
});

test('switching to the active persona returns the same session', () => {
  assert.equal(switchPersona(start, 'vector', BUILT_IN_PERSONAS, 'web'), start);
});

test('manifest gives a plain reason for every item that is not ready', () => {
  const layout = BUILT_IN_PERSONAS.find(p => p.id === 'layout')!;
  const ipad = personaManifest(layout, 'ipad');
  assert.equal(ipad.available, true);
  assert.equal(ipad.lines.find(l => l.id === 'data-merge')!.note, 'Data merge: desktop and web only');
  assert.equal(ipad.lines.find(l => l.id === 'pages')!.note, 'Pages: not in this build');
  for (const s of PERSONA_SURFACES) for (const p of BUILT_IN_PERSONAS)
    for (const line of personaManifest(p, s).lines) assert.equal(line.ready, line.note === undefined, `${p.id}/${s}/${line.id}`);
  const pixel = personaManifest(BUILT_IN_PERSONAS.find(p => p.id === 'pixel')!, 'android-foldable');
  assert.ok(pixel.lines.every(l => l.ready));
});

test('composer suffixes name conflicts and never overwrites', () => {
  const a = composePersona({ label: 'vector', rail: ['forge.chroma-space'], capabilities: ['shapes'] }, BUILT_IN_PERSONAS);
  assert.equal(a.label, 'vector 2');
  assert.equal(a.builtIn, false);
  const all = [...BUILT_IN_PERSONAS, a];
  const b = composePersona({ label: 'Vector', rail: ['forge.chroma-space'], capabilities: [] }, all);
  assert.equal(b.label, 'Vector 3');
  assert.notEqual(a.id, b.id);
  assert.ok(personasOn([...all, b], 'iphone').some(p => p.id === b.id));
});

test('composer rejects invalid drafts with the reason', () => {
  assert.throws(() => composePersona({ label: ' ', rail: ['forge.chroma-space'], capabilities: [] }, []), /1 to 40/);
  assert.throws(() => composePersona({ label: 'A', rail: [], capabilities: [] }, []), /at least one instrument/);
  assert.throws(() => composePersona({ label: 'A', rail: ['forge.fake'], capabilities: [] }, []), /Unknown instrument 'forge.fake'/);
  assert.throws(() => composePersona({ label: 'A', rail: ['forge.chroma-space'], capabilities: ['x'] }, []), /Unknown capability 'x'/);
  assert.throws(() => composePersona({ label: 'A', rail: ['forge.chroma-space'], capabilities: [], surfaces: [] }, []), /at least one surface/);
});

test('export and import round-trip a user persona and resolve conflicts', () => {
  const mine = composePersona({ label: 'Poster', rail: ['forge.chroma-space', 'forge.chroma-space', 'forge.layer-constellation'], capabilities: ['shapes'], surfaces: ['ipad', 'web'] }, BUILT_IN_PERSONAS);
  assert.deepEqual(mine.rail, ['forge.chroma-space', 'forge.layer-constellation']);
  const json = exportPersona(mine);
  const fresh = importPersona(json, BUILT_IN_PERSONAS);
  assert.deepEqual({ ...fresh }, { ...mine });
  const again = importPersona(json, [...BUILT_IN_PERSONAS, mine]);
  assert.equal(again.label, 'Poster 2');
  assert.throws(() => exportPersona(BUILT_IN_PERSONAS[0]), /built in/);
});

test('import treats the file as untrusted input', () => {
  assert.throws(() => importPersona('{', []), /not valid JSON/);
  assert.throws(() => importPersona('null', []), /JSON object/);
  assert.throws(() => importPersona('{"format":2}', []), /Unsupported persona format 2/);
  assert.throws(() => importPersona('{"format":1,"label":"A","rail":"x","capabilities":[],"surfaces":"all"}', []), /'rail' must be a list/);
  assert.throws(() => importPersona('{"format":1,"label":"A","rail":["forge.chroma-space"],"capabilities":[],"surfaces":["moon"]}', []), /Unknown surface 'moon'/);
});
