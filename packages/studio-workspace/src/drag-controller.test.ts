import assert from 'node:assert/strict';
import test from 'node:test';
import { createDragController } from './drag-controller.ts';
test('preview only and one release commit are shared by dock and layer consumers', () => {
  for (const consumer of ['dock', 'layer']) {
    const calls: string[] = [];
    const controller = createDragController({ disabled: () => false, start: () => calls.push('start'), move: () => calls.push('preview'), commit: () => calls.push(consumer), cancel: () => calls.push('cancel') });
    controller.begin(); controller.move({ x: 1, y: 2 }); controller.move({ x: 3, y: 4 });
    assert.deepEqual(calls, ['start', 'preview', 'preview']);
    controller.release(); controller.release();
    assert.deepEqual(calls, ['start', 'preview', 'preview', consumer]);
  }
});
test('cancellation, termination, and becoming disabled never commit', () => {
  let disabled = false;
  let commits = 0, cancellations = 0;
  const controller = createDragController({ disabled: () => disabled, start() {}, move() {}, commit: () => commits++, cancel: () => cancellations++ });
  controller.begin(); controller.cancel(); controller.release();
  assert.equal(commits, 0); assert.equal(cancellations, 1);
  controller.begin(); disabled = true; controller.move({ x: 3, y: 4 }); controller.release();
  assert.equal(commits, 0); assert.equal(cancellations, 2);
  controller.begin(); controller.release(); assert.equal(commits, 0); assert.equal(cancellations, 2);
});
