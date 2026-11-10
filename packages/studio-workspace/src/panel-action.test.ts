import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudioWorkspaceStore, actOnPanel } from './model.ts';

function compactStore() {
  const store = createStudioWorkspaceStore('prism');
  store.getState().setGeometry({ width: 390, height: 563, minStageWidth: 300, minStageHeight: 160 });
  return store;
}
test('switching compact dock tabs keeps their authored order and active content', () => {
  const store = compactStore();
  assert.equal(actOnPanel(store, 'properties', 'activate', true), true);
  assert.equal(actOnPanel(store, 'actions', 'activate', true), true);
  const order = [...store.getState().layout.docks.bottom];
  for (const id of ['properties', 'actions', 'properties']) {
    assert.equal(actOnPanel(store, id, 'activate', true), true);
    assert.deepEqual(store.getState().layout.docks.bottom, order);
    assert.equal(store.getState().layout.activeTabs.bottom, id);
  }
});
test('a collapsed panel already at bottom expands to usable compact height without migration', () => {
  const store = compactStore();
  const order = [...store.getState().layout.docks.bottom];
  assert.equal(actOnPanel(store, 'history', 'activate', true), true);
  assert.deepEqual(store.getState().layout.docks.bottom, order);
  assert.equal(store.getState().layout.sizes.bottomFraction, 0.5);
  assert.ok(!store.getState().layout.collapsed.includes('history'));
});
test('wide-panel activation retains its original dock', () => {
  const store = createStudioWorkspaceStore('prism');
  assert.equal(actOnPanel(store, 'properties', 'activate', false), true);
  assert.ok(store.getState().layout.docks.right.includes('properties'));
  assert.ok(!store.getState().layout.docks.bottom.includes('properties'));
});
