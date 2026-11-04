import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurretHaptics, turretHapticCue, type AndroidHapticName, type HapticPort } from './turret-haptics.ts';
import { intersects, planPersonaPlacement, type DockRegion } from './persona-dock.ts';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const PANEL = { width: 196, height: 360 };

test('turret effects map to platform haptics', () => {
  assert.deepEqual(turretHapticCue('detent', 'ios'), { kind: 'ios-selection' });
  assert.deepEqual(turretHapticCue('end-stop', 'ios'), { kind: 'ios-impact', style: 'rigid' });
  assert.deepEqual(turretHapticCue('commit', 'ios'), { kind: 'ios-notification', type: 'success' });
  assert.deepEqual(turretHapticCue('cancel', 'ios'), { kind: 'ios-impact', style: 'light' });
  assert.deepEqual(turretHapticCue('detent', 'android'), { kind: 'android', primary: 'segment-tick', fallback: 'clock-tick' });
  assert.deepEqual(turretHapticCue('commit', 'android'), { kind: 'android', primary: 'confirm', fallback: 'virtual-key' });
  for (const effect of ['none', 'detent', 'end-stop', 'commit', 'cancel'] as const) assert.deepEqual(turretHapticCue(effect, 'web'), { kind: 'none' });
  assert.deepEqual(turretHapticCue('none', 'ios'), { kind: 'none' });
});

function recordingPort(rejecting: ReadonlySet<AndroidHapticName> = new Set()) {
  const calls: string[] = [];
  const port: HapticPort = {
    selection: async () => { calls.push('selection'); },
    impact: async style => { calls.push(`impact:${style}`); },
    notification: async type => { calls.push(`notification:${type}`); },
    android: async name => { calls.push(`android:${name}`); if (rejecting.has(name)) throw new Error('unsupported'); },
  };
  return { calls, port };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('android falls back to an API 1 constant when the primary is too new', async () => {
  const { calls, port } = recordingPort(new Set(['segment-tick']));
  createTurretHaptics(port, 'android')('detent');
  await settle();
  assert.deepEqual(calls, ['android:segment-tick', 'android:clock-tick']);
});

test('haptic failures never escape the handler', async () => {
  const { calls, port } = recordingPort(new Set(['clock-tick']));
  const play = createTurretHaptics(port, 'android');
  assert.doesNotThrow(() => play('cancel'));
  await settle();
  assert.deepEqual(calls, ['android:clock-tick']);
  const ios = recordingPort();
  createTurretHaptics(ios.port, 'ios')('none');
  await settle();
  assert.deepEqual(ios.calls, []);
});

test('no hinge: phones get a sheet, wide windows keep the inline panel', () => {
  assert.deepEqual(planPersonaPlacement({ window: { width: 390, height: 844 }, regions: [], insets: NO_INSETS, panel: PANEL }), { mode: 'sheet' });
  assert.deepEqual(planPersonaPlacement({ window: { width: 1024, height: 768 }, regions: [], insets: NO_INSETS, panel: PANEL }), { mode: 'inline' });
  // A non-separating fold (flat Pixel Fold) does not split panes.
  const flat: DockRegion = { kind: 'division', x: 420, y: 0, width: 0, height: 900, active: true, orientation: 'vertical', separating: false };
  assert.deepEqual(planPersonaPlacement({ window: { width: 840, height: 900 }, regions: [flat], insets: NO_INSETS, panel: PANEL }), { mode: 'inline' });
});

test('book posture docks in the trailing pane against the hinge, never across it', () => {
  // Surface Duo style: two 540 pt panes and a 34 pt hinge.
  const hinge: DockRegion = { kind: 'division', x: 540, y: 0, width: 34, height: 720, active: true, orientation: 'vertical', separating: true };
  const plan = planPersonaPlacement({ window: { width: 1114, height: 720 }, regions: [hinge], insets: { top: 24, right: 0, bottom: 16, left: 0 }, panel: PANEL });
  assert.equal(plan.mode, 'dock');
  if (plan.mode !== 'dock') return;
  assert.equal(plan.edge, 'leading');
  assert.equal(plan.rect.x, 574 + 12);
  assert.ok(!intersects(plan.rect, hinge));
  assert.ok(plan.rect.x >= plan.pane.x && plan.rect.x + plan.rect.width <= plan.pane.x + plan.pane.width);
  assert.ok(plan.rect.y + plan.rect.height <= 720 - 16);
});

test('RTL docks in the leading pane, flush to the hinge', () => {
  const hinge: DockRegion = { kind: 'division', x: 540, y: 0, width: 34, height: 720, active: true };
  const plan = planPersonaPlacement({ window: { width: 1114, height: 720 }, regions: [hinge], insets: NO_INSETS, panel: PANEL, direction: 'rtl' });
  assert.equal(plan.mode, 'dock');
  if (plan.mode !== 'dock') return;
  assert.equal(plan.rect.x + plan.rect.width, 540 - 12);
  assert.ok(!intersects(plan.rect, hinge));
});

test('a pane too narrow for the panel uses the other pane, then a sheet', () => {
  const narrowTrailing: DockRegion = { kind: 'division', x: 800, y: 0, width: 20, height: 700, active: true };
  const plan = planPersonaPlacement({ window: { width: 900, height: 700 }, regions: [narrowTrailing], insets: NO_INSETS, panel: PANEL });
  assert.equal(plan.mode, 'dock');
  if (plan.mode === 'dock') { assert.equal(plan.edge, 'trailing'); assert.ok(plan.rect.x + plan.rect.width <= 800); }
  const both: DockRegion = { kind: 'division', x: 150, y: 0, width: 20, height: 700, active: true };
  assert.deepEqual(planPersonaPlacement({ window: { width: 320, height: 700 }, regions: [both], insets: NO_INSETS, panel: PANEL }), { mode: 'sheet' });
});

test('tabletop docks in the lower pane at the hinge edge', () => {
  const hinge: DockRegion = { kind: 'division', x: 0, y: 440, width: 840, height: 0, active: true, orientation: 'horizontal', separating: true };
  const plan = planPersonaPlacement({ window: { width: 840, height: 900 }, regions: [hinge], insets: NO_INSETS, panel: PANEL });
  assert.equal(plan.mode, 'dock');
  if (plan.mode !== 'dock') return;
  assert.equal(plan.edge, 'top');
  assert.equal(plan.rect.y, 452);
  assert.ok(plan.rect.y >= hinge.y + hinge.height);
  assert.ok(plan.rect.y + plan.rect.height <= 900);
});

test('inactive or occlusion regions are ignored', () => {
  const occlusion: DockRegion = { kind: 'occlusion', x: 160, y: 0, width: 70, height: 30, active: true };
  const inactive: DockRegion = { kind: 'division', x: 540, y: 0, width: 34, height: 720, active: false };
  assert.deepEqual(planPersonaPlacement({ window: { width: 390, height: 844 }, regions: [occlusion, inactive], insets: NO_INSETS, panel: PANEL }), { mode: 'sheet' });
});
