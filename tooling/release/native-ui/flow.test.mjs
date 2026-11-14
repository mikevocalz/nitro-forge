import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { APP_ID, STUDIOS, createFlow, createPickerFlow, serializeFlow } from './flow.mjs';

const fixture = fileURLToPath(new URL('../consumer-fixture/', import.meta.url));
const appSource = readFileSync(resolve(fixture, 'App.tsx'), 'utf8');
const probeSource = readFileSync(resolve(fixture, 'probes.ts'), 'utf8');
const fixtureConfig = JSON.parse(readFileSync(resolve(fixture, 'app.json'), 'utf8')).expo;
const results = commands => commands.filter(command => command.assertVisible?.id === 'f6-result').map(command => command.assertVisible);
const tapIds = commands => commands.filter(command => command.tapOn?.id).map(command => command.tapOn.id);
const EXPECTED_STUDIOS = ['prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'];

test('flow targets the actual native fixture and its seven public studios, without invented selectors', () => {
  assert.equal(APP_ID, fixtureConfig.ios.bundleIdentifier);
  assert.equal(APP_ID, fixtureConfig.android.package);
  assert.deepEqual(STUDIOS, EXPECTED_STUDIOS);
  for (const studio of EXPECTED_STUDIOS) {
    assert.ok(probeSource.includes(`case '${studio}':`), `Missing real typed probe for ${studio}`);
  }
  const serialized = serializeFlow(createFlow());
  const ids = [...serialized.matchAll(/id: "([^"]+)"/g)].map(match => match[1]);
  for (const id of new Set(ids)) assert.ok(appSource.includes(`testID="${id}"`), `Invented fixture ID ${id}`);
  for (const studio of EXPECTED_STUDIOS) {
    const taps = createFlow().commands.filter(command => command.tapOn?.text === `^${studio}$`);
    assert.equal(taps.length, 2, 'Select each actual text option before lifecycle and after process restart');
  }
  assert.ok(appSource.includes('label: value'));
  assert.ok(!serialized.includes('runScript') && !serialized.includes('evalScript') && !serialized.includes('openLink'));
});

test('each studio saves before fresh-host reopen, makes a NEW edit before undo, then reopens after process restart', () => {
  const commands = createFlow().commands;
  const expectedActions = [
    'f6-create', 'f6-edit', 'f6-save', 'f6-close', 'f6-reopen',
    'f6-edit', 'f6-undo', 'f6-redo', 'f6-bad-restore', 'f6-close',
    'f6-reopen', 'f6-close',
  ];
  assert.deepEqual(tapIds(commands), EXPECTED_STUDIOS.flatMap(() => expectedActions));
  const stops = commands.map((command, index) => command.stopApp === null ? index : -1).filter(index => index >= 0);
  assert.equal(stops.length, 7, 'Every studio must prove retained files across a stopped process');
  for (const [studioIndex, stopIndex] of stops.entries()) {
    assert.deepEqual(commands[stopIndex + 1], { launchApp: { clearState: false } });
    const previousStop = studioIndex === 0 ? 0 : stops[studioIndex - 1] + 1;
    const preceding = commands.slice(previousStop, stopIndex);
    assert.deepEqual(tapIds(preceding).slice(-10), expectedActions.slice(0, 10));
    const nextStop = stops[studioIndex + 1] ?? commands.length;
    const following = commands.slice(stopIndex + 1, nextStop);
    assert.deepEqual(tapIds(following).slice(0, 2), ['f6-reopen', 'f6-close']);
    assert.ok(following.some(command => command.tapOn?.text === `^${EXPECTED_STUDIOS[studioIndex]}$`));
  }
});

test('all launches retain documents and restart, never clear state/keychain or merely foreground', () => {
  const commands = createFlow().commands;
  const launches = commands.filter(command => command.launchApp);
  assert.equal(launches.length, 8);
  for (const command of launches) assert.deepEqual(command.launchApp, { clearState: false });
  assert.ok(!commands.some(command => 'clearState' in command || 'clearKeychain' in command));
});

