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

// Prism's stage uses this exact read-only composite plus these single-command
// layer edits. Assert real RGBA, including opacity/order, rather than UI-only state.
const artwork = await call('open', 'prism');
try {
  const apply = async (op, payload = {}) => (await call('apply', artwork, { op, payload })).data;
  const pixels = async () => {
    const frame = await apply('flatten');
    assert.equal(frame.width, 4); assert.equal(frame.height, 4);
    const rgba = Buffer.from(frame.pixels_b64, 'base64');
    assert.equal(rgba.length, 64);
    return rgba;
  };
  const pixel = (rgba, x, y) => [...rgba.subarray((y * 4 + x) * 4, (y * 4 + x + 1) * 4)];
  await apply('new', { width: 4, height: 4 });
  const background = (await apply('addRasterLayer', { name: 'Background' })).layer_id;
  await apply('fillLayer', { id: background, color: [20, 40, 60, 255] });
  assert.deepEqual(pixel(await pixels(), 0, 0), [20, 40, 60, 255]);
  const rect = (await apply('addShape', { name: 'Rectangle', shape: { kind: 'rect', x: 0, y: 0, w: 2, h: 2, fill: [220, 40, 60, 255] } })).layer_id;
  assert.deepEqual(pixel(await pixels(), 0, 0), [220, 40, 60, 255]);
  await apply('setLayerVisible', { id: rect, visible: false });
  assert.deepEqual(pixel(await pixels(), 0, 0), [20, 40, 60, 255]);
  await apply('setLayerVisible', { id: rect, visible: true });
  await apply('setLayerOpacity', { id: rect, opacity: .5 });
  assert.deepEqual(pixel(await pixels(), 0, 0), [120, 40, 60, 255]);
  const ellipse = (await apply('addShape', { name: 'Ellipse', shape: { kind: 'ellipse', x: 2, y: 2, w: 2, h: 2, fill: [20, 200, 60, 255] } })).layer_id;
  assert.deepEqual(pixel(await pixels(), 3, 3), [20, 200, 60, 255]);
  await apply('moveLayer', { id: ellipse, to_index: 0 });
  assert.deepEqual(pixel(await pixels(), 3, 3), [20, 40, 60, 255]);
  await apply('removeLayer', { id: rect });
  assert.deepEqual(pixel(await pixels(), 0, 0), [20, 40, 60, 255]);
  assert.equal(await call('undo', artwork), true);
  assert.deepEqual(pixel(await pixels(), 0, 0), [120, 40, 60, 255]);
  const original = await apply('getLayer', { id: rect });
  await apply('setShapeFill', { id: rect, color: [20, 240, 60, 255] });
  assert.deepEqual(pixel(await pixels(), 0, 0), [20, 140, 60, 255]);
  const recolored = await apply('getLayer', { id: rect });
  assert.deepEqual(recolored, { ...original, content: { ...original.content,
    shape: { ...original.content.shape, fill: [20, 240, 60, 255] } } });
  assert.equal(await call('undo', artwork), true);
  assert.deepEqual(await apply('getLayer', { id: rect }), original);
  assert.equal(await call('redo', artwork), true);
  assert.deepEqual(await apply('getLayer', { id: rect }), recolored);
  await apply('transformShape', { id: rect, dx: 1, dy: 1, scale_x: .5, scale_y: .5 });
  assert.deepEqual(pixel(await pixels(), 0, 0), [20, 40, 60, 255]);
  assert.deepEqual(pixel(await pixels(), 1, 1), [20, 140, 60, 255]);
  const transformed = await apply('getLayer', { id: rect });
  assert.deepEqual(transformed, { ...recolored, content: { ...recolored.content,
    shape: { ...recolored.content.shape, x: 1, y: 1, w: 1, h: 1 } } });
  assert.equal(await call('undo', artwork), true);
  assert.deepEqual(await apply('getLayer', { id: rect }), recolored);
  assert.equal(await call('redo', artwork), true);
  assert.deepEqual(await apply('getLayer', { id: rect }), transformed);
  // Drive the same gesture planner with the real engine document and command.
  const { createCanvasGesture } = await import('../../packages/studio-workspace/src/prism-canvas-model.ts');
  const dragDocument = await apply('describe');
  let selection = rect, dragCommits = 0, mutation;
  const gesture = createCanvasGesture({
    context: () => ({ document: dragDocument, width: 200, height: 200, disabled: false, selectedId: selection }),
    measure: async () => ({ x: 100, y: 200, width: 200, height: 200 }),
    select: id => { selection = id; }, preview: () => {},
    commit: (id, dx, dy) => { dragCommits++; mutation = apply('transformShape', { id, dx, dy, scale_x: 1, scale_y: 1 }); },
  });
  gesture.begin({ x: 160, y: 260 });
  await gesture.release({ x: 210, y: 260 });
  await mutation;
  assert.equal(dragCommits, 1);
  assert.deepEqual(pixel(await pixels(), 2, 1), [20, 140, 60, 255]);
  assert.equal(await call('undo', artwork), true);
  assert.deepEqual(await apply('describe'), dragDocument);
  assert.equal(await call('redo', artwork), true);
  const final = await pixels();
  const { encodeRgbaPng } = await import('../../packages/studio-workspace/src/rgba-png.ts');
  assert.deepEqual([...encodeRgbaPng(4, 4, final).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const saved = await call('snapshot', artwork);
  await apply('new', { width: 4, height: 4 });
  await call('restore', artwork, saved);
  assert.deepEqual(await pixels(), final);
} finally { await call('close', artwork); }
console.log('Prism real raster/rectangle/ellipse composite, visibility, opacity, order, remove/undo, existing-shape fill/transform/gesture/undo/redo, PNG and snapshot restore passed');
