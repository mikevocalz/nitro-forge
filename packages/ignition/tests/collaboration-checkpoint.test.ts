import { afterEach, expect, it, vi } from "vitest";
import { CliHost } from "../src/host-cli";
import { DocumentCollaboration, type CollaborationTransport, type RemoteRevision } from "../src/collaboration";
import { createCollaborationCheckpointStore, ownCollaborationCheckpoint } from "../src/collaboration-checkpoint";
import type { EngineKind } from "../src/types";

const hosts: CliHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(h => h.dispose())); });
function host() { const h = new CliHost(); hosts.push(h); return h; }
function fixture() {
  let raw: Uint8Array | undefined, remote: RemoteRevision | undefined, fail = false, lose = false, uploads = 0;
  const store = createCollaborationCheckpointStore({ async read() { return raw; }, async write(_key, value) {
    if (fail) throw new Error("disk unavailable"); raw = value.slice();
  } });
  const transport: CollaborationTransport = {
    async read() { return remote && { ...remote, bytes: remote.bytes.slice() }; },
    async compareAndSwap(_id, base, checkpoint) {
      if ((remote?.revision ?? 0) !== base) return { accepted: false, current: remote! };
      uploads++; remote = { ...checkpoint, bytes: checkpoint.bytes.slice(), revision: base + 1 };
      if (lose) { lose = false; throw new Error("ACK lost"); }
      return { accepted: true, revision: remote.revision };
    },
  };
  return { store, transport, loseAck() { lose = true; }, failWrite() { fail = true; },
    get bytes() { return raw!; }, get uploads() { return uploads; } };
}
async function owner(f: ReturnType<typeof fixture>, kind: EngineKind = "cadence") {
  return DocumentCollaboration.create(host(), kind, "private:document", f.transport,
    [{ op: "new", payload: kind === "prism" ? { width: 4, height: 4 } : kind === "folio" ? { pages: 1 } : {} }]);
}

it("persists a lost acknowledgement and later offline edits across a new engine host", async () => {
  const f = fixture(); const a = await owner(f);
  f.loseAck(); await expect(a.syncNow()).rejects.toThrow("ACK lost");
  await a.apply([{ op: "setTempo", payload: { bpm: 176 } }]);
  await f.store.write("checkpoint", await a.checkpoint()); await a.close();
  const checkpoint = (await f.store.read("checkpoint"))!;
  expect(checkpoint.pending?.matchesCurrent).toBe(false);
  const b = await DocumentCollaboration.recover({ host: host(), transport: f.transport,
    documentId: "private:document", checkpoint });
  await b.syncNow();
  expect(b.state).toMatchObject({ revision: 2, dirty: false }); expect(f.uploads).toBe(2);
  expect((await b.describe<{ tempo_bpm: number }>()).data.tempo_bpm).toBe(176);
});

it("recognizes unchanged Folio uploads even when PDF reserialization differs after recovery", async () => {
  const f = fixture(); const a = await owner(f, "folio");
  f.loseAck(); await expect(a.syncNow()).rejects.toThrow("ACK lost");
  await f.store.write("checkpoint", await a.checkpoint()); await a.close();
  const b = await DocumentCollaboration.recover({ host: host(), transport: f.transport,
    documentId: "private:document", checkpoint: (await f.store.read("checkpoint"))! });
  await b.syncNow(); expect(f.uploads).toBe(1); expect(b.state).toMatchObject({ revision: 1, dirty: false });
});

it("retains the last good checkpoint on storage failure and detects revision/data corruption", async () => {
  const f = fixture(); const a = await owner(f); await a.syncNow();
  await f.store.write("checkpoint", await a.checkpoint()); const previous = f.bytes.slice();
  await a.apply([{ op: "setTempo", payload: { bpm: 140 } }]); f.failWrite();
  await expect(f.store.write("checkpoint", await a.checkpoint())).rejects.toThrow("disk unavailable");
  expect(f.bytes).toEqual(previous); expect((await f.store.read("checkpoint"))!.dirty).toBe(false);
  f.bytes[6] ^= 1;
  await expect(f.store.read("checkpoint")).rejects.toThrow("Corrupt");
});

it("owns both persisted frames and keeps all seven engine identities stable", async () => {
  for (const kind of ["prism", "cadence", "splice", "folio", "pitch", "tally", "quill"] as EngineKind[]) {
    const f = fixture(); const a = await owner(f, kind); const value = await a.checkpoint();
    const writing = f.store.write("checkpoint", value); value.bytes.fill(0); await writing;
    const read = (await f.store.read("checkpoint"))!; expect(read.kind).toBe(kind);
    read.bytes.fill(0); expect((await f.store.read("checkpoint"))!.bytes[0]).toBe(78);
    await a.close();
  }
});

it("rejects metadata aliases and cross-document recovery before allocating native resources", async () => {
  const f = fixture(); const a = await owner(f); const checkpoint = await a.checkpoint();
  expect(() => ownCollaborationCheckpoint({ ...checkpoint, kind: "toString" as never })).toThrow("metadata");
  expect(() => ownCollaborationCheckpoint({ ...checkpoint, dirty: false })).toThrow("metadata");
  const h = host(), open = vi.spyOn(h, "open");
  await expect(DocumentCollaboration.recover({ host: h, transport: f.transport, documentId: "another:document", checkpoint }))
    .rejects.toThrow("another");
  expect(open).not.toHaveBeenCalled();
});

it("closes an unpublished engine when a framed checkpoint fails semantic restoration", async () => {
  const f = fixture(); const a = await owner(f); const original = await a.checkpoint();
  const bytes = new Uint8Array([78,70,68,49,0,1,0,0,0,123]);
  const h = host(), close = vi.spyOn(h, "close");
  await expect(DocumentCollaboration.recover({ host: h, transport: f.transport, documentId: original.documentId,
    checkpoint: { ...original, bytes } })).rejects.toBeInstanceOf(Error);
  expect(close).toHaveBeenCalledTimes(1);
});

it("yields during large CRC work and owns input before asynchronous storage", async () => {
  const payload = new TextEncoder().encode(JSON.stringify({ padding: "a".repeat(2 * 1024 * 1024) }));
  const bytes = new Uint8Array(9 + payload.length); bytes.set([78,70,68,49,0]);
  new DataView(bytes.buffer).setUint32(5, payload.length, true); bytes.set(payload, 9);
  const f = fixture(); let yielded = false;
  const timer = setTimeout(() => { yielded = true; }, 0);
  const write = f.store.write("large", { version: 1, documentId: "private:large", kind: "cadence", revision: 0, dirty: true, bytes });
  bytes.fill(0); await write; clearTimeout(timer);
  expect(yielded).toBe(true); expect((await f.store.read("large"))!.bytes[0]).toBe(78);
});