test('every action is an enabled control touch followed by its scoped visible result and document-state assertion', () => {
  const commands = createFlow().commands;
  for (const [index, command] of commands.entries()) {
    if (!command.tapOn?.id) continue;
    assert.equal(command.tapOn.enabled, true);
    assert.deepEqual(commands[index - 1].scrollUntilVisible.element, { id: command.tapOn.id });
    assert.equal(commands[index - 1].scrollUntilVisible.direction, 'DOWN');
    assert.deepEqual(commands[index + 1].scrollUntilVisible.element, { id: 'f6-result' });
    const wait = commands[index + 2].extendedWaitUntil;
    assert.equal(wait.visible.id, 'f6-result');
    assert.ok(wait.timeout >= 30000 && wait.timeout <= 90000);
    assert.deepEqual(commands[index + 3].assertVisible, wait.visible);
    const nextTap = commands.findIndex((step, at) => at > index && (step.tapOn || step.stopApp === null));
    const remaining = commands.slice(index + 4, nextTap < 0 ? commands.length : nextTap);
    assert.ok(remaining.some(step => step.scrollUntilVisible?.element.id === 'f6-selected' && step.scrollUntilVisible.direction === 'UP'));
    const state = remaining.find(step => step.assertVisible?.id === 'f6-selected')?.assertVisible.text;
    assert.ok(state);
    assert.equal(state.endsWith(command.tapOn.id === 'f6-close' ? 'closed$' : 'open$'), true);
  }
});

test('result assertions reject wrong studios, wrong actions, failed results and generic PASS', () => {
  const selectors = results(createFlow().commands);
  assert.equal(selectors.length, 7 * 12 + 7 * 6, 'Keep all action assertions plus each centered action capture assertion');
  for (const selector of selectors) {
    assert.equal(selector.id, 'f6-result');
    assert.ok(selector.text.startsWith('^') && selector.text.endsWith('$'));
    const matcher = new RegExp(selector.text);
    assert.equal(matcher.test('PASS'), false);
    assert.equal(matcher.test('some earlier action: PASS'), false);
    assert.equal(matcher.test('prism / Edit: FAILED — failed'), false);
  }
  const edit = selectors.find(selector => selector.text.startsWith('^cadence / Edit:'));
  const line = 'cadence / Edit: PASS — typed engine mutation changed the document; fresh undo comparison recorded';
  assert.ok(appSource.includes("return 'typed engine mutation changed the document; fresh undo comparison recorded'"));
  assert.equal(new RegExp(edit.text).test(line), true);
  assert.equal(new RegExp(edit.text).test(line.replace('cadence', 'prism')), false);
  assert.equal(new RegExp(edit.text).test(line.replace('Edit:', 'Redo:')), false);
  assert.equal(new RegExp(edit.text).test(line.replace('PASS', 'FAILED')), false);
  assert.equal(new RegExp(edit.text).test('log: ' + line), false);
});

test('save asserts the exact generated native file URI separately for every studio', () => {
  const commands = createFlow().commands;
  const files = commands.filter(command => command.assertVisible?.id === 'f6-file').map(command => command.assertVisible);
  assert.equal(files.length, 7);
  for (const [index, selector] of files.entries()) {
    const studio = EXPECTED_STUDIOS[index];
    const matcher = new RegExp(selector.text);
    assert.equal(matcher.test(`file:///data/user/0/${APP_ID}/files/forge-f6-${studio}.nfd`), true);
    assert.equal(matcher.test(`file:///var/mobile/Documents/forge-f6-${studio}.nfd`), true);
    assert.equal(matcher.test(`file:///var/mobile/Documents/forge-f6-${studio}.nfd.bak`), false);
    assert.equal(matcher.test(`http://example.invalid/forge-f6-${studio}.nfd`), false);
    const save = results(commands).find(item => item.text.startsWith(`^${studio} / Save to disk:`));
    const line = `${studio} / Save to disk: PASS — 512 exact NFD1 bytes read back from file:///data/files/forge-f6-${studio}.nfd; retained for app relaunch`;
    assert.equal(new RegExp(save.text).test(line), true);
    assert.equal(new RegExp(save.text).test(line.replace('512 exact NFD1', 'not NFD1')), false);
  }
});

test('picker selection scrolls up to the real group and checks the matching closed studio', () => {
  const commands = createFlow().commands;
  for (const [index, command] of commands.entries()) {
    if (!command.tapOn?.text) continue;
    assert.deepEqual(commands[index - 1].scrollUntilVisible.element, { id: 'f6-studio' });
    assert.equal(commands[index - 1].scrollUntilVisible.direction, 'UP');
    assert.equal(commands[index + 1].scrollUntilVisible.element.id, 'f6-selected');
    assert.equal(commands[index + 2].assertVisible.id, 'f6-selected');
    const studio = command.tapOn.text.slice(1, -1);
    assert.equal(commands[index + 2].assertVisible.text, `^Studio: ${studio} · Document: closed$`);
  }
});

