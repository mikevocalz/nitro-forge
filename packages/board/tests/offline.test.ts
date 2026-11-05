import { describe, expect, it } from "vitest";
import {
  CorruptCheckpointError,
  createOfflineBoardController,
  OfflineBoardError,
  type BoardCheckpoint,
  type BoardDocumentPort,
  type LocalBoardStorage,
} from "../src/offline";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function harness(initial = "blank") {
  const records = new Map<string, BoardCheckpoint>();
  let writes = 0;
  let failWrite = false;
  const storage: LocalBoardStorage = {
    async load(id) {
      const saved = records.get(id);
      return saved ? { ...saved, data: new Uint8Array(saved.data) } : null;
    },
    async replaceAtomically(id, checkpoint) {
      if (failWrite) throw new Error("simulated disk write failure");
      writes++;
      records.set(id, { ...checkpoint, data: new Uint8Array(checkpoint.data) });
    },
  };
  const doc = (text = initial): BoardDocumentPort<string> & { read(): string; failRestore?: boolean } => {
    let state = text;
    const port: BoardDocumentPort<string> & { read(): string; failRestore?: boolean } = {
      read: () => state,
      async apply(fragment) { state += fragment; },
      async snapshot() { return encoder.encode(state); },
      async restore(bytes) {
        if (port.failRestore) throw new Error("restore failed");
        state = decoder.decode(bytes);
      },
    };
    return port;
  };
  return {
    records, storage, doc,
    get writes() { return writes; },
    set failWrite(value: boolean) { failWrite = value; },
  };
}

