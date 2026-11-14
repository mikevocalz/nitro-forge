import assert from 'node:assert/strict';

// Pinned Maestro 2.12.1 native trace, not application/store inspection.
// AX may already clip a rectangle to the viewport: 6px can report 100% visible.
export function nativeCommandEvents(log) {
  const events = [];
  let active;
  for (const line of log.split(/\r?\n/)) {
    const start = line.indexOf('CliConsoleListener.onCommandStart: ');
    const finish = line.indexOf('CliConsoleListener.onCommandFinished: ');
    if (start >= 0) {
      assert.ok(!active, 'Ambiguous overlapping native command');
      const text = line.slice(start + 'CliConsoleListener.onCommandStart: '.length);
      assert.ok(text.endsWith(' RUNNING'), 'Missing native command start status');
      active = { label: text.slice(0, -' RUNNING'.length), startedAt: line.split(' ')[0], body: [] };
    } else if (finish >= 0) {
      assert.ok(active, 'Native command completion without a start');
      const text = line.slice(finish + 'CliConsoleListener.onCommandFinished: '.length);
      assert.equal(text, active.label + ' COMPLETED', 'Native command failed, skipped or ambiguously attributed');
      events.push({ ...active, finishedAt: line.split(' ')[0], body: active.body.join('\n') });
      active = undefined;
    } else if (active) active.body.push(line);
  }
  assert.ok(!active, 'Unfinished native command');
  return events;
}

export function resultCapturePlans(definition) {
  const plans = [];
  for (const [index, command] of definition.commands.entries()) {
    if (!command.takeScreenshot) continue;
    const assertion = definition.commands[index - 1]?.assertVisible;
    if (assertion?.id === 'f6-selected') {
      assert.ok(command.takeScreenshot.endsWith('-picker'), 'Only a picker may omit result capture bounds');
      continue;
    }
    const centered = definition.commands[index - 2]?.scrollUntilVisible;
    assert.equal(assertion?.id, 'f6-result', 'Action PNG must follow its exact final result assertion');
    assert.deepEqual(centered?.element, assertion, 'Capture must center the same final result');
    assert.equal(centered.centerElement, true);
    assert.equal(centered.visibilityPercentage, 100);
    assert.ok(!plans.some(plan => plan.name === command.takeScreenshot), 'Duplicate planned action PNG');
    plans.push({ name: command.takeScreenshot, selector: assertion });
  }
  return plans;
}

export function resultBounds(event, viewport) {
  const views = [...event.body.matchAll(/DeviceWidth:\s*(\d+),\s*DeviceWidth:\s*(\d+)/g)];
  const bounds = [...event.body.matchAll(/Element bounds: Bounds\(x=(-?\d+(?:\.\d+)?), y=(-?\d+(?:\.\d+)?), width=(-?\d+(?:\.\d+)?), height=(-?\d+(?:\.\d+)?)\)/g)];
  assert.ok(views.length && views.length === bounds.length, 'Missing or ambiguous final native bounds/viewport');
  const [width, height] = views.at(-1).slice(1).map(Number);
  assert.deepEqual({ width, height }, viewport, 'Native trace viewport differs from actual picker geometry');
  const [x, y, w, h] = bounds.at(-1).slice(1).map(Number);
  assert.ok(w > 0 && h > 0 && x > 0 && y > 0 && x + w < width && y + h < height,
    'Result touches a viewport edge or is clipped/empty; screenshot is not acceptable visible evidence');
  return { x, y, width: w, height: h };
}

export function resultCaptureGeometry(log, plans, viewport) {
  const events = nativeCommandEvents(log), byName = new Map(plans.map(plan => [plan.name, plan])), captures = [];
  assert.equal(byName.size, plans.length, 'Ambiguous capture plan');
  for (const [index, event] of events.entries()) {
    if (!event.label.startsWith('Take screenshot ')) continue;
    const name = event.label.slice('Take screenshot '.length), plan = byName.get(name);
    if (!plan) { assert.ok(name.endsWith('-picker'), 'Unplanned native action screenshot'); continue; }
    assert.ok(!captures.some(capture => capture.name === name), 'Duplicate executed native action screenshot');
    const centered = events[index - 2], assertion = events[index - 1];
    assert.ok(centered?.label.startsWith('Scrolling DOWN until ') &&
      centered.label.includes('id: f6-result') && centered.label.includes('with centering enabled') &&
      centered.label.includes(plan.selector.text), 'Action PNG lacks its exact final centered native result');
    assert.ok(assertion?.label.startsWith('Assert that ') && assertion.label.includes('id: f6-result') &&
      assertion.label.includes(plan.selector.text), 'Intervening command or missing exact native result assertion');
    captures.push({ name, viewport, bounds: resultBounds(centered, viewport),
      nativeLogCommandIndex: index, centeredAt: centered.finishedAt, assertedAt: assertion.finishedAt,
      capturedAt: event.finishedAt,
      scope: 'Logged AX placement immediately before original PNG; independent visual readability review remains required' });
  }
  assert.equal(captures.length, plans.length, 'Missing executed native action captures');
  return captures;
}
