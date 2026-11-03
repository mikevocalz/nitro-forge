import assert from 'node:assert/strict';
import test from 'node:test';
import { stageFits } from '@nitro-forge/studio-layout';
import { createStudioWorkspaceStore, KNOWN_PANELS } from './model.ts';

const large = { width: 1200, height: 800, minStageWidth: 320, minStageHeight: 240 };
const host = { x: 0, y: 0, width: 1200, height: 800 };

test('stores are independent and failed transitions preserve the active layout', () => {
  const a = createStudioWorkspaceStore();
  const b = createStudioWorkspaceStore();
  const initial = a.getState().layout;
  assert.equal(a.getState().action('unregistered', 'move-right'), false);
  assert.equal(a.getState().layout, initial);
  assert.equal(a.getState().error, 'unknown-panel');
  assert.equal(a.getState().action('outline', 'move-right'), true);
  assert.deepEqual(b.getState().layout.docks.left, ['outline']);
  assert.deepEqual(a.getState().layout.docks.left, []);
});

test('drag previews and cancellation never mutate layout; commit applies once', () => {
  const store = createStudioWorkspaceStore();
  store.getState().setGeometry(large);
  const before = store.getState().layout;
  store.getState().beginDrag('outline');
  store.getState().previewDrag({ point: { x: 1198, y: 300 }, host });
  assert.equal(store.getState().drag?.preview?.dock, 'right');
  assert.equal(store.getState().layout, before);
  store.getState().cancelDrag();
  assert.equal(store.getState().layout, before);
  assert.equal(store.getState().commitDrag(), false);
  store.getState().beginDrag('outline');
  store.getState().previewDrag({ point: { x: 1198, y: 300 }, host });
  assert.equal(store.getState().commitDrag(), true);
  const after = store.getState().layout;
  assert.deepEqual(after.docks.right, ['properties', 'actions', 'outline']);
  assert.equal(store.getState().commitDrag(), false);
  assert.equal(store.getState().layout, after);
});

test('blocked and interior drops produce no target and cannot commit', () => {
  const store = createStudioWorkspaceStore();
  const before = store.getState().layout;
  store.getState().beginDrag('history');
  store.getState().previewDrag({ point: { x: 600, y: 300 }, host });
  assert.equal(store.getState().drag?.preview, null);
  assert.equal(store.getState().commitDrag(), false);
  store.getState().beginDrag('history');
  store.getState().previewDrag({ point: { x: 1198, y: 300 }, host,
    blockedRegions: [{ x: 1190, y: 0, width: 10, height: 800 }] });
  assert.equal(store.getState().commitDrag(), false);
  assert.equal(store.getState().layout, before);
});

test('responsive fallback preserves every panel and refuses expansions that consume stage space', () => {
  const store = createStudioWorkspaceStore();
  const compact = { width: 380, height: 300, minStageWidth: 320, minStageHeight: 240 };
  store.getState().setGeometry(compact);
  assert.equal(stageFits(store.getState().layout, compact), true);
  assert.deepEqual(new Set(Object.values(store.getState().layout.docks).flat()), KNOWN_PANELS);
  assert.equal(store.getState().action('outline', 'expand'), false);
  assert.equal(store.getState().error, 'no-stage-space');
  const before = store.getState().layout;
  store.getState().setGeometry({ ...compact, width: Number.NaN });
  assert.equal(store.getState().layout, before);
  assert.equal(store.getState().error, 'invalid-geometry');
  store.getState().setGeometry({ ...compact, width: 100, height: 100 });
  assert.equal(store.getState().layout.collapsed.length, 4);
});

test('presets validate before restoring and reset respects measured geometry', () => {
  const store = createStudioWorkspaceStore('tally');
  store.getState().action('outline', 'move-bottom');
  const raw = store.getState().savePreset();
  assert.equal(typeof raw, 'string');
  store.getState().reset();
  assert.deepEqual(store.getState().layout.docks.left, ['outline']);
  assert.equal(store.getState().restorePreset(raw!), true);
  assert.deepEqual(store.getState().layout.docks.left, []);
  const before = store.getState().layout;
  for (const invalid of ['{', JSON.stringify({ ...JSON.parse(raw!), studioId: 'prism' }),
    JSON.stringify({ ...JSON.parse(raw!), docks: { left: [], right: [], bottom: [] }, activeTabs: {} })]) {
    assert.equal(store.getState().restorePreset(invalid), false);
    assert.equal(store.getState().layout, before);
  }
  const compact = { width: 400, height: 300, minStageWidth: 320, minStageHeight: 240 };
  store.getState().setGeometry(compact);
  store.getState().reset();
  assert.equal(stageFits(store.getState().layout, compact), true);
});

test('resize validates fraction and geometry without partially changing sizes', () => {
  const store = createStudioWorkspaceStore();
  assert.equal(store.getState().resize('left', .3), false);
  store.getState().setGeometry(large);
  assert.equal(store.getState().resize('left', .3), true);
  const before = store.getState().layout;
  assert.equal(store.getState().resize('left', .6), false);
  assert.equal(store.getState().layout, before);
  assert.equal(store.getState().layout.sizes.leftFraction, .3);
});


test('resizing cannot consume the minimum stage and a host resize invalidates drag previews', () => {
  const store = createStudioWorkspaceStore();
  const geometry = { width: 800, height: 800, minStageWidth: 420, minStageHeight: 240 };
  store.getState().setGeometry(geometry);
  const before = store.getState().layout;
  assert.equal(store.getState().resize('left', .45), false);
  assert.equal(store.getState().error, 'no-stage-space');
  assert.equal(store.getState().layout, before);
  store.getState().beginDrag('history');
  store.getState().previewDrag({ point: { x: 2, y: 300 },
    host: { x: 0, y: 0, width: 800, height: 800 } });
  assert.equal(store.getState().drag?.preview?.dock, 'left');
  store.getState().setGeometry(large);
  assert.equal(store.getState().drag, null);
  const afterMeasure = store.getState().layout;
  assert.equal(store.getState().commitDrag(), false);
  assert.equal(store.getState().layout, afterMeasure);
});


test('compact reset and preset restore preserve placements with side panels collapsed', () => {
  const store = createStudioWorkspaceStore();
  const preset = store.getState().savePreset()!;
  const compact = { width: 650, height: 800, minStageWidth: 320, minStageHeight: 240 };
  store.getState().setGeometry(compact);
  const assertCompactSides = () => {
    const layout = store.getState().layout;
    assert.deepEqual(layout.docks.left, ['outline']);
    assert.deepEqual(layout.docks.right, ['properties', 'actions']);
    for (const panel of [...layout.docks.left, ...layout.docks.right]) {
      assert.equal(layout.collapsed.includes(panel), true);
    }
    assert.equal(stageFits(layout, compact), true);
  };
  assertCompactSides();
  store.getState().reset();
  assertCompactSides();
  assert.equal(store.getState().restorePreset(preset), true);
  assertCompactSides();
});


test('writing defaults reserve page space and keep optional history collapsed', () => {
  const writing = createStudioWorkspaceStore('quill').getState().layout;
  assert.deepEqual(writing.activeTabs, { left: 'outline' });
  assert.equal(writing.collapsed.includes('history'), true);
  assert.equal(writing.collapsed.includes('properties'), true);
  assert.equal(writing.collapsed.includes('actions'), true);
  assert.equal(writing.collapsed.includes('outline'), false);
  for (const studio of ['prism', 'tally', 'pitch', 'folio', 'splice', 'cadence'] as const) {
    assert.equal(createStudioWorkspaceStore(studio).getState().layout.collapsed.includes('history'), true);
  }
});
