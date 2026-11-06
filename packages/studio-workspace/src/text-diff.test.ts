import assert from 'node:assert/strict';
import test from 'node:test';
import { plainText, textEdit, textPosition } from './text-diff.ts';

test('Unicode edits retain codepoint positions and unchanged prefix/suffix', () => {
  assert.deepEqual(textEdit('A😀z', 'A🦊z'), { from: { block: 0, offset: 1 }, to: { block: 0, offset: 2 }, remove: true, insert: '🦊' });
  assert.deepEqual(textEdit('é文', 'é文!'), { from: { block: 0, offset: 2 }, to: { block: 0, offset: 2 }, remove: false, insert: '!' });
});
test('newline boundaries map to block ends and following block starts', () => {
  assert.deepEqual(textPosition('one\n😀two\n', 3), { block: 0, offset: 3 });
  assert.deepEqual(textPosition('one\n😀two\n', 4), { block: 1, offset: 0 });
  assert.deepEqual(textEdit('one\ntwo', 'onetwo'), { from: { block: 0, offset: 3 }, to: { block: 1, offset: 0 }, remove: true, insert: '' });
  assert.deepEqual(textEdit('', '\n'), { from: { block: 0, offset: 0 }, to: { block: 0, offset: 0 }, remove: false, insert: '\n' });
});
test('extracts rich runs without losing block boundaries', () => {
  assert.equal(plainText({ blocks: [{ inlines: [{ text: 'Essay' }, { text: ' title' }] }, { inlines: [] }, { inlines: [{ text: 'Body😀' }] }] }), 'Essay title\n\nBody😀');
  assert.equal(plainText(null), '');
});
