import assert from 'node:assert/strict';
import test from 'node:test';
import { forgeMotionProfile, forgeHitTarget, planForgeOverlay } from './interaction-policy.ts';

const pane = { x: 0, y: 0, width: 1280, height: 800 };
const anchor = { x: 980, y: 120, width: 44, height: 44 };
const query = { kind: 'actions' as const, anchor, pane, desiredWidth: 260, desiredHeight: 200, input: 'pointer' as const };

test('all micro-interactions share a deliberate responsive contract', () => {
  const names = ['hover', 'press', 'selection', 'popover', 'panel-dock', 'detent', 'commit', 'cancel', 'error'] as const;
  for (const name of names) {
    const motion = forgeMotionProfile(name);
    const reduced = forgeMotionProfile(name, { reducedMotion: true });
    assert.ok(motion.durationMs >= 0 && motion.durationMs <= 200, 'motion over budget: ' + name);
    assert.equal(reduced.durationMs, 0);
    assert.equal(reduced.transformScale, 1);
    assert.equal(reduced.travelPx, 0);
    assert.equal(reduced.easing, 'instant');
    assert.equal(reduced.haptic, motion.haptic, 'reduced motion should retain optional host feedback');
  }
  assert.equal(forgeMotionProfile('press', { highContrast: true }).transformScale, 1);
  assert.equal(forgeMotionProfile('detent').haptic, 'selection');
});

test('visual density never shrinks touch, pen or accessible hit targets', () => {
  for (const density of ['compact', 'comfortable', 'presentation'] as const) {
    for (const input of ['touch', 'pen', 'pointer', 'keyboard', 'accessibility', 'controller'] as const) {
      assert.ok(forgeHitTarget(input, density) >= 44);
    }
  }
  assert.equal(forgeHitTarget('touch', 'compact'), 48);
  assert.equal(forgeHitTarget('pointer', 'compact'), 44);
});

test('anchored popover stays inside usable pane and flips above near bottom', () => {
  const normal = planForgeOverlay(query);
  assert.equal(normal.presentation, 'anchored');
  if (normal.presentation !== 'anchored') throw Error('expected anchored popover');
  assert.equal(normal.side, 'below');
  assert.ok(normal.rect.x >= pane.x + 8);
  assert.ok(normal.rect.x + normal.rect.width <= pane.x + pane.width - 8);
  const nearBottom = planForgeOverlay({ ...query, anchor: { ...anchor, y: 740 } });
  assert.equal(nearBottom.presentation, 'anchored');
  if (nearBottom.presentation !== 'anchored') throw Error('expected anchored popover');
  assert.equal(nearBottom.side, 'above');
  assert.ok(nearBottom.rect.y + nearBottom.rect.height <= 740);
});

test('RTL anchoring stays within its measured usable pane', () => {
  const ltr = planForgeOverlay(query);
  const rtl = planForgeOverlay({ ...query, direction: 'rtl' });
  assert.equal(ltr.presentation, 'anchored');
  assert.equal(rtl.presentation, 'anchored');
  if (ltr.presentation !== 'anchored' || rtl.presentation !== 'anchored') return;
  assert.notEqual(ltr.rect.x, rtl.rect.x);
  assert.equal(rtl.rect.x, anchor.x);
});

test('compact palettes become source-owned sheets, not scaled desktop inspectors', () => {
  const phone = planForgeOverlay({
    ...query, kind: 'palette', pane: { x: 0, y: 0, width: 390, height: 780 },
    anchor: { x: 300, y: 80, width: 44, height: 44 },
    desiredWidth: 350, desiredHeight: 300,
  });
  assert.deepEqual({ mode: phone.presentation, reason: phone.presentation === 'sheet' ? phone.reason : '' }, { mode: 'sheet', reason: 'compact' });
  const actions = planForgeOverlay({
    ...query, pane: { x: 0, y: 0, width: 390, height: 780 },
    anchor: { x: 300, y: 80, width: 44, height: 44 },
    desiredWidth: 220, desiredHeight: 220,
  });
  assert.equal(actions.presentation, 'anchored', 'native menu remains anchored for compact actions');
});

test('foldable and software-keyboard occlusions cannot host invisible popovers', () => {
  const leftPane = { x: 0, y: 0, width: 480, height: 780 };
  const valid = planForgeOverlay({ ...query, pane: leftPane, anchor: { x: 425, y: 120, width: 44, height: 44 } });
  assert.equal(valid.presentation, 'anchored');
  if (valid.presentation === 'anchored') {
    assert.ok(valid.rect.x + valid.rect.width <= 472, 'popover must stay on same side of the hinge');
  }
  const crossing = planForgeOverlay({ ...query, pane: leftPane, anchor: { x: 462, y: 120, width: 44, height: 44 } });
  assert.equal(crossing.presentation, 'sheet');
  const keyboard = planForgeOverlay({
    ...query, kind: 'inspector', pane: { x: 0, y: 0, width: 800, height: 800 },
    anchor: { x: 680, y: 625, width: 44, height: 44 },
    keyboardHeight: 350,
  });
  assert.equal(keyboard.presentation, 'sheet');
});

test('large menus scroll within the available pane instead of falling offscreen', () => {
  const result = planForgeOverlay({ ...query, desiredHeight: 1000 });
  assert.equal(result.presentation, 'anchored');
  if (result.presentation === 'anchored') {
    assert.equal(result.scrollable, true);
    assert.ok(result.rect.y >= result.usable.y);
    assert.ok(result.rect.y + result.rect.height <= result.usable.y + result.usable.height);
  }
});

test('bad measured data cannot generate NaNs, negative surfaces or bogus coordinates', () => {
  assert.throws(() => planForgeOverlay({ ...query, desiredWidth: Number.NaN }), RangeError);
  assert.throws(() => planForgeOverlay({ ...query, pane: { ...pane, width: 0 } }), RangeError);
  assert.throws(() => planForgeOverlay({ ...query, anchor: { ...anchor, height: -1 } }), RangeError);
  assert.throws(() => planForgeOverlay({ ...query, keyboardHeight: -50 }), RangeError);
  assert.throws(() => planForgeOverlay({ ...query, insets: { left: Number.POSITIVE_INFINITY } }), RangeError);
});
