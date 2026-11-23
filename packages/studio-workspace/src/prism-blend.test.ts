import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerBlendProblem, validateLayerBlend } from '@nyc-tron/ui/components/forge/layers/layer-blend-model';
import { PRISM_ALPHA_MODES, PRISM_BLEND_MODE_IDS, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, PRISM_OPACITY_SCRUBBER, prismBlendCommand, prismBlendMenuItems, prismLayerBlendValue } from './prism-blend.ts';
import type { PrismLayer } from './prism-layers.ts';

const layer = (id: number, blend?: string, opacity = 0.5): PrismLayer => ({ id, name: `Layer ${id}`, visible: true, opacity, ...(blend === undefined ? {} : { blend }), content: { type: 'raster', pixels_b64: '' } });
const doc = [layer(3, 'normal'), layer(7, 'multiply'), layer(9, 'hue', 1)];

test('B-11 the alpha catalog lists Straight only, and Tron rejects Premultiplied against it', () => {
  assert.deepEqual(PRISM_ALPHA_MODES.map(mode => mode.id), ['straight']);
  const value = prismLayerBlendValue(doc[1]!);
  assert.deepEqual(value, { mode: 'multiply', opacity: 0.5, spaceId: PRISM_BLEND_SPACES[0].id, alphaMode: 'straight' });
  validateLayerBlend(value!, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, PRISM_ALPHA_MODES);
  assert.equal(layerBlendProblem(value!, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, PRISM_ALPHA_MODES), undefined);
  assert.throws(() => validateLayerBlend({ ...value!, alphaMode: 'premultiplied' }, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, PRISM_ALPHA_MODES), RangeError);
});

test('B-11 every Prism blend mode is offered in the one compositing space', () => {
  assert.equal(PRISM_BLEND_MODE_IDS.length, 13);
  assert.deepEqual(PRISM_BLEND_MODES.map(mode => mode.id), [...PRISM_BLEND_MODE_IDS]);
  assert.deepEqual(PRISM_BLEND_SPACES.map(space => space.modeIds), [PRISM_BLEND_MODE_IDS]);
  assert.ok(PRISM_BLEND_MODES.every(mode => mode.unavailableReason === undefined));
});

test('B-11 the mode menu lists every Prism mode, enabled, with the catalog labels', () => {
  const items = prismBlendMenuItems();
  assert.deepEqual(items.map(item => item.id), [...PRISM_BLEND_MODE_IDS]);
  assert.deepEqual(items.map(item => item.label), PRISM_BLEND_MODES.map(mode => mode.label));
  assert.ok(items.every(item => !item.disabled));
});

test('B-11 a layer without a blend field reads as normal; an unknown one has no value', () => {
  assert.equal(prismLayerBlendValue(layer(1))?.mode, 'normal');
  assert.equal(prismLayerBlendValue(layer(1, 'hue')), undefined);
});

// D7: the panel's opacity is Forge's PrecisionScrubber, not the one inside
// Tron's LayerBlendAndOpacity, so it keeps the 1 % step.
test('B-11 the opacity scrubber steps 1 % over 0..100 with the old detents', () => {
  assert.deepEqual(PRISM_OPACITY_SCRUBBER, { label: 'Layer opacity', min: 0, max: 100, step: 1, unit: '%', detents: [0, 25, 50, 75, 100] });
});

test('B-11 a mode commit is one setLayerBlend and an opacity commit is one setLayerOpacity', () => {
  assert.deepEqual(prismBlendCommand(doc, 7, { kind: 'mode', mode: 'screen' }), { op: 'setLayerBlend', payload: { id: 7, blend: 'screen' }, label: 'Layer blend mode changed' });
  // The scrubber commits percent; two presses of "−" from 100 land on 98.
  assert.deepEqual(prismBlendCommand([layer(3, 'normal', 1)], 3, { kind: 'opacity', percent: 98 }), { op: 'setLayerOpacity', payload: { id: 3, opacity: 0.98 }, label: 'Layer opacity changed' });
  // A layer whose blend Prism does not list can still change opacity, and leave that blend by a mode commit.
  assert.equal(prismBlendCommand(doc, 9, { kind: 'opacity', percent: 40 })?.op, 'setLayerOpacity');
  assert.equal(prismBlendCommand(doc, 9, { kind: 'mode', mode: 'normal' })?.op, 'setLayerBlend');
  // An unchanged value is no engine call and so no undo step.
  assert.equal(prismBlendCommand(doc, 7, { kind: 'mode', mode: 'multiply' }), undefined);
  assert.equal(prismBlendCommand(doc, 7, { kind: 'opacity', percent: 50 }), undefined);
});

test('B-11 unknown-mode, bad-opacity and stale-layer commits are refused before any engine call', () => {
  assert.throws(() => prismBlendCommand(doc, 7, { kind: 'mode', mode: 'hue' }), RangeError);
  assert.throws(() => prismBlendCommand(doc, 7, { kind: 'opacity', percent: 200 }), RangeError);
  assert.throws(() => prismBlendCommand(doc, 7, { kind: 'opacity', percent: Number.NaN }), RangeError);
  assert.throws(() => prismBlendCommand(doc, 99, { kind: 'mode', mode: 'screen' }), /No Prism layer/);
});
