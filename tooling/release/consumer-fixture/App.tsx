import { useEffect, useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Button } from '@nyc-tron/ui/components/Button';
import { SegmentedControl } from '@nyc-tron/ui/components/SegmentedControl';
import { createNitroHost, type EngineHost } from './imports';
import { STUDIOS, describe, openProbe, type Probe, type Studio } from './probes';

type Screen = {
  studio: Studio;
  busy: boolean;
  open: boolean;
  result: string;
  current: string;
  beforeEdit: string | null;
  afterEdit: string | null;
  history: 'none' | 'edited' | 'undone';
  savedUri: string;
  log: string[];
};
type Resources = { host: EngineHost; probe: Probe };

// The acceptance fixture intentionally uses Tron's unstyled native API.
// No stylesheet, CSS source scan or Metro CSS input participates in rendering.
const actionStyle = { padding: 12, borderWidth: 1, borderColor: '#333', backgroundColor: '#fff' };

const initial: Screen = {
  studio: 'prism', busy: false, open: false, result: 'No native action has run.',
  current: '', beforeEdit: null, afterEdit: null, history: 'none', savedUri: '', log: [],
};
const snapshotFile = (kind: Studio) => new File(Paths.document, `forge-f6-${kind}.nfd`);
const expectedFile = (kind: Studio) => new File(Paths.document, `forge-f6-${kind}.expected.json`);
function requireEqual(actual: string, expected: string, action: string) {
  if (actual !== expected) throw new Error(`${action}: authoritative document state differs`);
}
function validateEnvelope(bytes: Uint8Array) {
  if (bytes.length < 4 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'NFD1') {
    throw new Error('Saved file is not an NFD1 envelope');
  }
}
async function dispose(resources: Resources) {
  try { await resources.probe.document.close(); }
  finally { await resources.host.dispose(); }
}

/** Visible acceptance controls for actual installed native packages.
 * Files are private generated fixtures, never arbitrary user documents.
 * This screen reports individual actions, not an F6 gate verdict. */
