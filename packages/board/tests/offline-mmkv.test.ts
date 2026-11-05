import { describe, expect, it } from "vitest";
import {
  createMMKVBoardStorage, type MMKVBoardPort,
} from "../src/offline-mmkv";
import type { BoardCheckpoint } from "../src/offline";

function fixture() {
  const bytes = new Map<string, ArrayBuffer>();
  let fail = false;
  const mmkv: MMKVBoardPort = {
    getBuffer(key) { return bytes.get(key)?.slice(0); },
    set(key, value) {
      if (fail) throw new Error("simulated MMKV storage fault");
      bytes.set(key, value.slice(0));
    },
  };
  return { mmkv, bytes, failWrites(value: boolean) { fail = value; } };
}
function saved(id: string, rev: number, text = "hello"): BoardCheckpoint {
  return {
    schemaVersion: 1, documentId: id, revision: rev, syncedRevision: 0,
    data: new TextEncoder().encode(text),
  };
}
describe("offline MMKV v4 checkpoint adapter", () => {
  it("stores binary Yjs-compatible bytes with one scoped MMKV key", async () => {
    const { mmkv, bytes } = fixture();
    const storage = createMMKVBoardStorage(mmkv, { scope: "learner-A/class-1" });
    await storage.replaceAtomically("board-1", saved("board-1", 4));
    expect(bytes.size).toBe(1);
    const key = [...bytes.keys()][0]!;
    expect(key).toContain("learner-A%2Fclass-1");
    expect(key).toContain("board-1");
    expect(await storage.load("board-1")).toEqual(saved("board-1", 4));
    expect(await storage.load("new-board")).toBeNull();
  });

  it("isolates learners and documents on the same shared tablet", async () => {
    const h = fixture();
    const a = createMMKVBoardStorage(h.mmkv, { scope: "learner-a" });
    const b = createMMKVBoardStorage(h.mmkv, { scope: "learner-b" });
    await a.replaceAtomically("same-session", saved("same-session", 3, "private-a"));
    expect(await b.load("same-session")).toBeNull();
    await b.replaceAtomically("same-session", saved("same-session", 1, "private-b"));
    expect(new TextDecoder().decode((await a.load("same-session"))!.data)).toBe("private-a");
    expect(new TextDecoder().decode((await b.load("same-session"))!.data)).toBe("private-b");
    expect(h.bytes.size).toBe(2);
  });

  it("rejects truncated, corrupt, or future-version values instead of blanking work", async () => {
    const h = fixture();
    const adapter = createMMKVBoardStorage(h.mmkv, { scope: "learner" });
    await adapter.replaceAtomically("board", saved("board", 5));
    const key = [...h.bytes.keys()][0]!;
    const raw = h.bytes.get(key)!;
    const copy = raw.slice(0);
    const corruptBytes = new Uint8Array(copy);
    corruptBytes[corruptBytes.length - 1] = corruptBytes[corruptBytes.length - 1]! ^ 0xff;
    h.bytes.set(key, copy);
    await expect(adapter.load("board")).rejects.toThrow(/checksum/);
    h.bytes.set(key, raw.slice(0, 5));
    await expect(adapter.load("board")).rejects.toThrow(/truncated/);
    const future = raw.slice(0);
    new DataView(future).setUint8(4, 9);
    h.bytes.set(key, future);
    await expect(adapter.load("board")).rejects.toThrow(/schema/);
  });

  it("preserves local and synced revision markers without loss of bytes", async () => {
    const h = fixture();
    const adapter = createMMKVBoardStorage(h.mmkv, { scope:"person" });
    const next = { ...saved("b", 42), syncedRevision: 40 };
    await adapter.replaceAtomically("b", next);
    const read = await adapter.load("b");
    expect(read?.revision).toBe(42);
    expect(read?.syncedRevision).toBe(40);
    expect(read?.data).toEqual(next.data);
  });

  it("propagates write failure and refuses cross-document saves", async () => {
    const h = fixture();
    const storage = createMMKVBoardStorage(h.mmkv, { scope: "learner" });
    h.failWrites(true);
    await expect(storage.replaceAtomically("b", saved("b", 1)))
      .rejects.toThrow(/storage fault/);
    expect(h.bytes.size).toBe(0);
    h.failWrites(false);
    await expect(storage.replaceAtomically("b", saved("another", 1)))
      .rejects.toThrow(/document ID mismatch/);
  });

  it("rejects unscoped stores and snapshots above a declared budget", async () => {
    const h = fixture();
    expect(() => createMMKVBoardStorage(h.mmkv, { scope: "" })).toThrow(RangeError);
    const storage = createMMKVBoardStorage(h.mmkv, { scope: "safe", maxSnapshotBytes: 3 });
    await expect(storage.replaceAtomically("a", saved("a", 1, "way too long")))
      .rejects.toThrow(/Invalid local board checkpoint/);
  });
});
