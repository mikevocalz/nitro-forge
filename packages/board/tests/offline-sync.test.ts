import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createMMKVBoardStorage, type MMKVBoardPort,
} from "../src/offline-mmkv";
import {
  createLocalYjsBoardSession, type YjsBoardDocumentPort,
} from "../src/offline-yjs";
import {
  createYjsBoardSyncCoordinator, type BoardUpdateEnvelope,
} from "../src/offline-sync";

function fixture() {
  const memory = new Map<string, ArrayBuffer>();
  const mmkv: MMKVBoardPort = {
    getBuffer(key) { return memory.get(key)?.slice(0); },
    set(key, bytes) { memory.set(key, bytes.slice(0)); },
  };
  const storage = createMMKVBoardStorage(mmkv, { scope: "tenant/user" });
  const newDoc = () => {
    const doc = new Y.Doc();
    const records = doc.getMap<unknown>("records");
    const port: YjsBoardDocumentPort = {
      encode: () => Y.encodeStateAsUpdate(doc),
      merge: (update, origin) => Y.applyUpdate(doc, update, origin),
    };
    return { doc, records, port };
  };
  return { storage, newDoc };
}

describe("Yjs collaboration coordinator: durable ACKs and offline replay", () => {
  it("installs its shared operation before a transport re-enters syncNow", async () => {
    const f = fixture(), local = f.newDoc();
    const session = createLocalYjsBoardSession({ documentId: "reentrant", document: local.port, storage: f.storage });
    await session.initialize();
    local.records.set("stroke", 1); await session.saveLocal();
    let calls = 0, reentered: Promise<unknown> | undefined;
    const sync = createYjsBoardSyncCoordinator({
      session, documentId: "reentrant",
      transport: { async sendAndAcknowledge() { calls++; reentered = sync.syncNow(); } },
    });
    const first = sync.syncNow();
    await expect(first).resolves.toEqual({ kind: "uploaded", revision: 1 });
    expect(reentered).toBe(first);
    expect(calls).toBe(1);
    await session.close(); local.doc.destroy();
  });

  it("does not start a queued upload after disposal", async () => {
    const f = fixture(), local = f.newDoc();
    const session = createLocalYjsBoardSession({ documentId: "queued-dispose", document: local.port, storage: f.storage });
    await session.initialize();
    local.records.set("stroke", 1); await session.saveLocal();
    let calls = 0;
    const sync = createYjsBoardSyncCoordinator({
      session, documentId: "queued-dispose",
      transport: { async sendAndAcknowledge() { calls++; } },
    });
    const pending = sync.syncNow();
    sync.dispose();
    await expect(pending).rejects.toMatchObject({ code: "lifecycle" });
    expect(calls).toBe(0);
    expect(session.lastReceipt?.needsSync).toBe(true);
    await session.close(); local.doc.destroy();
  });
  it("keeps pending work when disconnected, then uploads once transport recovers", async () => {
    const f = fixture();
    const local = f.newDoc();
    const remote = f.newDoc();
    const session = createLocalYjsBoardSession({
      documentId:"work", document:local.port, storage:f.storage,
    });
    await session.initialize();
    local.records.set("ink-1", { shape:"line" });
    await session.saveLocal();
    let online = false;
    const sent: BoardUpdateEnvelope[] = [];
    const sync = createYjsBoardSyncCoordinator({
      session, documentId:"work",
      transport: { async sendAndAcknowledge(message) {
        if (!online) throw new Error("no internet");
        sent.push(message);
        Y.applyUpdate(remote.doc, message.update);
      } },
    });
    await expect(sync.syncNow()).rejects.toThrow("no internet");
    expect(session.lastReceipt).toMatchObject({ revision:1, syncedRevision:0, needsSync:true });
    online = true;
    expect(await sync.syncNow()).toEqual({ kind:"uploaded", revision:1 });
    expect(remote.records.get("ink-1")).toEqual({ shape:"line" });
    expect(sent).toHaveLength(1);
    expect(session.lastReceipt?.needsSync).toBe(false);
    expect(await sync.syncNow()).toEqual({ kind:"up-to-date", revision:1 });
    local.doc.destroy();
    remote.doc.destroy();
  });

  it("does not ACK edits authored while an earlier upload is still in flight", async () => {
    const f = fixture();
    const doc = f.newDoc();
    const session = createLocalYjsBoardSession({
      documentId:"race", document:doc.port, storage:f.storage,
    });
    await session.initialize();
    doc.records.set("stroke-one", 1);
    await session.saveLocal();
    let finish!: () => void;
    const barrier = new Promise<void>(resolve => { finish = resolve; });
    const sent: number[] = [];
    const sync = createYjsBoardSyncCoordinator({
      session, documentId:"race",
      transport: { async sendAndAcknowledge(message) {
        sent.push(message.revision);
        await barrier;
      } },
    });
    const first = sync.syncNow();
    // Let upload start and capture revision 1.
    await Promise.resolve();
    doc.records.set("stroke-two", 2);
    await session.saveLocal();
    finish();
    expect(await first).toEqual({ kind:"uploaded", revision:1 });
    expect(session.lastReceipt).toMatchObject({ revision:2, syncedRevision:1, needsSync:true });
    expect(await sync.syncNow()).toEqual({ kind:"uploaded", revision:2 });
    expect(sent).toEqual([1,2]);
    doc.doc.destroy();
  });

  it("shares one upload across overlapping sync callers", async () => {
    const f = fixture();
    const d = f.newDoc();
    const session = createLocalYjsBoardSession({ documentId:"shared",document:d.port,storage:f.storage });
    await session.initialize();
    d.records.set("mark", true);
    await session.saveLocal();
    let calls = 0;
    const sync = createYjsBoardSyncCoordinator({
      session, documentId:"shared",
      transport: { async sendAndAcknowledge() { calls++; } },
    });
    const a = sync.syncNow();
    const b = sync.syncNow();
    expect(a).toBe(b);
    expect(await a).toEqual({ kind:"uploaded",revision:1 });
    expect(calls).toBe(1);
    d.doc.destroy();
  });

  it("persists remote Yjs updates without replacing the local author's records", async () => {
    const f = fixture();
    const local = f.newDoc();
    const peer = f.newDoc();
    const session = createLocalYjsBoardSession({
      documentId:"merge", document:local.port, storage:f.storage,
    });
    await session.initialize();
    local.records.set("local", "one");
    await session.saveLocal();
    peer.records.set("remote", "two");
    const sync = createYjsBoardSyncCoordinator({
      session, documentId:"merge",
      transport: { async sendAndAcknowledge() {} },
    });
    await sync.receiveRemote(Y.encodeStateAsUpdate(peer.doc));
    expect([...local.records.keys()].sort()).toEqual(["local","remote"]);
    const restored = f.newDoc();
    const second = createLocalYjsBoardSession({
      documentId:"merge",document:restored.port,storage:f.storage,
    });
    await second.initialize();
    expect([...restored.records.keys()].sort()).toEqual(["local","remote"]);
    local.doc.destroy();peer.doc.destroy();restored.doc.destroy();
  });

  it("disposal cannot falsely ACK a network response that arrives late", async () => {
    const f = fixture();
    const d = f.newDoc();
    const session = createLocalYjsBoardSession({ documentId:"dispose",document:d.port,storage:f.storage });
    await session.initialize();
    d.records.set("local",1);
    await session.saveLocal();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish=resolve; });
    const sync = createYjsBoardSyncCoordinator({
      session,documentId:"dispose",
      transport: { async sendAndAcknowledge() { await pending; } },
    });
    const call = sync.syncNow();
    await Promise.resolve();
    sync.dispose();
    finish();
    await expect(call).rejects.toMatchObject({ code:"lifecycle" });
    expect(session.lastReceipt?.needsSync).toBe(true);
    d.doc.destroy();
  });
});
