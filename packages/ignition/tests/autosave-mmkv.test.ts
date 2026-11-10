import { afterEach, expect, it, vi } from "vitest";
import { createMMKVCheckpointStorage, type MMKVCheckpointPort } from "../src/autosave-mmkv";
import { createCheckpointStore, DocumentAutosave } from "../src/autosave";
import { DocumentHandle } from "../src/document";
import { CliHost } from "../src/host-cli";
import { ENGINE_KINDS } from "../src/types";

const hosts: CliHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.dispose())); });
function host() { const value = new CliHost(); hosts.push(value); return value; }

// Deliberately returns/stores borrowed buffers to exercise adapter ownership.
// Actual MMKV native execution belongs to the installed-app acceptance gate.
function port() {
  const records = new Map<string, ArrayBuffer>();
  const mmkv: MMKVCheckpointPort = {
    getBuffer: key => records.get(key),
    set: (key, bytes) => { records.set(key, bytes); },
  };
  return { mmkv, records };
}

it.each(ENGINE_KINDS)("autosaves and recovers real %s snapshots through the MMKV binary adapter", async kind => {
  const native = host(), { mmkv, records } = port();
  const store = createCheckpointStore(createMMKVCheckpointStorage(mmkv, { scope: "account-one" }));
  const document = await DocumentHandle.open(native, kind);
  await document.apply("new", kind === "prism" ? { width: 4, height: 4 } : kind === "folio" ? { pages: 1 } : {});
  const expected = (await document.apply<Record<string, unknown>>("describe", {})).data;
  const autosave = new DocumentAutosave(document, store, kind, 60_000);
  await autosave.close(); await document.close();
  expect(records.size).toBe(1);
  expect(new TextDecoder().decode(new Uint8Array([...records.values()][0]!).subarray(0, 4))).toBe("NFC1");
  const reopenedStore = createCheckpointStore(createMMKVCheckpointStorage(mmkv, { scope: "account-one" }));
  const recovered = (await DocumentAutosave.recover(native, kind, reopenedStore, kind))!;
  expect((await recovered.apply("describe", {})).data).toEqual(kind === "draft"
    ? { ...expected, source_revision: expect.any(Number) } : expected);
  await recovered.close();
});

it("owns exact sliced write bytes and independently owns every read", async () => {
  const { mmkv, records } = port();
  const storage = createMMKVCheckpointStorage(mmkv, { scope: "account/one", maxCheckpointBytes: 3 });
  const source = Buffer.from([99, 1, 2, 3, 88]);
  await storage.write("doc/one", source.subarray(1, 4));
  source.fill(7);
  const saved = [...records.values()][0]!;
  expect(saved.byteLength).toBe(3);
  expect([...new Uint8Array(saved)]).toEqual([1, 2, 3]);
  const read = (await storage.read("doc/one"))!; read.fill(8);
  expect([...(await storage.read("doc/one"))!]).toEqual([1, 2, 3]);
  expect([...records.keys()]).toEqual(["nitroforge.checkpoint.v1/account%2Fone/doc%2Fone"]);
});

it("isolates accounts and escapes scope/key separators without collisions", async () => {
  const { mmkv, records } = port();
  const first = createMMKVCheckpointStorage(mmkv, { scope: "account/one" });
  const second = createMMKVCheckpointStorage(mmkv, { scope: "account%2Fone" });
  await first.write("doc/one", new Uint8Array([1]));
  await first.write("doc%2Fone", new Uint8Array([2]));
  expect(await second.read("doc/one")).toBeUndefined();
  await second.write("doc/one", new Uint8Array([3]));
  expect([...(await first.read("doc/one"))!]).toEqual([1]);
  expect([...(await first.read("doc%2Fone"))!]).toEqual([2]);
  expect([...(await second.read("doc/one"))!]).toEqual([3]);
  expect(records.size).toBe(3);
});

