import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonFaultOffset, jsonProblem } from './json-problem.ts';

const parseError = (text: string) => { try { JSON.parse(text); } catch (e) { return e; } throw new Error(`${text} parsed`); };
const cut = '{"format":1,"label":"Poster","r';

test('a truncated file says where it ends and to paste all of it', () => {
  assert.equal(jsonProblem(cut, parseError(cut)), 'Ends early at character 31. Paste the whole file and try again.');
  assert.equal(jsonProblem('{', parseError('{')), 'Ends early at character 1. Paste the whole file and try again.');
  assert.equal(jsonProblem('[1,2  \n', parseError('[1,2  \n')), 'Ends early at character 4. Paste the whole file and try again.');
});

test('a stray character is named with its place', () => {
  assert.equal(jsonProblem('nope', parseError('nope')), 'Stops at character 2, at “o”. Paste the file exactly as exported and try again.');
  assert.equal(jsonProblem('{"a":}', parseError('{"a":}')), 'Stops at character 6, at “}”. Paste the file exactly as exported and try again.');
  const multi = '{\n  "format": 1,\n  "label": x\n}';
  assert.equal(jsonProblem(multi, parseError(multi)), 'Stops at line 3, character 12, at “x”. Paste the file exactly as exported and try again.');
});

test('the engine position wins; the scan covers engines that report none', () => {
  // Safari and Hermes messages carry no position.
  assert.equal(jsonProblem('{"a":1', new Error("JSON Parse error: Expected '}'")), 'Ends early at character 6. Paste the whole file and try again.');
  assert.equal(jsonProblem('{"a" 1}', new SyntaxError('JSON Parse error: Unexpected token: 1')), 'Stops at character 6, at “1”. Paste the file exactly as exported and try again.');
  assert.equal(jsonProblem('', parseError('')), 'The text is empty. Paste the whole file and try again.');
});

test('the scan agrees with JSON.parse on what is valid', () => {
  for (const ok of ['{}', '[]', '{"a":[1,-2.5e3,true,false,null,"\\u00e9\\n"]}', ' 0 ']) assert.equal(jsonFaultOffset(ok), -1, ok);
  for (const [bad, at] of [['{"a":01}', 6], ['[1,]', 3], ['"x\ny"', 2], ['{"a":1}x', 7], ['tru', 3]] as const) {
    assert.throws(() => JSON.parse(bad));
    assert.equal(jsonFaultOffset(bad), at, bad);
  }
});