export default function App() {
  const storeRef = useRef<StoreApi<Screen> | null>(null);
  if (!storeRef.current) storeRef.current = createStore<Screen>(() => ({ ...initial, log: [] }));
  const store = storeRef.current;
  const screen = useStore(store, value => value);
  const resourcesRef = useRef<Resources | null>(null);
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // An in-flight open/edit owns its native resource until it settles.
      // Dispose afterwards rather than racing the worker or leaking a late open.
      void pendingRef.current.then(async () => {
        if (mountedRef.current) return;
        const resources = resourcesRef.current;
        resourcesRef.current = null;
        if (resources) await dispose(resources);
      }).catch(error => console.error('F6 native cleanup failed', error));
    };
  }, []);

  function run(label: string, action: () => Promise<string>) {
    if (!mountedRef.current || store.getState().busy) return;
    const scope = `${store.getState().studio} / ${label}`;
    store.setState({ busy: true, result: `${scope}: running` });
    pendingRef.current = (async () => {
      try {
        const detail = await action();
        if (mountedRef.current) {
          const result = `${scope}: PASS — ${detail}`;
          store.setState(state => ({ result, log: [...state.log, result].slice(-50) }));
        }
      } catch (error) {
        console.error('F6 native action failed', scope, error);
        if (mountedRef.current) {
          const result = `${scope}: FAILED — ${error instanceof Error ? error.message : String(error)}`;
          store.setState(state => ({ result, log: [...state.log, result].slice(-50) }));
        }
      } finally {
        if (mountedRef.current) store.setState({ busy: false });
      }
    })();
  }

  function active(): Resources {
    const resources = resourcesRef.current;
    if (!resources) throw new Error('Open or reopen a document first');
    return resources;
  }

  async function connect(kind: Studio, bytes?: Uint8Array, expected?: string) {
    if (resourcesRef.current) throw new Error('Close the current document first');
    const host = createNitroHost();
    let probe: Probe | undefined;
    try {
      probe = await openProbe(kind, host, bytes);
      const current = await describe(probe);
      if (expected !== undefined) requireEqual(current, expected, 'Reopen from disk');
      if (!mountedRef.current) {
        await dispose({ host, probe });
        return;
      }
      resourcesRef.current = { host, probe };
      store.setState({ open: true, current, beforeEdit: null, afterEdit: null, history: 'none' });
    } catch (error) {
      try {
        if (probe) await probe.document.close();
      } finally { await host.dispose(); }
      throw error;
    }
  }

  const create = () => run('Open/create', async () => {
    const kind = store.getState().studio;
    await connect(kind);
    return `${kind} initialized through its public adapter and real Nitro host`;
  });
  const edit = () => run('Edit', async () => {
    const { probe } = active();
    const beforeEdit = await describe(probe);
    await probe.edit();
    const afterEdit = await describe(probe);
    if (beforeEdit === afterEdit) throw new Error('Typed edit did not change authoritative state');
    if (mountedRef.current) store.setState({ current: afterEdit, beforeEdit, afterEdit, history: 'edited' });
    return 'typed engine mutation changed the document; fresh undo comparison recorded';
  });
  const save = () => run('Save to disk', async () => {
    const { probe } = active();
    const kind = store.getState().studio;
    const current = await describe(probe);
    const bytes = await probe.document.save();
    validateEnvelope(bytes);
    const file = snapshotFile(kind);
    file.create({ overwrite: true });
    await file.write(bytes);
    const disk = await file.bytes();
    if (disk.length !== bytes.length || !disk.every((value, index) => value === bytes[index])) {
      throw new Error('Saved NFD1 bytes did not read back unchanged');
    }
    const record = expectedFile(kind);
    record.create({ overwrite: true });
    await record.write(JSON.stringify({ version: 1, studio: kind, byteLength: bytes.length, canonical: current }));
    const persisted: unknown = JSON.parse(await record.text());
    if (!persisted || typeof persisted !== 'object' ||
        !('canonical' in persisted) || persisted.canonical !== current) {
      throw new Error('Expected-state record did not persist');
    }
    if (mountedRef.current) store.setState({ current, savedUri: file.uri });
    return `${bytes.length} exact NFD1 bytes read back from ${file.uri}; retained for app relaunch`;
  });
  const close = () => run('Close', async () => {
    const resources = active();
    resourcesRef.current = null;
    if (mountedRef.current) store.setState({ open: false, current: '', beforeEdit: null, afterEdit: null, history: 'none' });
    await dispose(resources);
    return 'document closed and its host disposed';
  });
  const reopen = () => run('Reopen from disk', async () => {
    const kind = store.getState().studio;
    if (resourcesRef.current) throw new Error('Close the document before reopening');
    const file = snapshotFile(kind);
    const record = expectedFile(kind);
    if (!file.exists || !record.exists) throw new Error('Save this generated studio fixture first');
    if (file.size > 16 * 1024 * 1024 || record.size > 16 * 1024 * 1024) {
      throw new Error('Generated smoke fixture exceeds its 16 MiB safety bound');
    }
    const saved: unknown = JSON.parse(await record.text());
    if (!saved || typeof saved !== 'object' ||
        !('version' in saved) || saved.version !== 1 ||
        !('studio' in saved) || saved.studio !== kind ||
        !('canonical' in saved) || typeof saved.canonical !== 'string' ||
        !('byteLength' in saved) || typeof saved.byteLength !== 'number') {
      throw new Error('Invalid generated expected-state record');
    }
    const bytes = await file.bytes();
    validateEnvelope(bytes);
    if (bytes.length !== saved.byteLength) throw new Error('Saved fixture length changed');
    await connect(kind, bytes, saved.canonical);
    if (mountedRef.current) store.setState({ savedUri: file.uri });
    return 'new host/document restored disk bytes and exactly matched persisted state';
  });
  const undo = () => run('Undo fresh edit', async () => {
    const expected = store.getState().beforeEdit;
    if (expected === null || store.getState().history !== 'edited') throw new Error('Make a fresh edit first');
    const { probe } = active();
    if (!await probe.document.undo()) throw new Error('Engine reported no undo');
    const current = await describe(probe);
    requireEqual(current, expected, 'Undo');
    if (mountedRef.current) store.setState({ current, history: 'undone' });
    return 'authoritative state exactly matches the state before the fresh edit';
  });
  const redo = () => run('Redo', async () => {
    const expected = store.getState().afterEdit;
    if (expected === null || store.getState().history !== 'undone') throw new Error('Undo the fresh edit first');
    const { probe } = active();
    if (!await probe.document.redo()) throw new Error('Engine reported no redo');
    const current = await describe(probe);
    requireEqual(current, expected, 'Redo');
    if (mountedRef.current) store.setState({ current, history: 'edited' });
    return 'authoritative state exactly matches the committed edit';
  });
  const rejectInvalid = () => run('Reject bad restore', async () => {
    const { probe } = active();
    const before = await describe(probe);
    let rejected = false;
    try { await probe.document.handle.restore(new Uint8Array([0])); }
    catch { rejected = true; }
    if (!rejected) throw new Error('Engine accepted malformed snapshot bytes');
    requireEqual(await describe(probe), before, 'Rejected restore');
    return 'malformed NFD1 rejected without changing the open document';
  });

  return <ScrollView testID="f6-consumer" contentContainerStyle={{ padding: 20, gap: 12, backgroundColor: 'white' }}>
    <Text accessibilityRole="header" style={{ fontSize: 24, color: '#111' }}>Forge clean consumer</Text>
    <Text style={{ color: '#111' }}>Real Nitro only. Run each studio on both native platforms. Individual actions below do not certify F6.</Text>
    <SegmentedControl<Studio>
      testID="f6-studio" unstyled aria-label="Studio" value={screen.studio}
      options={STUDIOS.map(value => ({ value, label: value }))}
      disabled={screen.busy || screen.open}
      labelStyle={{ color: '#111' }}
      segmentStyle={({ selected }) => ({ padding: 12, borderWidth: 1, borderColor: selected ? '#111' : '#999' })}
      onChange={studio => store.setState({ studio, result: 'No action has run for this selection.', current: '', savedUri: '', history: 'none', beforeEdit: null, afterEdit: null })}
    />
    <Text testID="f6-selected" style={{ color: '#111' }}>Studio: {screen.studio} · Document: {screen.open ? 'open' : 'closed'}</Text>
    <Text style={{ color: '#111' }}>Open/create → Edit → Save → Close → Reopen → Edit → Undo → Redo. After Save, relaunch the app, select the same studio and Reopen to test durable persistence. Pre-save undo history is not promised.</Text>
    <Button unstyled style={actionStyle} title="Open/create" testID="f6-create" disabled={screen.busy || screen.open} onPress={create} />
    <Button unstyled style={actionStyle} title="Edit" testID="f6-edit" disabled={screen.busy || !screen.open} onPress={edit} />
    <Button unstyled style={actionStyle} title="Save to disk" testID="f6-save" disabled={screen.busy || !screen.open} onPress={save} />
    <Button unstyled style={actionStyle} title="Close" testID="f6-close" disabled={screen.busy || !screen.open} onPress={close} />
    <Button unstyled style={actionStyle} title="Reopen from disk" testID="f6-reopen" disabled={screen.busy || screen.open} onPress={reopen} />
    <Button unstyled style={actionStyle} title="Undo fresh edit" testID="f6-undo" disabled={screen.busy || !screen.open || screen.history !== 'edited'} onPress={undo} />
    <Button unstyled style={actionStyle} title="Redo" testID="f6-redo" disabled={screen.busy || !screen.open || screen.history !== 'undone'} onPress={redo} />
    <Button unstyled style={actionStyle} title="Reject bad restore" testID="f6-bad-restore" disabled={screen.busy || !screen.open} onPress={rejectInvalid} />
    <Text testID="f6-result" accessibilityLiveRegion="polite" selectable style={{ color: '#111' }}>{screen.result}</Text>
    <Text testID="f6-file" selectable style={{ color: '#111' }}>{screen.savedUri}</Text>
    <Text testID="f6-authoritative-state" selectable style={{ color: '#111' }}>{screen.current}</Text>
    <View testID="f6-log"><Text selectable style={{ color: '#111' }}>{screen.log.join('\n')}</Text></View>
  </ScrollView>;
}