describe("offline board: locally durable document authority", () => {
  it("saves before acknowledging an edit and opens that document without a network", async () => {
    const h = harness();
    const firstDoc = h.doc();
    const first = createOfflineBoardController({
      documentId: "drawing-1", document: firstDoc, storage: h.storage,
    });
    expect(await first.open()).toEqual({
      documentId: "drawing-1", revision: 0, syncedRevision: 0, needsSync: false,
    });
    const saved = await first.commit(" stroke");
    expect(saved).toMatchObject({ revision: 1, syncedRevision: 0, needsSync: true });
    expect(firstDoc.read()).toBe("blank stroke");
    expect(h.writes).toBe(2);
    await first.close();

    // Simulate force-quit/relaunch: a completely new editor instance and
    // controller restore only from the previously persisted local bytes.
    const secondDoc = h.doc("empty");
    const second = createOfflineBoardController({
      documentId: "drawing-1", document: secondDoc, storage: h.storage,
    });
    expect(await second.open()).toMatchObject({ revision: 1, needsSync: true });
    expect(secondDoc.read()).toBe("blank stroke");
    expect(await second.commit(" more")).toMatchObject({ revision: 2, needsSync: true });
    expect(secondDoc.read()).toBe("blank stroke more");
  });

  it("serializes competing strokes and does not lose local revision order", async () => {
    const h = harness("a");
    const doc = h.doc();
    const board = createOfflineBoardController({ documentId: "b", document: doc, storage: h.storage });
    await board.open();
    const results = await Promise.all([board.commit("1"),board.commit("2"),board.commit("3")]);
    expect(results.map(x => x.revision)).toEqual([1, 2, 3]);
    expect(doc.read()).toBe("a123");
    expect(decoder.decode(h.records.get("b")!.data)).toBe("a123");
  });

  it("restores canonical editor state if local persistence fails", async () => {
    const h = harness("first");
    const doc = h.doc();
    const board = createOfflineBoardController({ documentId:"err",document:doc,storage:h.storage });
    await board.open();
    h.failWrite = true;
    await expect(board.commit(" bad")).rejects.toMatchObject({ code: "storage" });
    expect(doc.read()).toBe("first");
    expect(board.lastReceipt).toMatchObject({ revision: 0 });
    expect(decoder.decode(h.records.get("err")!.data)).toBe("first");
    h.failWrite = false;
    expect(await board.commit(" good")).toMatchObject({ revision: 1 });
    expect(doc.read()).toBe("first good");
  });

  it("never overwrites corrupt saved checkpoints silently", async () => {
    const h = harness();
    h.records.set("damaged", {
      schemaVersion: 1, documentId: "other", revision: 7,
      syncedRevision: 0, data: encoder.encode("important"),
    });
    const doc = h.doc("new");
    const board = createOfflineBoardController({
      documentId: "damaged", document: doc, storage: h.storage,
    });
    await expect(board.open()).rejects.toMatchObject({ code: "invalid-checkpoint" });
    expect(board.status).toBe("corrupt");
    expect(doc.read()).toBe("new");
    expect(h.writes).toBe(0);
  });

  it("stays retryable after a transient load failure", async () => {
    const h = harness();
    h.records.set("flaky", {
      schemaVersion: 1, documentId: "flaky", revision: 3,
      syncedRevision: 1, data: encoder.encode("kept"),
    });
    let failLoads = 1;
    const storage: LocalBoardStorage = {
      async load(id) {
        if (failLoads-- > 0) throw new Error("storage busy");
        return h.storage.load(id);
      },
      replaceAtomically: (id, c) => h.storage.replaceAtomically(id, c),
    };
    const doc = h.doc("empty");
    const board = createOfflineBoardController({ documentId: "flaky", document: doc, storage });
    await expect(board.open()).rejects.toMatchObject({ code: "storage" });
    expect(board.status).toBe("unopened");
    expect(await board.open()).toMatchObject({ revision: 3, syncedRevision: 1 });
    expect(board.status).toBe("ready");
    expect(doc.read()).toBe("kept");
    expect(h.writes).toBe(0);
  });

  it("surfaces a typed corrupt-checkpoint error and discards only on explicit request", async () => {
    const h = harness();
    h.records.set("broken", {
      schemaVersion: 1, documentId: "broken", revision: 2,
      syncedRevision: 5, data: encoder.encode("unreadable"),
    });
    const doc = h.doc("fresh");
    const board = createOfflineBoardController({ documentId: "broken", document: doc, storage: h.storage });
    const error = await board.open().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CorruptCheckpointError);
    expect(error).toMatchObject({ boardId: "broken", code: "invalid-checkpoint" });
    expect(board.status).toBe("corrupt");
    // A second open re-reads storage and still refuses; nothing was written.
    await expect(board.open()).rejects.toBeInstanceOf(CorruptCheckpointError);
    await expect(board.commit(" x")).rejects.toMatchObject({ code: "lifecycle" });
    expect(h.writes).toBe(0);
    // The board id acts as an explicit confirmation of which board to wipe.
    await expect(board.discardCorruptCheckpoint("other")).rejects.toMatchObject({ code: "lifecycle" });
    expect(h.writes).toBe(0);

    expect(await board.discardCorruptCheckpoint("broken"))
      .toMatchObject({ documentId: "broken", revision: 0, syncedRevision: 0, needsSync: false });
    expect(board.status).toBe("ready");
    expect(decoder.decode(h.records.get("broken")!.data)).toBe("fresh");
    expect(await board.commit(" ink")).toMatchObject({ revision: 1 });
  });

  it("refuses to discard a checkpoint that is not known to be corrupt", async () => {
    const h = harness();
    const board = createOfflineBoardController({ documentId: "fine", document: h.doc(), storage: h.storage });
    await expect(board.discardCorruptCheckpoint("fine")).rejects.toMatchObject({ code: "lifecycle" });
    await board.open();
    await expect(board.discardCorruptCheckpoint("fine")).rejects.toMatchObject({ code: "lifecycle" });
    expect(h.writes).toBe(1);
  });

  it("persists server ACK separately while preserving newer offline edits", async () => {
    const h = harness();
    const board = createOfflineBoardController({ documentId: "sync", document: h.doc(), storage:h.storage });
    await board.open();
    await board.commit(" A");
    await board.commit(" B");
    expect(await board.acknowledgeSync(1)).toMatchObject({
      revision: 2, syncedRevision: 1, needsSync: true,
    });
    expect(await board.acknowledgeSync(1)).toMatchObject({ syncedRevision: 1 });
    await expect(board.acknowledgeSync(3)).rejects.toMatchObject({ code: "revision" });
    expect(await board.acknowledgeSync(2)).toMatchObject({ needsSync: false });
    await board.close();

    const reopened = createOfflineBoardController({
      documentId: "sync", document:h.doc("new"), storage:h.storage,
    });
    expect(await reopened.open()).toMatchObject({
      revision: 2, syncedRevision: 2, needsSync: false,
    });
  });

  it("disables further operations if rollback itself fails", async () => {
    const h = harness("saved");
    const doc = h.doc();
    const board = createOfflineBoardController({ documentId:"panic",document:doc,storage:h.storage });
    await board.open();
    h.failWrite = true;
    doc.failRestore = true;
    await expect(board.commit(" lost")).rejects.toMatchObject({ code: "rollback" });
    expect(board.status).toBe("failed");
    await expect(board.commit(" another")).rejects.toMatchObject({ code: "lifecycle" });
    expect(decoder.decode(h.records.get("panic")!.data)).toBe("saved");
  });

  it("closes after queued saves and rejects future commands", async () => {
    const h = harness();
    const board = createOfflineBoardController({ documentId:"close",document:h.doc(),storage:h.storage });
    await board.open();
    const prior = board.commit(" first");
    const closed = board.close();
    await expect(board.commit(" not accepted")).rejects.toMatchObject({ code: "lifecycle" });
    expect(await prior).toMatchObject({ revision: 1 });
    await closed;
    expect(board.status).toBe("closed");
    expect(await h.storage.load("close")).toMatchObject({ revision: 1 });
  });

  it("validates snapshot limits, storage and IDs without pretending to save", async () => {
    const h = harness("big-data");
    const board = createOfflineBoardController({
      documentId:"tiny", document:h.doc(), storage:h.storage, maxSnapshotBytes:2,
    });
    await expect(board.open()).rejects.toBeInstanceOf(OfflineBoardError);
    expect(h.writes).toBe(0);
    expect(() => createOfflineBoardController({
      documentId:"", document:h.doc(),storage:h.storage,
    })).toThrow(RangeError);
  });
});
