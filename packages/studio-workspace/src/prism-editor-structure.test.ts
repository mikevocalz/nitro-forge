import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./prism-editor.tsx', import.meta.url), 'utf8');

// Android hit-tests children only inside their parent's bounds. A persona
// popover rendered inside the 48 pt toolbar row drew below it but took no
// touches and was missing from the accessibility tree (Surface Duo, 2026-11-04).
test('persona surfaces render on the editor, not inside the toolbar', () => {
  const start = source.indexOf('<View ref={personaToolbar}');
  const toolbar = source.slice(start, source.indexOf('\n    </View>', start));
  assert.ok(toolbar.includes('{personaTrigger}'));
  assert.ok(!toolbar.includes('{personaSurface}'));
  assert.ok(source.slice(start + toolbar.length).includes('{personaSurface}'));
});

// Without its own label, Fabric's recycled view kept a stale "Creation tools" description.
test('the fill bar carries its own accessibility label', () => {
  assert.match(source, /testID="prism-fill-bar" accessibilityLabel=/);
});
