import assert from 'node:assert/strict';

const base = process.env.STUDIO_PREVIEW_URL ?? 'http://127.0.0.1:4173';
async function call(op, ...args) {
  const response = await fetch(`${base}/api/engine`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, args }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result.data;
}

for (const [kind, mutation] of [
  ['prism', { op: 'addRasterLayer', payload: { name: 'Bridge test' } }],
  ['cadence', { op: 'setTempo', payload: { bpm: 123 } }],
  ['splice', { op: 'addTrack', payload: { kind: 'video' } }],
  ['folio', { op: 'rotatePage', payload: { page: 0, degrees: 90 } }],
  ['pitch', { op: 'addSlide', payload: { layout: 'title' } }],
  ['tally', { op: 'setCell', payload: { addr: 'A1', value: '=SUM(1,2,3)' } }],
  ['quill', { op: 'insertText', payload: { at: { block: 0, offset: 0 }, text: 'Bridge test' } }],
]) {
  const handle = await call('open', kind);
  try {
    await call('apply', handle, { op: 'new', payload: kind === 'prism' ? { width: 64, height: 64 } : kind === 'folio' ? { pages: 1 } : {} });
    const state = async () => (await call('apply', handle, { op: 'describe', payload: {} })).data;
    const before = await state();
    await call('apply', handle, mutation);
    const after = await state();
    assert.notDeepEqual(after, before);
    const bytes = await call('snapshot', handle);
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'NFD1');
    assert.equal(await call('undo', handle), true);
    assert.deepEqual(await state(), before);
    assert.equal(await call('redo', handle), true);
    assert.deepEqual(await state(), after);
    const reopened = await call('open', kind);
    try {
      await call('restore', reopened, bytes);
      assert.deepEqual((await call('apply', reopened, { op: 'describe', payload: {} })).data, after);
    } finally { await call('close', reopened); }
    console.log(`${kind}: mutation, undo/redo, snapshot/reopen passed`);
  } finally { await call('close', handle); }
}
for (const origin of [undefined, 'https://untrusted.example']) {
  const response = await fetch(`${base}/api/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ op: 'open', args: ['prism'] }),
  });
  assert.equal(response.status, 403);
}
assert.equal((await fetch(`${base}/api/engine`)).status, 403);
console.log('Cross-origin, missing-origin and GET requests rejected');

// Exercise the same Unicode-aware replacement plan as the writing surface.
const { textEdit, plainText } = await import('../../packages/studio-workspace/src/text-diff.ts');
for (const [before, after] of [
  ['Hello 🌍', 'Hello 👋'], ['first\nsecond', 'first second'],
  ['one', 'one\ntwo\nthree'], ['', '\n'], ['erase me', ''], ['tail', 'tail\n'],
]) {
  const handle = await call('open', 'quill');
  try {
    if (before) await call('apply', handle, { op: 'insertText', payload: { at: { block: 0, offset: 0 }, text: before } });
    const edit = textEdit(before, after);
    if (edit.remove) await call('apply', handle, { op: 'deleteRange', payload: { from: edit.from, to: edit.to } });
    if (edit.insert) await call('apply', handle, { op: 'insertText', payload: { at: edit.from, text: edit.insert } });
    assert.equal(plainText((await call('apply', handle, { op: 'describe' })).data), after);
  } finally { await call('close', handle); }
}
const essay = await call('open', 'quill');
const opened = await call('open', 'quill');
try {
  const text = 'An essay in its own space.\nA second paragraph with Unicode 👋.';
  await call('apply', essay, { op: 'insertText', payload: { at: { block: 0, offset: 0 }, text } });
  const exported = await call('apply', essay, { op: 'exportDocx' });
  await call('apply', opened, { op: 'importDocx', payload: { bytes_b64: exported.data.bytes_b64 } });
  assert.equal(plainText((await call('apply', opened, { op: 'describe' })).data), text);
  await call('apply', essay, { op: 'insertText', payload: { at: { block: 0, offset: 0 }, text: 'Original only: ' } });
  assert.equal(plainText((await call('apply', opened, { op: 'describe' })).data), text);
} finally { await call('close', essay); await call('close', opened); }
console.log('Essay Unicode/newline edits, Word import/export and independent documents passed');
