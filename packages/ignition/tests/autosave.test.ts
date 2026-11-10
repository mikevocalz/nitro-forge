import { afterEach, expect, it, vi } from "vitest";
import { createCheckpointStore, DocumentAutosave, type Checkpoint, type CheckpointStore } from "../src/autosave";
import { DocumentHandle } from "../src/document";
import { CliHost } from "../src/host-cli";

const hosts: CliHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.dispose())); });

function memoryStore(): CheckpointStore & { value?: Checkpoint } {
  return {
    async read() { return this.value; },
    async write(_key, value) { this.value = { kind: value.kind, bytes: value.bytes.slice() }; },
  };
}

async function fixture(store = memoryStore()) {
  const host = new CliHost(); hosts.push(host);
  const doc = await DocumentHandle.open(host, "cadence");
  await doc.apply("new");
  const autosave = new DocumentAutosave(doc, store, "test-document", 60_000);
  return { host, doc, store, autosave };
}

const tempo = async (doc: DocumentHandle) => (await doc.apply<{ tempo_bpm: number }>("describe")).data.tempo_bpm;

it("keeps persisted engine tags stable and recovered snapshot views independently owned", async () => {
  let bytes: Uint8Array | undefined;
  const store = createCheckpointStore({ read: async () => bytes, write: async (_key, value) => { bytes = value.slice(); } });
  const { host, doc, autosave } = await fixture(store);
  await doc.apply("setTempo", { bpm: 130 }); await autosave.flush();
  expect([...bytes!.subarray(0, 5)]).toEqual([78, 70, 67, 49, 1]); // Persisted NFC1/Cadence format.
  const view = await store.read("test-document"); view!.bytes.fill(0);
  const restored = await DocumentAutosave.recover(host, "cadence", store, "test-document");
  expect(await tempo(restored!)).toBe(130);
  await restored!.close(); await autosave.close(); await doc.close();
});

it("persists authoritative edits, undo and redo, then recovers a new Rust document", async () => {
  const { host, doc, store, autosave } = await fixture();
  await doc.apply("setTempo", { bpm: 130 }); await autosave.flush();
  await doc.undo(); await autosave.flush();
  const undone = await DocumentAutosave.recover(host, "cadence", store, "test-document");
  expect(await tempo(undone!)).toBe(120); await undone!.close();
  await doc.redo(); await autosave.flush();
  const redone = await DocumentAutosave.recover(host, "cadence", store, "test-document");
  expect(await tempo(redone!)).toBe(130);
  expect(autosave.state).toMatchObject({ revision: 3, savedRevision: 3, error: null });
  await redone!.close(); await autosave.close(); await doc.close();
});

it("serializes a later edit behind an in-flight checkpoint instead of losing it", async () => {
  const store = memoryStore();
  const write = store.write.bind(store);
  let entered!: () => void; const writing = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const observed: number[] = [];
  store.write = async (key, value) => {
    observed.push(JSON.parse(new TextDecoder().decode(value.bytes.subarray(9))).tempo_bpm);
    if (observed.length === 1) { entered(); await blocked; }
    await write(key, value);
  };
  const { host, doc, autosave } = await fixture(store);
  await doc.apply("setTempo", { bpm: 130 });
  const saving = autosave.flush(); await writing;
  await doc.apply("setTempo", { bpm: 140 }); release(); await saving;
  expect(observed).toEqual([130, 140]);
  const restored = await DocumentAutosave.recover(host, "cadence", store, "test-document");
  expect(await tempo(restored!)).toBe(140);
  await restored!.close(); await autosave.close(); await doc.close();
});

it("retains dirty state and the previous checkpoint after failed storage, then retries", async () => {
  const { doc, store, autosave } = await fixture();
  await doc.apply("setTempo", { bpm: 130 }); await autosave.flush();
  const previous = store.value!.bytes.slice();
  const write = store.write.bind(store);
  store.write = async () => { throw new Error("disk full"); };
  await doc.apply("setTempo", { bpm: 140 });
  await expect(autosave.flush()).rejects.toThrow("disk full");
  expect(store.value!.bytes).toEqual(previous);
  expect(autosave.state).toMatchObject({ revision: 2, savedRevision: 1 });
  store.write = write; await autosave.flush();
  expect(autosave.state).toMatchObject({ savedRevision: 2, error: null });
  await autosave.close(); await doc.close();
});

it("rejects foreign/corrupt recovery and closes a session when engine decoding fails", async () => {
  const { host, doc, store, autosave } = await fixture();
  await doc.apply("setTempo", { bpm: 130 }); await autosave.flush();
  await expect(DocumentAutosave.recover(host, "prism", store, "test-document")).rejects.toThrow("another engine");
  store.value = { kind: "cadence", bytes: new Uint8Array([0]) };
  await expect(DocumentAutosave.recover(host, "cadence", store, "test-document")).rejects.toThrow("NFD1");
  store.value = { kind: "cadence", bytes: new Uint8Array([78, 70, 68, 49, 0, 1, 0, 0, 0, 123]) };
  const close = vi.spyOn(host, "close");
  await expect(DocumentAutosave.recover(host, "cadence", store, "test-document")).rejects.toThrow();
  expect(close).toHaveBeenCalledTimes(1);
  await autosave.close(); await doc.close();
});

it("rejects object-prototype names instead of mistagging an unknown engine", async () => {
  const storage = { read: async () => undefined, write: vi.fn(async () => {}) };
  const store = createCheckpointStore(storage);
  const bytes = new Uint8Array([78,70,68,49,0,2,0,0,0,123,125]);
  await expect(store.write("invalid", { kind: "toString" as never, bytes })).rejects.toThrow("Unknown checkpoint engine");
  expect(storage.write).not.toHaveBeenCalled();
});
