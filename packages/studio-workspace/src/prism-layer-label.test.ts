import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRISM_LAYER_ICONS, PRISM_LAYER_LABELS, prismLayerKind, prismLayerLabel } from './prism-layer-label.ts';

const shape = (kind: string) => ({ content: { type: 'shape', shape: { kind, x: 0, y: 0, w: 1, h: 1, fill: [0, 0, 0, 255] } } });

test('layer rows name every kind in words, never the engine enum', () => {
  assert.equal(prismLayerLabel(shape('rect')), 'Rectangle');
  assert.equal(prismLayerLabel(shape('ellipse')), 'Ellipse');
  assert.equal(prismLayerLabel({ content: { type: 'raster', pixels_b64: '' } }), 'Raster');
  for (const label of Object.values(PRISM_LAYER_LABELS)) assert.match(label, /^[A-Z][a-z]+$/);
});

test('the shape enum the editor sends maps to the same names', () => {
  assert.equal(prismLayerLabel('rect'), 'Rectangle');
  assert.equal(prismLayerLabel('ellipse'), 'Ellipse');
});

test('an unknown shape kind reads as a rectangle and a missing content as raster', () => {
  assert.equal(prismLayerKind(shape('polygon')), 'rectangle');
  assert.equal(prismLayerKind({ content: undefined as never }), 'raster');
});

test('every kind has a label and an icon', () => {
  assert.deepEqual(Object.keys(PRISM_LAYER_LABELS).sort(), Object.keys(PRISM_LAYER_ICONS).sort());
});
