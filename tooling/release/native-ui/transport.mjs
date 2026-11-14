import assert from 'node:assert/strict';

// These are bounded diagnostics, never a reconnect, restart or action retry.
export function androidTransport(run, { adb, device, prefix, requireOnline }) {
  const options = suffix => ({ optional: true, timeout: 10000, log: prefix + '-' + suffix + '.log' });
  const state = run(adb, ['-s', device, 'get-state'], options('serial-state')).trim();
  run(adb, ['devices', '-l'], options('devices'));
  // No command arguments or environment values: retain process identity only.
  run('ps', ['-eo', 'pid,ppid,etime,comm'], options('host-processes'));
  run(adb, ['-s', device, 'shell', 'ps', '-A'], options('device-processes'));
  run(adb, ['-s', device, 'logcat', '-d', '-t', '200'], options('logcat'));
  if (requireOnline) assert.equal(state, 'device', 'Owned Android serial offline at CLI boundary; no action retry');
  return state;
}

export function observedCommand(command, observe) {
  observe('before', true);
  let failed = false;
  try { return command(); }
  catch (error) { failed = true; throw error; }
  finally {
    try { observe('after', !failed); }
    catch (error) { if (!failed) throw error; }
  }
}
