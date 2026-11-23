import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerBlendProblem, validateLayerBlend } from '@nyc-tron/ui/components/forge/layers/layer-blend-model';
import { PRISM_ALPHA_MODES, PRISM_BLEND_MODE_IDS, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, prismBlendCommand, prismLayerBlendValue } from './prism-blend.ts';
import type { PrismLayer } from './prism-layers.ts';

const layer = (id: number, blend?: string): PrismLayer => ({ id, name: `Layer ${id}`, visible: true, opacity: 0.5, ...(blend === undefined ? {} : { blend }), content: { type: 'raster', pixels_b64: '' } });
const doc = [layer(3, 'normal'), layer(7, 'multiply')];

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

test('B-11 a layer without a blend field reads as normal; an unknown one has no value', () => {
  assert.equal(prismLayerBlendValue(layer(1))?.mode, 'normal');
  assert.equal(prismLayerBlendValue(layer(1, 'hue')), undefined);
});

test('B-11 a mode commit is one setLayerBlend and an opacity commit is one setLayerOpacity', () => {
  const value = prismLayerBlendValue(doc[1]!)!;
  assert.deepEqual(prismBlendCommand(doc, 7, { ...value, mode: 'screen' }, 'mode'), { op: 'setLayerBlend', payload: { id: 7, blend: 'screen' }, label: 'Layer blend mode changed' });
  assert.deepEqual(prismBlendCommand(doc, 7, { ...value, opacity: 0.25 }, 'opacity'), { op: 'setLayerOpacity', payload: { id: 7, opacity: 0.25 }, label: 'Layer opacity changed' });
  // An unchanged value is no engine call and so no undo step.
  assert.equal(prismBlendCommand(doc, 7, value, 'mode'), undefined);
  assert.equal(prismBlendCommand(doc, 7, value, 'opacity'), undefined);
});

test('B-11 alpha, space, unknown-mode, bad-opacity and stale-layer commits are refused before any engine call', () => {
  const value = prismLayerBlendValue(doc[1]!)!;
  assert.throws(() => prismBlendCommand(doc, 7, { ...value, alphaMode: 'premultiplied' }, 'alpha'), /straight alpha only/);
  assert.throws(() => prismBlendCommand(doc, 7, { ...value, spaceId: 'linear' }, 'space'), /one compositing space/);
  assert.throws(() => prismBlendCommand(doc, 7, { ...value, mode: 'hue' }, 'mode'), RangeError);
  assert.throws(() => prismBlendCommand(doc, 7, { ...value, opacity: 2 }, 'opacity'), RangeError);
  assert.throws(() => prismBlendCommand(doc, 99, { ...value, mode: 'screen' }, 'mode'), /No Prism layer/);
});
