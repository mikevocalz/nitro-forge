import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_TRANSFORMS, shapeTransformPayload } from './prism-transform.ts';

test('shape actions issue independent relative commands, preserving engine-owned geometry', () => {
  assert.equal(new Set(SHAPE_TRANSFORMS.map(item => item.id)).size, SHAPE_TRANSFORMS.length);
  assert.deepEqual(shapeTransformPayload(7, 'left'), { id: 7, dx: -1, dy: 0, scale_x: 1, scale_y: 1 });
  assert.deepEqual(shapeTransformPayload(9, 'down-fast'), { id: 9, dx: 0, dy: 10, scale_x: 1, scale_y: 1 });
  assert.deepEqual(shapeTransformPayload(3, 'grow'), { id: 3, dx: 0, dy: 0, scale_x: 1.1, scale_y: 1.1 });
  assert.deepEqual(shapeTransformPayload(3, 'shrink'), { id: 3, dx: 0, dy: 0, scale_x: .9, scale_y: .9 });
  const first = shapeTransformPayload(3, 'grow')!;
  first.scale_x = 1;
  assert.equal(shapeTransformPayload(3, 'grow')?.scale_x, 1.1);
});

test('unknown actions and invalid selection IDs do not create transform commands', () => {
  assert.equal(shapeTransformPayload(1, 'rotate'), null);
  for (const id of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(shapeTransformPayload(id, 'left'), null);
  }
});
