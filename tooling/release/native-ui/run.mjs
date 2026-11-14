import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { files, hash, inside, json, requireDisk } from '../archive-files.mjs';
import { unpackArchive } from '../unpack-archive.mjs';
import { androidTransport, observedCommand } from './transport.mjs';
import { createFlow, createPickerFlow, serializeFlow } from './flow.mjs';
import { MAESTRO, parseHierarchy, requirePassedFlow, requireSemanticLabels } from './ui-evidence.mjs';
import { checkIosBootStatusFile, exactFlowScreenshot, iosRuntimeIdentity, iosSimulatorTemplate, newIosSimulatorId, pickerGeometry, savedDocuments, STUDIOS } from './proof.mjs';

const { values } = parseArgs({ options: { platform: { type: 'string' }, 'artifact-root': { type: 'string' }, source: { type: 'string' }, output: { type: 'string' } } });
assert.ok(['ios', 'android'].includes(values.platform));
assert.ok(values['artifact-root'] && values.output);
assert.match(values.source ?? '', /^[0-9a-f]{40}$/);
const platform = values.platform, artifacts = resolve(values['artifact-root']), output = resolve(values.output);
assert.ok(!existsSync(output), 'Native runtime output must be fresh');
requireDisk(artifacts, 1024 * 1024 * 1024);
mkdirSync(output, { recursive: true });
const record = json(resolve(artifacts, 'runtime-artifact.json')), appId = 'dev.nitroforge.f6.consumer';
const maestro = process.env.MAESTRO_BIN;
assert.ok(maestro && existsSync(maestro), 'Verified pinned Maestro binary required');
const env = { ...process.env, CI: '1', MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true', MAESTRO_DRIVER_STARTUP_TIMEOUT: '180000' };
let device, ownedSimulator, adb, app, iosContainer;
const stages = [];
let cliSequence = 0;
const execution = { runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  job: process.env.GITHUB_JOB ?? null, driverSourceCommit: values.source };
writeFileSync(resolve(output, 'execution.json'), JSON.stringify(execution, null, 2) + '\n');
function driver(args, options, label) {
  if (platform !== 'android') return run(maestro, args, options);
  const prefix = 'transport-' + (++cliSequence) + '-' + label;
  return observedCommand(() => run(maestro, args, options), (phase, requireOnline) =>
    androidTransport(run, { adb, device, prefix: prefix + '-' + phase, requireOnline }));
}
function iosHealth(label) {
  run('ps', ['-eo', 'pid,ppid,etime,comm'], { optional: true, timeout: 10000, log: label + '-host-processes.log' });
  run('sysctl', ['hw.memsize', 'hw.ncpu'], { optional: true, timeout: 10000, log: label + '-host-capacity.log' });
  run('vm_stat', [], { optional: true, timeout: 10000, log: label + '-host-memory.log' });
  run('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'], { optional: true, timeout: 10000, log: label + '-device-services.log' });
}

