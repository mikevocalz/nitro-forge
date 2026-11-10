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

  it("detects plausible corruption in local and acknowledged revision metadata", async () => {
    const h = fixture();
    const storage = createMMKVBoardStorage(h.mmkv, { scope: "metadata" });
    await storage.replaceAtomically("b", saved("b", 4));
    const key = [...h.bytes.keys()][0]!, original = h.bytes.get(key)!;
    for (const offset of [15, 23]) {
      const damaged = original.slice(0);
      // Both modified values still satisfy all revision range checks.
      const bytes = new Uint8Array(damaged);
      bytes[offset] = bytes[offset]! ^ 1;
      h.bytes.set(key, damaged);
      await expect(storage.load("b")).rejects.toThrow(/checksum/);
      expect(h.bytes.get(key)).toBe(damaged);
    }
  });

  it("reads the legacy binary envelope and upgrades only on a successful save", async () => {
    const h = fixture();
    const storage = createMMKVBoardStorage(h.mmkv, { scope: "legacy" });
    // NFB1, format 1, revision 4, synced 0, five-byte 'hello' payload.
    const legacy = Uint8Array.from([
      78, 70, 66, 49, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 54, 16, 166, 134,
      104, 101, 108, 108, 111,
    ]).buffer;
    const key = "nitroforge.board.v1/legacy/b";
    h.bytes.set(key, legacy);
    const checkpoint = await storage.load("b");
    expect(checkpoint).toEqual(saved("b", 4));
    expect(h.bytes.get(key)).toBe(legacy);
    await storage.replaceAtomically("b", checkpoint!);
    expect(new Uint8Array(h.bytes.get(key)!)[4]).toBe(2);
    expect(await storage.load("b")).toEqual(checkpoint);
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
