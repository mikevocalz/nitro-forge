import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardKey } from './keyboard-event.ts';

test('Escape cancellation recognizes native and browser keyboard events', () => {
  assert.equal(keyboardKey({ key: 'Escape' }), 'Escape');
  assert.equal(keyboardKey({ nativeEvent: { key: 'Escape' } }), 'Escape');
  assert.equal(keyboardKey({ nativeEvent: { key: 'Enter' } }), 'Enter');
  assert.equal(keyboardKey({}), undefined);
});
