import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SurfaceAdmission, performSurfaceWrite } from './surface-admission.ts';

test('a sheet switch closes admission until fresh binding and cells settle', () => {
  const gate = new SurfaceAdmission(), doc = {}, source = {}, window = {};
  gate.update(doc, source, window);
  const initial = gate.beginRead()!;
  assert.equal(gate.acceptRead(initial), true);
  const sheetSwitch = gate.admitWrite(initial);
  assert.throws(() => gate.admitWrite(initial)); // rapid old-grid callback
  const changed = {};
  gate.update(doc, changed, window);
  assert.equal(gate.beginRead(), null); // setActive is still in flight
  gate.finishWrite(sheetSwitch);
  assert.throws(() => gate.admitWrite(initial));
  const refreshed = gate.beginRead()!;
  assert.equal(gate.ready, false);
  assert.equal(gate.acceptRead(initial), false);
  assert.equal(gate.acceptRead(refreshed), true);
  assert.doesNotThrow(() => gate.admitWrite(refreshed));
});

test('failed reads and writes cannot report a stale generation ready', () => {
  const gate = new SurfaceAdmission(), doc = {}, source = {};
  gate.update(doc, source, null);
  const first = gate.beginRead()!;
  gate.acceptRead(first);
  const lease = gate.admitWrite(first);
  // Simulate a rejected engine commit; completion closes the lease but not readiness.
  gate.finishWrite(lease);
  assert.equal(gate.ready, false);
  assert.throws(() => gate.admitWrite(first));
  gate.beginRead(); // failed refresh never calls acceptRead
  assert.equal(gate.ready, false);
  assert.throws(() => gate.admitWrite(first));
});

test('document, viewport and host-busy changes reject captured callbacks', () => {
  const gate = new SurfaceAdmission(), doc = {}, source = {}, range = {};
  gate.update(doc, source, range);
  const first = gate.beginRead()!;
  gate.acceptRead(first);
  gate.update(doc, source, range, true);
  assert.throws(() => gate.admitWrite(first));
  gate.update(doc, source, range, false);
  const next = gate.beginRead()!;
  gate.acceptRead(next);
  gate.update({}, {}, range);
  assert.equal(gate.acceptRead(next), false);
  assert.throws(() => gate.admitWrite(next));
  const other = gate.beginRead()!;
  gate.acceptRead(other);
  gate.update(gate.capture().document, gate.capture().source, {});
  assert.throws(() => gate.admitWrite(other));
});


test('a rejected host commit stays rejected and never reopens readiness', async () => {
  const gate = new SurfaceAdmission();
  gate.update({}, {}, null);
  const read = gate.beginRead()!;
  gate.acceptRead(read);
  const engineError = new Error('Rejected engine operation');
  await assert.rejects(performSurfaceWrite(gate, read, async () => { throw engineError; }), error => error === engineError);
  assert.equal(gate.writing, false);
  assert.equal(gate.ready, false);
  let invoked = false;
  await assert.rejects(performSurfaceWrite(gate, read, async () => { invoked = true; }));
  assert.equal(invoked, false);
});
