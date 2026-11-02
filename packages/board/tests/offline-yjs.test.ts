import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createMMKVBoardStorage, type MMKVBoardPort } from "../src/offline-mmkv";
import { createLocalYjsBoardSession, type YjsBoardDocumentPort } from "../src/offline-yjs";

function mmkvStorage() {
  const map = new Map<string, ArrayBuffer>();
  let failing = false;
  const mmkv: MMKVBoardPort = {
    getBuffer(key) { return map.get(key)?.slice(0); },
    set(key, value) {
      if (failing) throw new Error("disk unavailable");
      map.set(key, value.slice(0));
    },
  };
  return {
    map,
    storage: createMMKVBoardStorage(mmkv, { scope: "learner-1/course-2" }),
    fail(value: boolean) { failing = value; },
  };
}
function yDoc(): {
  doc: Y.Doc;
  port: YjsBoardDocumentPort;
  records: Y.Map<unknown>;
} {
  const doc = new Y.Doc();
  const records = doc.getMap<unknown>("records");
  return {
    doc,
    port: {
      encode: () => Y.encodeStateAsUpdate(doc),
      merge: (update, origin) => Y.applyUpdate(doc, update, origin),
    },
    records,
  };
}
const shape = (id: string) => ({ id, typeName: "shape", type: "draw", x: 1, y: 2 });

