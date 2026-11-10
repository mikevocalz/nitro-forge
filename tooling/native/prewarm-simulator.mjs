import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const output = process.env.FORGE_ACCEPTANCE_OUTPUT;
if (!output || !process.env.GITHUB_ENV) throw new Error('Prewarm requires the CI evidence directory and GITHUB_ENV');
mkdirSync(output, { recursive: true });
const report = { revision: process.env.GITHUB_SHA, commands: [] };
function run(args) {
  const result = spawnSync('xcrun', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  report.commands.push({ command: ['xcrun', ...args], status: result.status,
    stdout: result.stdout?.slice(-20000), stderr: result.stderr?.slice(-4000), error: result.error?.message });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? 'simctl failed');
  return result.stdout;
}
try {
  const available = JSON.parse(run(['simctl', 'list', 'devices', 'available', '--json']));
  const devices = Object.entries(available.devices)
    .filter(([runtime]) => runtime.includes('.iOS-'))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
    .flatMap(([runtime, devices]) => devices.map(device => ({ ...device, runtime })))
    .filter(device => device.isAvailable && device.name.startsWith('iPhone'));
  const preferred = process.env.FORGE_IOS_UDID;
  const selected = preferred ? devices.find(device => device.udid === preferred)
    : devices.find(device => device.state === 'Booted') ?? devices[0];
  if (!selected) throw new Error('No matching available iPhone simulator');
  report.selected = selected;
  if (selected.state !== 'Booted') run(['simctl', 'boot', selected.udid]);
  // Boot continues while Rust/Xcode compile. The runtime gate waits for the
  // same UDID and still fails if boot or installation never completes.
  appendFileSync(process.env.GITHUB_ENV, `FORGE_IOS_UDID=${selected.udid}\n`);
  report.status = 'boot-started';
  console.info(`Prewarming ${selected.name} (${selected.runtime}); runtime checks will wait for this exact device.`);
} catch (error) {
  report.status = 'failed';
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
  console.error(error.message);
} finally {
  writeFileSync(join(output, 'simulator-prewarm.json'), JSON.stringify(report, null, 2) + '\n');
}