test('screenshots preserve picker, persisted-state and fresh-undo evidence for all studios without overwrites', () => {
  const commands = createFlow({ screenshotPrefix: 'pass-1/f6' }).commands;
  const screenshots = commands.filter(command => command.takeScreenshot).map(command => command.takeScreenshot);
  assert.equal(new Set(screenshots).size, screenshots.length);
  for (const studio of EXPECTED_STUDIOS) {
    for (const stage of ['picker', 'disk-save', 'fresh-host-reopen', 'undo-fresh-edit', 'redo', 'bad-restore-rejected', 'process-relaunch-persistence']) {
      assert.ok(screenshots.includes(`pass-1/f6-${studio}-${stage}`));
    }
  }
  for (const bad of ['', '../escape', '/absolute', 'x/../escape', '${OUTPUTDIR}', 'x\\escape']) {
    assert.throws(() => createFlow({ screenshotPrefix: bad }), /safe nonempty relative/);
  }
});

test('picker-only flow launches the real app and captures actual controls without touching engine actions', () => {
  const flow = createPickerFlow();
  assert.equal(flow.config.appId, APP_ID);
  assert.deepEqual(tapIds(flow.commands), []);
  assert.ok(flow.commands.some(command => command.tapOn?.text === '^prism$'));
  assert.equal(flow.commands.at(-1).takeScreenshot, 'f6-picker');
});

test('CLI writes ordinary two-document YAML with preserved selectors and refuses evidence overwrite', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-maestro-flow-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('./flow.mjs', import.meta.url));
  const output = resolve(root, 'flow.yaml'), picker = resolve(root, 'picker.yaml');
  const args = [script, '--output', output, '--picker-output', picker, '--screenshot-prefix', 'pass-1'];
  execFileSync(process.execPath, args);
  const yaml = readFileSync(output, 'utf8');
  assert.equal(yaml, serializeFlow(createFlow({ screenshotPrefix: 'pass-1' })));
  assert.ok(yaml.startsWith('appId: "dev.nitroforge.f6.consumer"\nname: '));
  assert.equal(yaml.split('\n---\n').length, 2);
  assert.ok(yaml.includes('- stopApp\n- launchApp:\n    clearState: false\n'));
  for (const line of yaml.split('\n').filter(line => /^\s+text: /.test(line))) {
    assert.equal(typeof JSON.parse(line.replace(/^\s+text: /, '')), 'string', 'JSON-quoted text is a valid YAML scalar without losing regex escapes');
  }
  assert.equal(readFileSync(picker, 'utf8'), serializeFlow(createPickerFlow({ screenshotPrefix: 'pass-1' })));
  assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }), /Command failed/);
});


test('each action PNG recenters the exact FINAL result after its wait and before capture', () => {
  const commands = createFlow().commands;
  let captures = 0;
  for (const [index, command] of commands.entries()) {
    if (!command.takeScreenshot || command.takeScreenshot.endsWith('-picker')) continue;
    const assertion = commands[index - 1].assertVisible;
    const centered = commands[index - 2].scrollUntilVisible;
    assert.equal(assertion?.id, 'f6-result');
    assert.deepEqual(centered.element, assertion);
    assert.equal(centered.centerElement, true);
    assert.equal(centered.visibilityPercentage, 100);
    const previousAction = commands.findLastIndex((step, at) => at < index && step.tapOn?.id);
    const finalWait = commands.findIndex((step, at) => at > previousAction && at < index && step.extendedWaitUntil?.visible.id === 'f6-result');
    assert.ok(finalWait > previousAction && finalWait < index - 2, 'Final result wait precedes capture centering');
    assert.deepEqual(commands[finalWait].extendedWaitUntil.visible, assertion);
    captures++;
  }
  assert.equal(captures, 42, 'Six result images for each of seven actual studios');
});

test('full pass restores the actual heading and closed final studio before host identity/file audits', () => {
  const commands = createFlow().commands;
  assert.deepEqual(commands.slice(-3), [
    { scrollUntilVisible: { element: { text: '^Forge clean consumer$' }, direction: 'UP', timeout: 30000, speed: 40, visibilityPercentage: 100 } },
    { assertVisible: { text: '^Forge clean consumer$' } },
    { assertVisible: { id: 'f6-selected', text: '^Studio: quill · Document: closed$' } },
  ]);
  assert.ok(appSource.includes('Forge clean consumer'));
  assert.deepEqual(tapIds(commands).slice(-2), ['f6-reopen', 'f6-close']);
  assert.equal(commands.filter(command => command.stopApp === null).length, 7);
});
