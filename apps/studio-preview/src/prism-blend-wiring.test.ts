import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerBlendProblem, validateLayerBlend } from '@nyc-tron/ui/components/forge/layers/layer-blend-model';
import { PRISM_ALPHA_MODES, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, prismLayerBlendValue, prismLayerBlendWrite } from './prism-blend-wiring.ts';

const layer = { id: 7, opacity: 0.5, blend: 'multiply' as const };

test('B-11 the alpha catalog lists Straight only, and Tron rejects Premultiplied against it', () => {
  assert.deepEqual(PRISM_ALPHA_MODES.map(mode => mode.id), ['straight']);
  const value = prismLayerBlendValue(layer);
  assert.deepEqual(value, { mode: 'multiply', opacity: 0.5, spaceId: PRISM_BLEND_SPACES[0].id, alphaMode: 'straight' });
  validateLayerBlend(value, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, PRISM_ALPHA_MODES);
  assert.equal(layerBlendProblem(value, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, PRISM_ALPHA_MODES), undefined);
  assert.throws(() => validateLayerBlend({ ...value, alphaMode: 'premultiplied' }, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, PRISM_ALPHA_MODES), RangeError);
});

test('B-11 every Prism blend mode is offered in the one compositing space', () => {
  assert.equal(PRISM_BLEND_MODES.length, 13);
  assert.deepEqual(PRISM_BLEND_SPACES.map(space => space.modeIds), [PRISM_BLEND_MODES.map(mode => mode.id)]);
  assert.ok(PRISM_BLEND_MODES.every(mode => mode.unavailableReason === undefined));
});

test('B-11 a mode commit is one setLayerBlend and an opacity commit is one setLayerOpacity', async () => {
  const calls: unknown[][] = [];
  const doc = {
    setLayerBlend: async (...args: unknown[]) => { calls.push(['setLayerBlend', ...args]); return { data: { ok: true }, events: [] }; },
    setLayerOpacity: async (...args: unknown[]) => { calls.push(['setLayerOpacity', ...args]); return { data: { ok: true }, events: [] }; },
  } as never;
  const value = prismLayerBlendValue(layer);
  const mode = prismLayerBlendWrite(doc, layer.id, { ...value, mode: 'screen' }, 'mode');
  const opacity = prismLayerBlendWrite(doc, layer.id, { ...value, opacity: 0.25 }, 'opacity');
  assert.equal(calls.length, 0); // nothing is written until the surface runs the write
  await mode();
  await opacity();
  assert.deepEqual(calls, [['setLayerBlend', 7, 'screen'], ['setLayerOpacity', 7, 0.25]]);
});

test('B-11 alpha, space and unknown-mode commits are refused before any engine call', () => {
  let calls = 0;
  const doc = { setLayerBlend: async () => { calls++; }, setLayerOpacity: async () => { calls++; } } as never;
  const value = prismLayerBlendValue(layer);
  assert.throws(() => prismLayerBlendWrite(doc, layer.id, { ...value, alphaMode: 'premultiplied' }, 'alpha'), /straight alpha only/);
  assert.throws(() => prismLayerBlendWrite(doc, layer.id, { ...value, spaceId: 'linear' }, 'space'), /one compositing space/);
  assert.throws(() => prismLayerBlendWrite(doc, layer.id, { ...value, mode: 'hue' }, 'mode'), RangeError);
  assert.throws(() => prismLayerBlendWrite(doc, layer.id, { ...value, opacity: 2 }, 'opacity'), RangeError);
  assert.equal(calls, 0);
});
