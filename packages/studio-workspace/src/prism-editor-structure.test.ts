import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';

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

// React Native on Android throws "Invalid accessibility role value" for any
// accessibilityRole outside this enum (ReactAccessibilityDelegate, RN 0.88),
// and the throw takes down the whole screen. Web-only roles go on `role`.
const ANDROID_ROLES = new Set('none button dropdownlist togglebutton link search image imagebutton keyboardkey text adjustable summary header alert checkbox combobox menu menubar menuitem progressbar radio radiogroup scrollbar spinbutton switch tab tabbar tablist timer list grid pager scrollview horizontalscrollview viewgroup webview drawerlayout slidingdrawer iconmenu toolbar'.split(' '));
test('every accessibilityRole is one Android accepts', () => {
  for (const name of readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.tsx'))) {
    const text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
    for (const [, role] of text.matchAll(/accessibilityRole=\{?["']([a-z]+)["']/g)) assert.ok(ANDROID_ROLES.has(role!), `${name}: accessibilityRole "${role}" crashes on Android`);
  }
});

// B-11 (decision D7): the Layers panel keeps Forge's configured opacity
// scrubber (forced colours, 1 % step, density target) and takes blend mode
// from Tron's layer blend model through Tron's MenuButton. Both commit through
// the same layer-command path as LayerStack.
test('the Layers panel splits Tron blend mode from Forge opacity', () => {
  const start = source.indexOf('const panel = <View testID="prism-layers"');
  const panel = source.slice(start, source.indexOf('</TokenScope>', start));
  assert.doesNotMatch(source, /LayerBlendAndOpacity/);
  assert.match(panel, /<MenuButton[^]*?label="Layer blend mode"[^]*?items=\{prismBlendMenuItems\(\)\}/);
  assert.match(panel, /onSelect=\{mode => runLayerCommand\(rows => prismBlendCommand\(rows, selected\.id, \{ kind: 'mode', mode \}\)\)\}/);
  assert.match(panel, />\{PRISM_ALPHA_MODES\[0\]\.label\}</);
  const at = panel.indexOf('<PrecisionScrubber');
  assert.ok(at > 0, 'the panel renders PrecisionScrubber');
  const scrubber = panel.slice(at, panel.indexOf('/>', at));
  assert.match(scrubber, /\{\.\.\.PRISM_OPACITY_SCRUBBER\}/);
  assert.match(scrubber, /targetSize=\{scale\.size\.target\}/);
  assert.match(scrubber, /forcedColors=\{forced\}/);
  assert.match(scrubber, /onCommit=\{percent => runLayerCommand\(rows => prismBlendCommand\(rows, selected\.id, \{ kind: 'opacity', percent \}\)\)\}/);
  // The head is not a scroll view, so nothing in it sits under a fold.
  assert.doesNotMatch(panel, /<ScrollView testID="prism-layer-blend"/);
  // Row opacity drags in LayerStack stay.
  assert.match(panel, /onOpacityCommit=/);
});