it("bounds keys, scopes and complete binary values before accessing storage", async () => {
  const { mmkv, records } = port();
  for (const scope of ["", "x".repeat(257)])
    expect(() => createMMKVCheckpointStorage(mmkv, { scope })).toThrow(RangeError);
  for (const maxCheckpointBytes of [0, 1.5, NaN, 256 * 1024 * 1024 + 6])
    expect(() => createMMKVCheckpointStorage(mmkv, { scope: "account", maxCheckpointBytes })).toThrow(RangeError);
  const storage = createMMKVCheckpointStorage(mmkv, { scope: "account", maxCheckpointBytes: 3 });
  for (const key of ["", "x".repeat(257)]) {
    await expect(storage.read(key)).rejects.toThrow(RangeError);
    await expect(storage.write(key, new Uint8Array([1]))).rejects.toThrow(RangeError);
  }
  await expect(storage.write("doc", new Uint8Array())).rejects.toThrow(RangeError);
  await expect(storage.write("doc", new Uint8Array(4))).rejects.toThrow(RangeError);
  expect(records.size).toBe(0);
  records.set("nitroforge.checkpoint.v1/account/doc", new ArrayBuffer(4));
  await expect(storage.read("doc")).rejects.toThrow(RangeError);
  expect(records.size).toBe(1);
});

it("rejects wrong-engine and corrupt recovery without replacing the stored value", async () => {
  const native = host(), { mmkv, records } = port();
  const store = createCheckpointStore(createMMKVCheckpointStorage(mmkv, { scope: "account" }));
  const doc = await DocumentHandle.open(native, "cadence");
  const autosave = new DocumentAutosave(doc, store, "doc", 60_000);
  await doc.apply("setTempo", { bpm: 135 }); await autosave.close(); await doc.close();
  const original = [...records.values()][0]!, storageKey = [...records.keys()][0]!;
  const open = vi.spyOn(native, "open");
  await expect(DocumentAutosave.recover(native, "prism", store, "doc")).rejects.toThrow("another engine");
  expect(open).not.toHaveBeenCalled(); expect(records.get(storageKey)).toBe(original);
  const corrupt = original.slice(0); new Uint8Array(corrupt)[0] = 0;
  records.set(storageKey, corrupt);
  await expect(DocumentAutosave.recover(native, "cadence", store, "doc")).rejects.toThrow("Invalid checkpoint");
  expect(open).not.toHaveBeenCalled(); expect(records.get(storageKey)).toBe(corrupt);
  const invalidPayload = new Uint8Array([78, 70, 67, 49, 1, 78, 70, 68, 49, 0, 1, 0, 0, 0, 123]).buffer;
  records.set(storageKey, invalidPayload);
  const close = vi.spyOn(native, "close");
  await expect(DocumentAutosave.recover(native, "cadence", store, "doc")).rejects.toThrow();
  expect(close).toHaveBeenCalledTimes(1); expect(records.get(storageKey)).toBe(invalidPayload);
});

it("propagates native storage failures, preserves the good checkpoint and permits autosave retry", async () => {
  const native = host(), { mmkv, records } = port();
  const store = createCheckpointStore(createMMKVCheckpointStorage(mmkv, { scope: "account" }));
  const doc = await DocumentHandle.open(native, "cadence");
  const autosave = new DocumentAutosave(doc, store, "doc", 60_000);
  await doc.apply("setTempo", { bpm: 130 }); await autosave.flush();
  const original = [...records.values()][0]!;
  const set = mmkv.set, get = mmkv.getBuffer;
  mmkv.set = () => { throw new Error("disk full"); };
  await doc.apply("setTempo", { bpm: 140 });
  await expect(autosave.flush()).rejects.toThrow("disk full");
  expect([...records.values()][0]).toBe(original);
  expect(autosave.state).toMatchObject({ revision: 2, savedRevision: 1 });
  mmkv.getBuffer = () => { throw new Error("storage unavailable"); };
  await expect(store.read("doc")).rejects.toThrow("storage unavailable");
  mmkv.getBuffer = get;
  const old = (await DocumentAutosave.recover(native, "cadence", store, "doc"))!;
  expect((await old.apply<{ tempo_bpm: number }>("describe", {})).data.tempo_bpm).toBe(130);
  await old.close(); mmkv.set = set; await autosave.flush();
  const recovered = (await DocumentAutosave.recover(native, "cadence", store, "doc"))!;
  expect((await recovered.apply<{ tempo_bpm: number }>("describe", {})).data.tempo_bpm).toBe(140);
  expect(autosave.state).toMatchObject({ savedRevision: 2, error: null });
  await recovered.close(); await autosave.close(); await doc.close();
});
