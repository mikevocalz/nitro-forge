import assert from 'node:assert/strict';
import { collapsePanel, createWorkspace, dockPanel, parsePreset, serializePreset } from '@nitro-forge/studio-layout';

export async function example() {
  const known = new Set(['layers', 'inspector']);
  const empty = createWorkspace('prism');

  const docked = dockPanel(empty, 'layers', 'right', 0, known);
  assert.equal(docked.ok, true);
  assert.deepEqual(docked.layout.docks.right, ['layers']);

  const unknown = dockPanel(docked.layout, 'history', 'left', 0, known);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.ok ? undefined : unknown.reason, 'unknown-panel');

  const collapsed = collapsePanel(docked.layout, 'layers', true);
  assert.deepEqual(collapsed.layout.collapsed, ['layers']);

  const saved = serializePreset(collapsed.layout, known);
  assert.deepEqual(parsePreset(saved, known), collapsed.layout);
  assert.equal(parsePreset('{"schemaVersion":2}', known), null);
}
