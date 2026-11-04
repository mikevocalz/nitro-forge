import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasPoint, hitCanvas, shapeDrag, shapeOutline, windowToPageRect, type CanvasDocument, type CanvasLayer } from './prism-canvas-model.ts';
const shape = (id: number, kind = 'rect'): CanvasLayer => ({ id, visible: true, opacity: 1, content: { type: 'shape', shape: { kind, x: 0, y: 0, w: 4, h: 4, fill: [1, 2, 3, 255] } } });
const doc = (layers: CanvasLayer[]): CanvasDocument => ({ width: 4, height: 4, layers });

test('selection matches topmost rect/ellipse pixel coverage, visibility and transparency', () => {
  const lower = shape(1), ellipse = shape(2, 'ellipse');
  assert.equal(hitCanvas(doc([lower, ellipse]), { x: 0, y: 0 })?.id, 1);
  assert.equal(hitCanvas(doc([lower, ellipse]), { x: 1, y: 1 })?.id, 2);
  for (const top of [{ ...ellipse, visible: false }, { ...ellipse, opacity: 0 }, { ...ellipse, content: { type: 'shape', shape: { ...ellipse.content.shape!, fill: [1, 2, 3, 0] } } }]) {
    assert.equal(hitCanvas(doc([lower, top]), { x: 1, y: 1 })?.id, 1);
  }
  for (const point of [{ x: -1, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }, { x: NaN, y: 0 }]) assert.equal(hitCanvas(doc([lower]), point), null);
});

test('raster alpha occludes shapes only at nontransparent pixels, across every base64 quartet offset', () => {
  const bytes = Buffer.alloc(64);
  for (let pixel = 0; pixel < 16; pixel++) bytes[pixel * 4 + 3] = pixel % 2 ? 255 : 0;
  const raster: CanvasLayer = { id: 3, visible: true, opacity: 1, content: { type: 'raster', pixels_b64: bytes.toString('base64') } };
  for (let pixel = 0; pixel < 16; pixel++) {
    assert.equal(hitCanvas(doc([shape(1), raster]), { x: pixel % 4, y: Math.floor(pixel / 4) })?.id, pixel % 2 ? 3 : 1);
  }
  assert.equal(hitCanvas(doc([shape(1), { ...raster, opacity: 0 }]), { x: 1, y: 0 })?.id, 1);
  assert.equal(hitCanvas(doc([shape(1), { ...raster, content: { type: 'raster', pixels_b64: '?' } }]), { x: 1, y: 0 }), null);
});

test('measured artboard offsets and scale convert movement, not the letterboxed host', () => {
  const document = doc([shape(1)]), viewport = { x: 100, y: 200, width: 200, height: 100 };
  assert.deepEqual(canvasPoint(document, viewport, { x: 150, y: 250 }), { x: 1, y: 2 });
  assert.deepEqual(shapeDrag(document, viewport, { x: 150, y: 250 }, { x: 200, y: 275 }), { dx: 1, dy: 1 });
  assert.equal(shapeDrag(document, viewport, { x: 150, y: 250 }, { x: 152, y: 251 }), null);
  assert.equal(canvasPoint(document, { ...viewport, width: 0 }, { x: 150, y: 250 }), null);
  assert.equal(shapeDrag(document, viewport, { x: 150, y: 250 }, { x: Infinity, y: 0 }), null);
});

test('selection outlines clip off-canvas geometry and never emit unbounded style coordinates', () => {
  const layer = shape(1), document = doc([layer]);
  assert.deepEqual(shapeOutline(document, 200, 100, layer, { dx: -2, dy: -1 }), { x: 0, y: 0, width: 100, height: 75 });
  assert.equal(shapeOutline(document, 200, 100, layer, { dx: 5, dy: 0 }), null);
  assert.equal(shapeOutline(document, 200, 100, { ...layer, visible: false }), null);
  assert.equal(shapeOutline(document, 200, 100, { ...layer, opacity: 0 }), null);
  assert.equal(shapeOutline(document, 200, 100, layer, { dx: Infinity, dy: 0 }), null);
});

test('web scroll offsets align page events with measured viewport rectangles', () => {
  const rect = windowToPageRect({ x: 100, y: 50, width: 200, height: 100 }, { x: 30, y: 500 })!;
  assert.deepEqual(rect, { x: 130, y: 550, width: 200, height: 100 });
  assert.deepEqual(canvasPoint(doc([shape(1)]), rect, { x: 180, y: 600 }), { x: 1, y: 2 });
  assert.equal(windowToPageRect(rect, { x: Infinity, y: 0 }), null);
});
