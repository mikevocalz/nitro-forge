import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_COMPOSER_DRAFT, capabilityTag, composerCapabilities, designStudioInstruments, dragTargetIndex, draftManifest,
  moveAnnouncement, moveRailItem, nameCounter, requestedImportLabel, saveBlocker, savedMessage, toPersonaDraft, toggleId,
} from './persona-composer-model.ts';
import { createPersonaStore } from './persona-store.ts';

test('design studio instruments are the prism and all-studio blueprints only', () => {
  const ids = designStudioInstruments.map(i => i.id);
  assert.ok(ids.includes('forge.precision-scrubber'));
  assert.ok(ids.includes('forge.chroma-space'));
  assert.ok(!ids.includes('forge.piano-roll'));
  assert.ok(!ids.includes('forge.formula-lens'));
  for (const i of designStudioInstruments) assert.ok(i.studios === 'all' || i.studios.includes('prism'));
});

test('rail moves stay in bounds and keep every item', () => {
  const rail = ['a', 'b', 'c'];
  assert.deepEqual(moveRailItem(rail, 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveRailItem(rail, 2, -2), ['c', 'a', 'b']);
  assert.deepEqual(moveRailItem(rail, 0, -1), rail);
  assert.deepEqual(moveRailItem(rail, 2, 1), rail);
  assert.equal(moveAnnouncement(['forge.ink-deck', 'forge.chroma-space'], 'forge.chroma-space'), 'Chroma Space moved to position 2 of 2');
});

test('drag target follows measured row heights in both directions', () => {
  const heights = [56, 56, 56, 56];
  assert.equal(dragTargetIndex(0, 10, heights), 0);
  assert.equal(dragTargetIndex(0, 56, heights), 1);
  assert.equal(dragTargetIndex(0, 500, heights), 3);
  assert.equal(dragTargetIndex(3, -120, heights), 1);
  assert.equal(dragTargetIndex(1, Number.NaN, heights), 1);
});

test('toggle adds then removes without reordering others', () => {
  assert.deepEqual(toggleId(['a', 'b'], 'c'), ['a', 'b', 'c']);
  assert.deepEqual(toggleId(['a', 'b', 'c'], 'b'), ['a', 'c']);
});

test('save blocker names the first missing piece', () => {
  assert.equal(saveBlocker(EMPTY_COMPOSER_DRAFT), 'Name the persona to save it');
  assert.equal(saveBlocker({ ...EMPTY_COMPOSER_DRAFT, label: 'x'.repeat(41) }), 'Shorten the name to 40 characters');
  assert.equal(saveBlocker({ ...EMPTY_COMPOSER_DRAFT, label: 'Print' }), 'Add an instrument to the rail to save');
  assert.equal(saveBlocker({ ...EMPTY_COMPOSER_DRAFT, label: 'Print', rail: ['forge.ink-deck'], surfaceMode: 'chosen' }), 'Pick at least one surface to save');
  assert.equal(saveBlocker({ ...EMPTY_COMPOSER_DRAFT, label: 'Print', rail: ['forge.ink-deck'] }), undefined);
  assert.equal(nameCounter('  Print '), '5 of 40');
});

test('chosen surfaces serialize in manifest order; all stays all', () => {
  assert.equal(toPersonaDraft({ ...EMPTY_COMPOSER_DRAFT, surfaces: ['xr'] }).surfaces, 'all');
  assert.deepEqual(toPersonaDraft({ ...EMPTY_COMPOSER_DRAFT, surfaceMode: 'chosen', surfaces: ['xr', 'iphone'] }).surfaces, ['iphone', 'xr']);
});

test('draft manifest is honest about missing engine support and surfaces', () => {
  const draft = { ...EMPTY_COMPOSER_DRAFT, label: 'Print', rail: ['forge.ink-deck'], capabilities: ['shapes', 'path-nodes', 'data-merge'] };
  const m = draftManifest(draft, 'iphone');
  assert.equal(m.available, true);
  assert.deepEqual(m.lines.map(l => l.ready), [true, false, false]);
  assert.equal(m.lines[1]!.note, 'Paths and nodes: not in this build');
  assert.equal(m.lines[2]!.note, 'Data merge: desktop and web only');
  const ipadOnly = draftManifest({ ...draft, surfaceMode: 'chosen', surfaces: ['ipad'] }, 'iphone');
  assert.equal(ipadOnly.available, false);
  assert.equal(ipadOnly.reason, 'Print: iPad only');
});

test('capability tags label unbuilt and surface-limited items', () => {
  const byId = new Map(composerCapabilities.map(c => [c.id, c]));
  assert.equal(capabilityTag(byId.get('shapes')!), undefined);
  assert.equal(capabilityTag(byId.get('pages')!), 'Not in this build');
  assert.equal(capabilityTag({ ...byId.get('shapes')!, surfaces: ['desktop', 'web'] }), 'Desktop and web only');
});

test('saved message names the suffix when the store resolved a conflict', () => {
  const store = createPersonaStore({ surface: 'iphone' });
  const saved = store.getState().compose({ label: 'Vector', rail: ['forge.ink-deck'], capabilities: [] });
  assert.equal(savedMessage('Saved', 'Vector', saved), 'Saved as Vector 2. Vector was already taken.');
  const plain = store.getState().compose({ label: 'Print', rail: ['forge.ink-deck'], capabilities: [] });
  assert.equal(savedMessage('Saved', ' Print ', plain), 'Saved Print');
  assert.equal(requestedImportLabel('{"label":"Pixel"}'), 'Pixel');
  assert.equal(requestedImportLabel('not json'), '');
});
