import assert from 'node:assert/strict';
import test from 'node:test';
import { androidTransport, observedCommand } from './transport.mjs';

test('offline serial cannot be accepted because its ADB server remains reachable', () => {
  const logs = [];
  const run = (file, args, options) => {
    logs.push({ file, args, options });
    if (args.includes('get-state')) return 'offline\n';
    if (args[0] === 'devices') return 'List of devices attached\nemulator-5554 offline transport_id:1\n';
    return 'reachable host process\n';
  };
  assert.throws(() => androidTransport(run, { adb: '/sdk/adb', device: 'emulator-5554', prefix: 'probe', requireOnline: true }), /serial offline/);
  assert.equal(logs.length, 5);
  assert.ok(logs.every(entry => entry.options.timeout === 10000 && entry.options.optional));
  assert.ok(logs.every(entry => !entry.args.includes('kill-server') && !entry.args.includes('reconnect')));
});

test('CLI boundary diagnostics preserve an original driver failure without retrying it', () => {
  const original = new Error('host:transport:emulator-5554: device offline'), observations = [];
  let actions = 0;
  assert.throws(() => observedCommand(() => { actions++; throw original; }, (phase, required) => {
    observations.push([phase, required]);
    if (phase === 'after') throw new Error('subsequent diagnostic failure');
  }), error => error === original);
  assert.equal(actions, 1);
  assert.deepEqual(observations, [['before', true], ['after', false]]);
});

test('offline transition stops execution before a command or immediately after it', () => {
  let actions = 0;
  assert.throws(() => observedCommand(() => actions++, () => { throw new Error('offline before'); }), /offline before/);
  assert.equal(actions, 0);
  assert.throws(() => observedCommand(() => ++actions, phase => { if (phase === 'after') throw new Error('offline after'); }), /offline after/);
  assert.equal(actions, 1);
  assert.equal(observedCommand(() => 'actual result', () => {}), 'actual result');
});
