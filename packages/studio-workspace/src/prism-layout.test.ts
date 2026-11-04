import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prismViewportLayout } from './prism-layout.ts';

test('short landscape retains a useful artboard instead of the previous 26px result', () => {
  const layout = prismViewportLayout(844, 286, 1, true, false);
  assert.ok(layout.canvasWidth >= 140);
  assert.equal(layout.canvasWidth, layout.canvasHeight);
  assert.ok(layout.panelTop + layout.panelMaxHeight <= 286);
});

test('portrait, landscape and extreme document ratios fit both available dimensions', () => {
  for (const [width, height] of [[320, 420], [390, 563], [844, 286], [1024, 664], [1440, 796]]) {
    for (const ratio of [.1, 1, 10]) for (const open of [false, true]) {
      const layout = prismViewportLayout(width!, height!, ratio, open, false);
      assert.ok(layout.canvasWidth <= layout.availableWidth);
      assert.ok(layout.canvasHeight <= layout.availableHeight + 1e-8);
      assert.ok(Math.abs(layout.canvasWidth / layout.canvasHeight - ratio) < 1e-8);
      assert.ok(layout.panelTop + layout.panelMaxHeight <= height!);
    }
  }
});

test('short narrow shape/raster fill palette stays beside tools and inside its viewport', () => {
  const layout = prismViewportLayout(320, 244, 1, false, true);
  assert.ok(layout.fillLeft >= 76);
  assert.ok(layout.fillLeft + layout.fillWidth <= 308);
  assert.ok(layout.layerListMaxHeight >= 44);
});

test('invalid document aspect uses a finite square preview', () => {
  for (const ratio of [0, -1, NaN, Infinity]) {
    const layout = prismViewportLayout(390, 563, ratio, false, false);
    assert.equal(layout.canvasWidth, layout.canvasHeight);
  }
});


test('tablet Layers overlays preserve artboard size and placement while desktop reserves panel space', () => {
  for (const [width, height] of [[716, 920], [972, 664], [390, 563]]) {
    const closed = prismViewportLayout(width!, height!, 1, false, false);
    const opened = prismViewportLayout(width!, height!, 1, true, false);
    assert.equal(opened.dockedLayers, false);
    for (const key of ['canvasWidth', 'canvasHeight', 'canvasLeft', 'canvasRight', 'canvasTop', 'canvasBottom'] as const) {
      assert.equal(opened[key], closed[key], `${width}px: ${key} must not move when Layers opens`);
    }
  }
  const wide = prismViewportLayout(1388, 896, 1, true, false);
  assert.equal(wide.dockedLayers, true);
  assert.ok(wide.canvasRight > wide.panelWidth);
});
