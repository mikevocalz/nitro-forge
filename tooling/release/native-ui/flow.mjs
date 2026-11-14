import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const APP_ID = 'dev.nitroforge.f6.consumer';
export const STUDIOS = Object.freeze(['prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill']);

// Verified against Maestro's primary command docs:
// https://docs.maestro.dev/reference/commands-available/scrolluntilvisible
// https://docs.maestro.dev/reference/commands-available/launchapp
// https://docs.maestro.dev/reference/commands-available/stopapp
// https://docs.maestro.dev/reference/commands-available/extendedwaituntil
// https://docs.maestro.dev/reference/commands-available/takescreenshot
// Generate ordinary YAML; no assumption that Maestro accepts a JSON document.
const ACTIONS = Object.freeze({
  create: ['f6-create', 'Open/create', kind => `${kind} initialized through its public adapter and real Nitro host`, 'open'],
  edit: ['f6-edit', 'Edit', () => 'typed engine mutation changed the document; fresh undo comparison recorded', 'open'],
  save: ['f6-save', 'Save to disk', null, 'open'],
  close: ['f6-close', 'Close', () => 'document closed and its host disposed', 'closed'],
  reopen: ['f6-reopen', 'Reopen from disk', () => 'new host/document restored disk bytes and exactly matched persisted state', 'open'],
  undo: ['f6-undo', 'Undo fresh edit', () => 'authoritative state exactly matches the state before the fresh edit', 'open'],
  redo: ['f6-redo', 'Redo', () => 'authoritative state exactly matches the committed edit', 'open'],
  badRestore: ['f6-bad-restore', 'Reject bad restore', () => 'malformed NFD1 rejected without changing the open document', 'open'],
});

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const scroll = (element, direction) => ({
  scrollUntilVisible: { element, direction, timeout: 30000, speed: 40, visibilityPercentage: 100 },
});
const selected = (kind, state) => ({
  id: 'f6-selected', text: `^Studio: ${kind} · Document: ${state}$`,
});
function prefix(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)) {
    throw new Error('Screenshot prefix must be a safe nonempty relative artifact path');
  }
  return value;
}
function startup(commands) {
  // Explicit false retains the generated documents on every launch. Default
  // stopApp:true restarts the process; never use a foreground-only launch here.
  commands.push({ launchApp: { clearState: false } });
  commands.push({ extendedWaitUntil: { visible: { id: 'f6-selected' }, timeout: 90000 } });
}
function selectStudio(commands, kind) {
  commands.push(scroll({ id: 'f6-studio' }, 'UP'));
  commands.push({ tapOn: { text: `^${kind}$`, enabled: true } });
  commands.push(scroll({ id: 'f6-selected' }, 'DOWN'));
  commands.push({ assertVisible: selected(kind, 'closed') });
}
function action(commands, kind, key, screenshot) {
  const [id, label, detail, state] = ACTIONS[key];
  const body = key === 'save'
    ? `[0-9]+ exact NFD1 bytes read back from file://[^\\n]+/forge-f6-${kind}\\.nfd; retained for app relaunch`
    : escapeRegex(detail(kind));
  const result = {
    id: 'f6-result',
    text: `^${escapeRegex(`${kind} / ${label}: PASS — `)}${body}$`,
  };
  // Every action starts above the controls at f6-selected. Match the stable
  // ID first so an old/running result cannot cause scrolling past the result.
  commands.push(scroll({ id }, 'DOWN'));
  commands.push({ tapOn: { id, enabled: true } });
  commands.push(scroll({ id: 'f6-result' }, 'DOWN'));
  commands.push({ extendedWaitUntil: { visible: result, timeout: 90000 } });
  commands.push({ assertVisible: result });
  if (key === 'save') {
    commands.push(scroll({ id: 'f6-file' }, 'DOWN'));
    commands.push({ assertVisible: { id: 'f6-file', text: `^file://[^\\n]+/forge-f6-${kind}\\.nfd$` } });
  }
  if (screenshot) {
    // AX can report a clipped six-pixel result as 100% visible. Wait for the
    // final text first, then center that exact result and reassert before PNG.
    commands.push({ scrollUntilVisible: { ...scroll(result, 'DOWN').scrollUntilVisible, centerElement: true } });
    commands.push({ assertVisible: result });
    commands.push({ takeScreenshot: screenshot });
  }
  commands.push(scroll({ id: 'f6-selected' }, 'UP'));
  commands.push({ assertVisible: selected(kind, state) });
}

