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

test('phone artboard sits centred: equal margins on both sides of the screen', () => {
  for (const width of [320, 390, 430]) {
    const l = prismViewportLayout(width, 600, 1, false, false);
    const left = l.canvasLeft + (l.availableWidth - l.canvasWidth) / 2;
    const right = width - left - l.canvasWidth;
    assert.ok(Math.abs(left - right) < 1, `${width}px: ${left} left vs ${right} right`);
    assert.ok(l.canvasLeft >= 64, 'the artboard clears the tool rail');
  }
});

test('grown chrome at 200 % text moves the rail, panel and artboard below and beside what was measured', () => {
  const base = prismViewportLayout(390, 600, 1, false, false);
  const grown = prismViewportLayout(390, 600, 1, false, false, { toolbarBottom: 103, railRight: 76 });
  assert.equal(base.railTop, 76, '100 %: the rail keeps its drawn place');
  assert.ok(grown.railTop >= 103 + 8, 'the rail starts below the measured toolbar');
  assert.ok(grown.panelTop >= 103 + 8, 'the phone Layers panel starts below the toolbar');
  assert.ok(grown.canvasTop >= base.canvasTop + 43, 'the artboard moves down by the growth');
  assert.ok(grown.canvasLeft >= 76 + 12, 'the artboard clears the measured rail');
  const wide = prismViewportLayout(1388, 796, 1, true, false, { toolbarBottom: 80 });
  assert.equal(wide.panelTop, 12, 'a docked desktop panel stays at the top edge');
});