function run(file, args, { optional = false, timeout = 90000, log } = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now(), result = spawnSync(file, args, { env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  appendFileSync(resolve(output, 'commands.jsonl'), JSON.stringify({ startedAt, file, args, elapsedMs: Date.now() - started, status: result.status, error: result.error?.message }) + '\n');
  if (log) writeFileSync(inside(output, log), (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.error || result.status !== 0) {
    if (optional) return '';
    throw new Error(`${file} failed: ${result.error?.message ?? result.stderr?.slice(-4000) ?? result.status}`);
  }
  return result.stdout;
}
async function waitFor(check, label, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return; await new Promise(done => setTimeout(done, 1000)); }
  throw new Error(`Timed out waiting for ${label}`);
}
function screenshot(name) {
  const path = inside(output, `${name}.png`);
  if (platform === 'ios') run('xcrun', ['simctl', 'io', device, 'screenshot', path], { log: `${name}-screenshot.log` });
  else {
    run(adb, ['-s', device, 'shell', 'screencap', '-p', `/sdcard/forge-f6-${name}.png`]);
    run(adb, ['-s', device, 'pull', `/sdcard/forge-f6-${name}.png`, path], { log: `${name}-screenshot.log` });
  }
  return path;
}
function hierarchy(name) {
  const raw = driver(['--device', device, '--platform', platform, '--no-ansi', 'hierarchy', '--no-reinstall-driver'], { timeout: 240000, log: `${name}-hierarchy-command.log` }, 'hierarchy-' + name);
  const tree = parseHierarchy(raw);
  writeFileSync(inside(output, `${name}-hierarchy.json`), JSON.stringify(tree, null, 2) + '\n');
  return tree;
}
function flow(name, definition) {
  const directory = inside(output, name);
  mkdirSync(directory);
  const path = inside(directory, 'flow.yaml'), report = inside(directory, 'report.xml');
  writeFileSync(path, serializeFlow(definition));
  driver(['--device', device, '--platform', platform, '--no-ansi', 'test', '--no-reinstall-driver',
    '--format', 'junit', '--output', report, '--test-output-dir', inside(directory, 'artifacts'), '--debug-output', inside(directory, 'debug'), path],
  { timeout: 1200000, log: `${name}-maestro.log` }, 'flow-' + name);
  const passed = requirePassedFlow(readFileSync(report, 'utf8'));
  const images = files(directory).filter(file => file.endsWith('.png'));
  const expectedImages = definition.commands.filter(command => typeof command.takeScreenshot === 'string').map(command => `${command.takeScreenshot}.png`);
  assert.ok(expectedImages.length > 0, 'Planned native screenshots required');
  for (const image of expectedImages) assert.ok(images.some(file => file === image || file.endsWith(`/${image}`)), `Actual native screenshot missing: ${image}`);
  for (const image of images) assert.equal(readFileSync(inside(directory, image)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const result = { name, ...passed, flowSha256: hash(path), reportSha256: hash(report), screenshots: images.map(file => ({ path: `${name}/${file}`, sha256: hash(inside(directory, file)) })) };
  stages.push(result);
  return result;
}
function collectDocuments(name) {
  const directory = inside(output, `${name}-documents`);
  mkdirSync(directory);
  if (platform === 'ios') {
    iosContainer = run('xcrun', ['simctl', 'get_app_container', device, appId, 'data'], { log: `${name}-actual-app-container.log` }).trim();
    assert.ok(iosContainer.startsWith('/'), 'Actual simulator app sandbox required');
    for (const studio of STUDIOS) for (const suffix of ['nfd', 'expected.json']) {
      const filename = `forge-f6-${studio}.${suffix}`;
      copyFileSync(resolve(iosContainer, 'Documents', filename), resolve(directory, filename));
    }
  } else {
    for (const studio of STUDIOS) for (const suffix of ['nfd', 'expected.json']) {
      const filename = `forge-f6-${studio}.${suffix}`;
      run(adb, ['-s', device, 'pull', `/data/user/0/${appId}/files/${filename}`, resolve(directory, filename)], { log: `${name}-${filename}-pull.log` });
    }
  }
  const documents = savedDocuments(directory);
  writeFileSync(inside(directory, 'os-sandbox-receipt.json'), JSON.stringify({ platform, appId, device,
    sourceDirectory: platform === 'ios' ? resolve(iosContainer, 'Documents') : `/data/user/0/${appId}/files`,
    access: platform === 'ios' ? 'simctl actual installed app data container; filesystem read only' : 'Owned CI userdebug emulator root; adb pull only, no app state injection',
    documents,
  }, null, 2) + '\n');
  return documents;
}

try {
  assert.equal(record.sourceCommit, values.source);
  assert.equal(record.platform, platform);
  assert.equal(record.applicationId, appId);
  assert.equal(record.configuration, 'Release');
  assert.equal(record.nativeRuntime, 'NOT RUN');
  assert.equal(hash(inside(artifacts, record.archive)), record.sha256);
  assert.equal(hash(resolve(artifacts, 'candidate.json')), record.manifestSha256);
  assert.equal(hash(resolve(artifacts, 'pnpm-lock.yaml')), record.lockSha256);
  assert.equal(hash(resolve(artifacts, 'installed-packages.json')), record.installedPackagesSha256);
  assert.equal(hash(resolve(artifacts, 'pnpm-workspace.yaml')), record.workspaceSha256);
  assert.equal(hash(resolve(artifacts, 'pnpm-effective-config.json')), record.pnpmConfigSha256);
  const candidate = json(resolve(artifacts, 'candidate.json')), installed = json(resolve(artifacts, 'installed-packages.json'));
  assert.equal(candidate.sourceCommit, values.source);
  assert.equal(installed.sourceCommit, values.source);
  assert.equal(installed.manifestSha256, record.manifestSha256);
  assert.equal(installed.lockSha256, record.lockSha256);
  for (const [name, version] of Object.entries(candidate.runtime)) assert.equal(installed.packages.find(pkg => pkg.name === name)?.version, version, `Actual installed runtime differs: ${name}`);
  assert.deepEqual(installed.archives, candidate.archives.map(({ name, sha256 }) => ({ name, sha256 })));
  for (const file of ['runtime-artifact.json', 'candidate.json', 'installed-packages.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'pnpm-effective-config.json', 'forge-consumer-receipt.json']) copyFileSync(resolve(artifacts, file), resolve(output, file));
  assert.equal(run(maestro, ['--version'], { log: 'maestro-version.log' }).trim().split(/\r?\n/).at(-1), MAESTRO.version);
  if (platform === 'ios') {
    app = unpackArchive(inside(artifacts, record.archive), resolve(output, 'unpacked-app'), { prefix: record.applicationDirectory, sha256: record.sha256 });
    assert.equal(hash(resolve(app, 'main.jsbundle')), record.embeddedBundleSha256);
    const simulatorInventory = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json'], { log: 'simulators.log' }));
    const template = iosSimulatorTemplate(simulatorInventory);
    const templateDevice = Object.values(simulatorInventory.devices).flat().find(item => item.udid === template.udid);
    assert.ok(typeof templateDevice.dataPath === 'string' && templateDevice.dataPath.startsWith('/'), 'Actual simulator data volume required');
    requireDisk(resolve(templateDevice.dataPath, '../..'), 2 * 1024 * 1024 * 1024);
    run('xcrun', ['simctl', 'help', 'create'], { log: 'simctl-create-help.log' });
    const creationName = 'Forge F6 ' + values.source.slice(0, 7) + '-' + process.pid;
    device = newIosSimulatorId(simulatorInventory,
      run('xcrun', ['simctl', 'create', creationName, template.deviceTypeIdentifier, template.runtimeIdentifier], { log: 'simulator-create.log' }).trim());
    // Ownership is acquired only for a new OS UUID, never the template device.
    ownedSimulator = device;
    const createdInventory = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json'], { log: 'simulators-created.log' }));
    const identity = iosRuntimeIdentity(createdInventory, device);
    assert.equal(identity.runtimeIdentifier, template.runtimeIdentifier);
    assert.equal(identity.deviceTypeIdentifier, template.deviceTypeIdentifier);
    assert.equal(identity.name, creationName);
    const chosen = Object.values(createdInventory.devices).flat().find(item => item.udid === device);
    writeFileSync(resolve(output, 'chosen-simulator.json'), JSON.stringify({ ...chosen, createdByThisRun: true }, null, 2) + '\n');
    writeFileSync(resolve(output, 'actual-simulator-runtime.json'), JSON.stringify({ ...identity, createdByThisRun: true,
      inventorySha256: hash(resolve(output, 'simulators-created.log')), templateInventorySha256: hash(resolve(output, 'simulators.log')) }, null, 2) + '\n');
    if (chosen.state !== 'Booted') run('xcrun', ['simctl', 'boot', device], { log: 'simulator-boot.log' });
    run('xcrun', ['simctl', 'bootstatus', device, '-b'], { timeout: 420000, log: 'simulator-bootstatus.log' });
    checkIosBootStatusFile(inside(output, 'simulator-bootstatus.log'));
    iosHealth('before-install');
    // The retained cc77 OS log completed installation after the original 90s client budget.
    // Still require a successful command before launch; no retry or post-timeout continuation.
    run('xcrun', ['simctl', 'install', device, app], { timeout: 300000, log: 'install.log' });
  } else {
    assert.ok(process.env.ANDROID_HOME);
    adb = resolve(process.env.ANDROID_HOME, 'platform-tools/adb'); device = 'emulator-5554'; app = inside(artifacts, record.archive);
    await waitFor(() => run(adb, ['-s', device, 'shell', 'getprop', 'sys.boot_completed'], { optional: true, timeout: 10000 }).trim() === '1', 'owned CI Android emulator');
    // Google APIs userdebug image only: obtain read access to this fixture's
    // private OS files. No application state is seeded or modified this way.
    run(adb, ['-s', device, 'root'], { log: 'adb-root.log' });
    await waitFor(() => run(adb, ['-s', device, 'shell', 'id'], { optional: true, timeout: 10000 }).includes('uid=0'), 'root access for read-only fixture file receipts');
    run(adb, ['-s', device, 'shell', 'id'], { log: 'actual-android-read-access.log' });
    run(adb, ['-s', device, 'shell', 'wm', 'size', '320x800'], { log: 'viewport-size.log' });
    run(adb, ['-s', device, 'shell', 'wm', 'density', '160'], { log: 'viewport-density.log' });
    const sizes = run(adb, ['-s', device, 'shell', 'wm', 'size'], { log: 'actual-viewport-size.log' });
    const densities = run(adb, ['-s', device, 'shell', 'wm', 'density'], { log: 'actual-viewport-density.log' });
    assert.deepEqual([...sizes.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)].at(-1)?.slice(1), ['320', '800']);
    assert.equal([...densities.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)].at(-1)?.[1], '160');
    run(adb, ['-s', device, 'shell', 'getprop'], { log: 'actual-android-properties.log' });
    run(adb, ['-s', device, 'install', '-r', app], { timeout: 120000, log: 'install.log' });
  }
  const picker = flow('picker', createPickerFlow({ screenshotPrefix: 'picker' }));
  const tree = hierarchy('picker');
  requireSemanticLabels(tree, STUDIOS);
  let pickerImage;
  if (platform === 'ios') {
    // The executed XCTest step already captured the actual app display. Duo
    // exposes two simctl displays; never guess which display its AX describes.
    const captured = exactFlowScreenshot(picker, 'picker-picker.png');
    const source = inside(output, captured.path);
    assert.equal(hash(source), captured.sha256);
    pickerImage = inside(output, 'picker-native.png');
    copyFileSync(source, pickerImage);
    assert.equal(hash(pickerImage), captured.sha256, 'Actual native PNG must remain unmodified');
    writeFileSync(inside(output, 'picker-capture.json'), JSON.stringify({ tool: 'Pinned official Maestro XCTest screenshot from executed picker flow', originalPath: captured.path, sha256: captured.sha256 }, null, 2) + '\n');
  } else pickerImage = screenshot('picker-native');
  const geometry = pickerGeometry(tree, pickerImage, platform === 'android' ? 320 : undefined);
  for (const pass of [1, 2]) {
    flow(`pass-${pass}`, createFlow({ screenshotPrefix: 'f6' }));
    const tree = hierarchy(`pass-${pass}`);
    requireSemanticLabels(tree, ['Forge clean consumer', 'Studio: quill', 'Document: closed']);
    stages.at(-1).documents = collectDocuments(`pass-${pass}`);
  }
  assert.equal(stages[1].flowSha256, stages[2].flowSha256, 'Two unchanged complete native flows required');
  writeFileSync(resolve(output, 'runtime-proof.json'), JSON.stringify({ sourceCommit: values.source, execution, platform, appId, device,
    observedVia: platform === 'ios' ? 'Pinned official Maestro XCTest OS touches and native accessibility' : 'Pinned official Maestro Android OS touches and native accessibility',
    candidateManifestSha256: record.manifestSha256, installedPackagesSha256: record.installedPackagesSha256, lockSha256: record.lockSha256,
    applicationArchiveSha256: record.sha256, embeddedBundleSha256: record.embeddedBundleSha256,
    workspaceSha256: record.workspaceSha256, pnpmConfigSha256: record.pnpmConfigSha256, driver: MAESTRO, geometry, stages,
    nativeDurableWorkflows: 'PASS: two executed full seven-studio flows; OS sandbox NFD/expected files retained', independentVisualReview: 'PENDING',
    localArgent: 'NOT RUN; CI-hosted native drivers used', f6Gate: 'UNCHANGED; independent source, runtime and visual review still required',
  }, null, 2) + '\n');
} catch (error) {
  writeFileSync(resolve(output, 'failure.json'), JSON.stringify({ sourceCommit: values.source, execution, platform, appId, device, error: error.stack, completedStages: stages }, null, 2) + '\n');
  if (device) {
    if (platform === 'ios') { try { iosHealth('failure'); } catch { /* Preserve original failure. */ } }
    try { screenshot('failure'); } catch { /* Original failure remains authoritative. */ }
    try { hierarchy('failure'); } catch { /* Driver failure must not erase original evidence. */ }
  }
  throw error;
} finally {
  if (device && platform === 'android') {
    run(adb, ['-s', device, 'logcat', '-d', '-t', '3000'], { optional: true, log: 'logcat.log' });
    run(adb, ['-s', device, 'shell', 'am', 'force-stop', appId], { optional: true });
  }
  if (device && platform === 'ios') run('xcrun', ['simctl', 'spawn', device, 'log', 'show', '--last', '10m', '--style', 'compact', '--predicate', `eventMessage CONTAINS "${appId}"`], { optional: true, log: 'ios-app-system.log' });
  if (ownedSimulator) {
    run('xcrun', ['simctl', 'shutdown', ownedSimulator], { optional: true, log: 'owned-simulator-shutdown.log' });
    run('xcrun', ['simctl', 'delete', ownedSimulator], { optional: true, log: 'owned-simulator-delete.log' });
  }
}