describe("Moyo-compatible Yjs CRDT + MMKV offline board", () => {
  it("reopens a fresh Y.Doc with every offline stroke preserved", async () => {
    const h = mmkvStorage();
    const a = yDoc();
    const board = createLocalYjsBoardSession({
      documentId:"board-session", document:a.port, storage:h.storage,
    });
    expect(await board.initialize()).toMatchObject({ revision: 0, needsSync: false });
    a.doc.transact(() => a.records.set("stroke-a", shape("stroke-a")), "local");
    expect(await board.saveLocal()).toMatchObject({ revision: 1, needsSync:true });
    await board.close();
    a.doc.destroy();

    // New app/editor process, not a previously retained in-memory document.
    const b = yDoc();
    const restored = createLocalYjsBoardSession({
      documentId:"board-session", document:b.port, storage:h.storage,
    });
    expect(await restored.initialize()).toMatchObject({ revision:1, needsSync:true });
    expect(b.records.get("stroke-a")).toEqual(shape("stroke-a"));
    b.doc.destroy();
  });

  it("merges another author after offline edits instead of overwriting either", async () => {
    const h = mmkvStorage();
    const local = yDoc();
    const remote = yDoc();
    const board = createLocalYjsBoardSession({
      documentId:"collab", document:local.port, storage:h.storage,
    });
    await board.initialize();
    local.doc.transact(() => local.records.set("my-stroke", shape("mine")), "local");
    await board.saveLocal();
    remote.doc.transact(() => remote.records.set("their-stroke", shape("theirs")), "local");
    await board.mergeRemote(Y.encodeStateAsUpdate(remote.doc));
    expect([...local.records.keys()].sort()).toEqual(["my-stroke","their-stroke"]);
    expect(board.lastReceipt?.needsSync).toBe(true);
    expect(board.pendingUpdate()).toBeInstanceOf(Uint8Array);
    const third = yDoc();
    Y.applyUpdate(third.doc, board.pendingUpdate()!);
    expect([...third.records.keys()].sort()).toEqual(["my-stroke","their-stroke"]);
    local.doc.destroy(); remote.doc.destroy(); third.doc.destroy();
  });

  it("sync ACKs never mark later offline edits as uploaded", async () => {
    const h = mmkvStorage();
    const a = yDoc();
    const board = createLocalYjsBoardSession({
      documentId:"sync", document:a.port, storage:h.storage,
    });
    await board.initialize();
    a.records.set("a", shape("a"));
    await board.saveLocal();
    a.records.set("b", shape("b"));
    await board.saveLocal();
    expect(await board.acknowledgeSync(1)).toMatchObject({
      revision: 2, syncedRevision: 1, needsSync: true,
    });
    expect(await board.acknowledgeSync(2)).toMatchObject({ needsSync: false });
    expect(board.pendingUpdate()).toBeNull();
    a.records.set("c", shape("c"));
    await board.saveLocal();
    expect(board.lastReceipt).toMatchObject({ revision:3, syncedRevision:2, needsSync:true });
    a.doc.destroy();
  });

  it("does not invent a Yjs rollback when MMKV fails", async () => {
    const h = mmkvStorage();
    const a = yDoc();
    const board = createLocalYjsBoardSession({
      documentId:"failure",document:a.port,storage:h.storage,
    });
    await board.initialize();
    a.records.set("one", shape("one"));
    h.fail(true);
    await expect(board.saveLocal()).rejects.toMatchObject({ code:"storage" });
    expect(a.records.has("one")).toBe(true);
    expect(board.lastReceipt?.revision).toBe(0);
    h.fail(false);
    expect(await board.saveLocal()).toMatchObject({ revision:1, needsSync:true });
    a.doc.destroy();
  });

  it("automatically persists edits from the existing Y.Doc observer", async () => {
    const h = mmkvStorage();
    const a = yDoc();
    const failures: unknown[] = [];
    const board = createLocalYjsBoardSession({
      documentId:"auto", document:a.port, storage:h.storage,
      subscribeChanges(onChange) {
        const listener = () => onChange();
        a.doc.on("update", listener);
        return () => a.doc.off("update", listener);
      },
      onPersistenceError(error) { failures.push(error); },
    });
    await board.initialize();
    a.doc.transact(() => a.records.set("ink-one", shape("one")), "local");
    a.doc.transact(() => a.records.set("ink-two", shape("two")), "local");
    const persisted = await board.saveLocal(); // explicit flush, not a duplicate commit
    expect(persisted).toMatchObject({ revision:2, needsSync:true });
    expect(failures).toHaveLength(0);
    await board.close();
    a.doc.destroy();

    const reopenedDoc = yDoc();
    const reopened = createLocalYjsBoardSession({
      documentId:"auto", document:reopenedDoc.port, storage:h.storage,
    });
    expect(await reopened.initialize()).toMatchObject({ revision:2, needsSync:true });
    expect([...reopenedDoc.records.keys()].sort()).toEqual(["ink-one","ink-two"]);
    reopenedDoc.doc.destroy();
  });

  it("reports unsaved MMKV failures and refuses a false cloud ACK", async () => {
    const h = mmkvStorage();
    const a = yDoc();
    const errors: unknown[] = [];
    const board = createLocalYjsBoardSession({
      documentId:"unsafe", document:a.port, storage:h.storage,
      subscribeChanges(onChange) {
        const listener = () => onChange();
        a.doc.on("update", listener);
        return () => a.doc.off("update", listener);
      },
      onPersistenceError(error) { errors.push(error); },
    });
    await board.initialize();
    h.fail(true);
    a.records.set("not-on-disk", shape("not-on-disk"));
    await expect(board.saveLocal()).rejects.toMatchObject({ code:"storage" });
    expect(board.hasUnpersistedChanges).toBe(true);
    expect(errors.length).toBe(1);
    expect(board.pendingUpdate()).toBeInstanceOf(Uint8Array);
    await expect(board.acknowledgeSync(0)).rejects.toMatchObject({ code:"storage" });
    await expect(board.close()).rejects.toMatchObject({ code:"storage" });
    expect(board.status).toBe("ready");

    h.fail(false);
    const retried = await board.saveLocal();
    expect(retried).toMatchObject({ needsSync:true });
    expect(board.hasUnpersistedChanges).toBe(false);
    await board.close();
    a.doc.destroy();

    const reopenedDoc = yDoc();
    const reopened = createLocalYjsBoardSession({
      documentId:"unsafe", document:reopenedDoc.port, storage:h.storage,
    });
    await reopened.initialize();
    expect(reopenedDoc.records.has("not-on-disk")).toBe(true);
    reopenedDoc.doc.destroy();
  });

  it("rejects a corrupt local checkpoint and never silently creates an empty board", async () => {
    const h = mmkvStorage();
    const a = yDoc();
    const controller = createLocalYjsBoardSession({
      documentId:"damaged",document:a.port,storage:h.storage,
    });
    await controller.initialize();
    const key = [...h.map.keys()][0]!;
    h.map.set(key, new ArrayBuffer(2));
    const fresh = yDoc();
    await expect(createLocalYjsBoardSession({
      documentId:"damaged",document:fresh.port,storage:h.storage,
    }).initialize()).rejects.toThrow(/truncated/);
    a.doc.destroy(); fresh.doc.destroy();
  });
});
