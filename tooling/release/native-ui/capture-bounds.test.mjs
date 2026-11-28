import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { nativeCommandEvents, resultBounds, resultCaptureGeometry, resultCapturePlans } from './capture-bounds.mjs';
import { createFlow, createPickerFlow } from './flow.mjs';

const original = readFileSync(new URL('../test-fixtures/android-clipped-result-maestro.log', import.meta.url), 'utf8');
const selector = { id: 'f6-result', text: '^tally / Reject bad restore: PASS — malformed NFD1 rejected without changing the open document$' };
const plan = [{ name: 'f6-tally-bad-restore-rejected', selector }];
const viewport = { width: 320, height: 800 };
function command(label, body = '') {
  return '10:07:40.014 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: ' + label + ' RUNNING\n' +
    body + '\n10:07:40.182 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandFinished: ' + label + ' COMPLETED\n';
}
function bounds(x = 20, y = 400, width = 280, height = 50) {
  return 'DeviceWidth: 320, DeviceWidth: 800\nElement bounds: Bounds(x=' + x + ', y=' + y + ', width=' + width + ', height=' + height + ')';
}
function syntheticTrace({ geometry = bounds(), center = true, assertion = selector.text, between = '' } = {}) {
  return command('Scrolling DOWN until "' + selector.text + '", id: f6-result is visible with speed 40, visibility percentage 100%, timeout 30000 ms, with centering ' + (center ? 'enabled' : 'disabled'), geometry) +
    command('Assert that "' + assertion + '", id: f6-result is visible') + between +
    command('Take screenshot ' + plan[0].name);
}

test('all action PNGs require exact post-wait centered result assertions; picker-only frames remain separate', () => {
  assert.equal(resultCapturePlans(createFlow()).length, 42);
  assert.deepEqual(resultCapturePlans(createPickerFlow()), []);
  const altered = createFlow();
  const index = altered.commands.findIndex(command => command.takeScreenshot?.endsWith('-disk-save'));
  altered.commands[index - 2].scrollUntilVisible.centerElement = false;
  assert.throws(() => resultCapturePlans(altered));
});

test('actual native six-pixel clipping is rejected despite reported visibility1.0 and synthetic centering completion', () => {
  const events = nativeCommandEvents(original);
  assert.equal(events.length, 1);
  assert.ok(events[0].body.includes('height=6') && events[0].body.includes('Visibility Percent: 1.0'));
  assert.throws(() => resultBounds(events[0], viewport), /edge|clipped/);
  // Synthetic fallback uses the actual clipped rectangle; it is never a receipt.
  assert.throws(() => resultCaptureGeometry(syntheticTrace({ geometry: bounds(20, 794, 280, 6) }), plan, viewport), /edge|clipped/);
});

test('native capture binding requires a completed exact centered result, immediately followed by assertion and PNG', () => {
  const captures = resultCaptureGeometry(syntheticTrace(), plan, viewport);
  assert.equal(captures.length, 1);
  assert.deepEqual(captures[0].bounds, { x: 20, y: 400, width: 280, height: 50 });
  assert.throws(() => resultCaptureGeometry(syntheticTrace({ center: false }), plan, viewport), /centered/);
  assert.throws(() => resultCaptureGeometry(syntheticTrace({ assertion: 'PASS' }), plan, viewport), /exact native/);
  assert.throws(() => resultCaptureGeometry(syntheticTrace({ between: command('Scrolling UP until id: f6-selected is visible') }), plan, viewport), /centered|Intervening/);
  assert.throws(() => resultCaptureGeometry(syntheticTrace() + syntheticTrace(), plan, viewport), /Duplicate/);
  assert.throws(() => resultCaptureGeometry('', plan, viewport), /Missing/);
  assert.throws(() => resultCaptureGeometry(syntheticTrace().replaceAll('id: f6-result', 'id: f6-result-extra'), plan, viewport), /exact final/);
  assert.throws(() => resultCaptureGeometry(syntheticTrace().replaceAll(selector.text, selector.text + ' suffix'), plan, viewport), /exact final/);
});

test('final refreshed native geometry must match the actual viewport and avoid all clipped edges', () => {
  const oldThenFinal = bounds(20, 794, 280, 6) + '\n' + bounds();
  assert.equal(resultCaptureGeometry(syntheticTrace({ geometry: oldThenFinal }), plan, viewport).length, 1);
  assert.throws(() => resultCaptureGeometry(syntheticTrace({ geometry: bounds() + '\n' + bounds(20, 794, 280, 6) }), plan, viewport), /edge|clipped/);
  assert.throws(() => resultCaptureGeometry(syntheticTrace(), plan, { width: 321, height: 800 }), /viewport differs/);
  for (const geometry of [bounds(0, 400), bounds(20, 0), bounds(20, 400, 300), bounds(20, 400, 280, 400), bounds(20, 400, 280, 0), 'missing geometry']) {
    assert.throws(() => resultCaptureGeometry(syntheticTrace({ geometry }), plan, viewport));
  }
});
