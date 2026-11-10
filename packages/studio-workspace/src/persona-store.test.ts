import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonaStore, type PersonaStoragePort } from './persona-store.ts';

const memory = (initial: string | null = null) => {
  let value = initial;
  const port: PersonaStoragePort = { load: () => value, save: json => { value = json; } };
  return { port, read: () => value };
};

test('switching keeps continuity by reference and reports unreachable personas', () => {
  const store = createPersonaStore({ surface: 'iphone' });
  store.getState().setContinuity({ selectedLayerId: 4, brushSizePx: 20 });
  const before = store.getState().continuity;
  store.getState().switchTo('pixel');
  assert.equal(store.getState().activeId, 'pixel');
  assert.equal(store.getState().continuity, before);
  store.getState().switchTo('sketch');
  assert.equal(store.getState().activeId, 'pixel');
  assert.match(store.getState().error ?? '', /Sketch: iPad and XR only/);
});

test('composed personas persist, reload and keep conflict suffixes', () => {
  const disk = memory();
  const a = createPersonaStore({ surface: 'web', storage: disk.port });
  const poster = a.getState().compose({ label: 'Poster', rail: ['forge.chroma-space'], capabilities: ['shapes'] });
  a.getState().compose({ label: 'Poster', rail: ['forge.layer-constellation'], capabilities: [] });
  const b = createPersonaStore({ surface: 'web', storage: disk.port, initialPersonaId: poster.id });
  assert.deepEqual(b.getState().personas.filter(p => !p.builtIn).map(p => p.label), ['Poster', 'Poster 2']);
  assert.equal(b.getState().activeId, poster.id);
  b.getState().remove(poster.id);
  assert.equal(b.getState().activeId, 'vector');
  assert.throws(() => b.getState().remove('vector'), /built in/);
  const c = createPersonaStore({ surface: 'web', storage: disk.port });
  assert.deepEqual(c.getState().personas.filter(p => !p.builtIn).map(p => p.label), ['Poster 2']);
});

test('unreadable saved personas surface an error and keep the built-ins', () => {
  const store = createPersonaStore({ surface: 'web', storage: memory('{"format":9}').port });
  assert.match(store.getState().error ?? '', /could not be read/);
  assert.equal(store.getState().personas.length, 4);
});

test('import validates untrusted JSON and export round-trips', () => {
  const store = createPersonaStore({ surface: 'ipad' });
  const made = store.getState().compose({ label: 'Ink', rail: ['forge.ink-deck'], capabilities: ['pencil-strokes'], surfaces: ['ipad'] });
  const json = store.getState().exportJson(made.id);
  const copy = store.getState().importJson(json);
  assert.equal(copy.label, 'Ink 2');
  assert.throws(() => store.getState().importJson('nope'), /Stops at character 2, at “o”/);
});

test('a surface change keeps a persona that runs there and falls back otherwise', () => {
  const store = createPersonaStore({ surface: 'ipad', initialPersonaId: 'sketch' });
  const before = store.getState().continuity;
  store.getState().setSurface('xr');
  assert.equal(store.getState().activeId, 'sketch');
  store.getState().setSurface('android-foldable');
  assert.equal(store.getState().surface, 'android-foldable');
  assert.equal(store.getState().activeId, 'vector');
  assert.match(store.getState().error ?? '', /Sketch does not run here/);
  assert.equal(store.getState().continuity, before);
});