/** One full visible seven-studio pass. This builds a flow, not a receipt.
 * The CI runner executes the same flow twice on the installed Release app. */
export function createFlow({ screenshotPrefix = 'f6' } = {}) {
  const shots = prefix(screenshotPrefix), commands = [];
  startup(commands);
  for (const kind of STUDIOS) {
    selectStudio(commands, kind);
    commands.push({ takeScreenshot: `${shots}-${kind}-picker` });
    action(commands, kind, 'create');
    action(commands, kind, 'edit');
    action(commands, kind, 'save', `${shots}-${kind}-disk-save`);
    action(commands, kind, 'close');
    action(commands, kind, 'reopen', `${shots}-${kind}-fresh-host-reopen`);
    action(commands, kind, 'edit'); // Restore resets history: make a NEW edit.
    action(commands, kind, 'undo', `${shots}-${kind}-undo-fresh-edit`);
    action(commands, kind, 'redo', `${shots}-${kind}-redo`);
    action(commands, kind, 'badRestore', `${shots}-${kind}-bad-restore-rejected`);
    action(commands, kind, 'close');
    commands.push({ stopApp: null }); // Real process stop, retaining app data.
    startup(commands);
    selectStudio(commands, kind); // Relaunch resets selection to Prism.
    action(commands, kind, 'reopen', `${shots}-${kind}-process-relaunch-persistence`);
    action(commands, kind, 'close');
  }
  // Leave the actual heading and closed final studio in view for the unchanged
  // host-side semantic identity audit; result centering changes scroll offset.
  commands.push(scroll({ text: '^Forge clean consumer$' }, 'UP'));
  commands.push({ assertVisible: { text: '^Forge clean consumer$' } });
  commands.push({ assertVisible: selected(STUDIOS.at(-1), 'closed') });
  return { config: { appId: APP_ID, name: 'Forge seven-studio durable document workflows' }, commands };
}

/** Optional separate picker capture for native AX/bounds inspection. */
export function createPickerFlow({ screenshotPrefix = 'f6' } = {}) {
  const shots = prefix(screenshotPrefix), commands = [];
  startup(commands);
  selectStudio(commands, 'prism');
  commands.push({ takeScreenshot: `${shots}-picker` });
  return { config: { appId: APP_ID, name: 'Forge native studio picker' }, commands };
}

function scalar(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  throw new Error('Unsupported YAML scalar');
}
function mapping(value, indentation) {
  const pad = ' '.repeat(indentation), lines = [];
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error('Invalid YAML key');
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      lines.push(`${pad}${key}:`, ...mapping(item, indentation + 2));
    } else lines.push(`${pad}${key}: ${scalar(item)}`);
  }
  return lines;
}
export function serializeFlow(flow) {
  const lines = [...mapping(flow.config, 0), '---'];
  for (const command of flow.commands) {
    const entries = Object.entries(command);
    if (entries.length !== 1) throw new Error('Expected one Maestro command per step');
    const [[name, value]] = entries;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error('Invalid Maestro command');
    if (value === null) lines.push(`- ${name}`);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`- ${name}:`, ...mapping(value, 4));
    } else lines.push(`- ${name}: ${scalar(value)}`);
  }
  return lines.join('\n') + '\n';
}
function writeFlow(output, flow) {
  const file = resolve(output);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeFlow(flow), { flag: 'wx' });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: {
    output: { type: 'string' },
    'picker-output': { type: 'string' },
    'screenshot-prefix': { type: 'string', default: 'f6' },
  } });
  if (!values.output) throw new Error('Usage: node flow.mjs --output <new.yaml> [--picker-output <new.yaml>] [--screenshot-prefix <safe-path>]');
  const options = { screenshotPrefix: values['screenshot-prefix'] };
  writeFlow(values.output, createFlow(options));
  if (values['picker-output']) writeFlow(values['picker-output'], createPickerFlow(options));
}

