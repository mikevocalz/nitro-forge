import { afterEach, expect, it } from "vitest";
import { CliHost } from "../src/host-cli";
import { DocumentCollaboration, CollaborationConflict, type CollaborationTransport,
  type RemoteRevision } from "../src/collaboration";
import { ENGINE_KINDS, type EngineKind } from "../src/types";

const hosts: CliHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(h => h.dispose())); });
function provider() {
  let current: RemoteRevision | undefined;
  let loseAck = false;
  let release: (() => void) | undefined;
  let block: Promise<void> | undefined;
  let entering: (() => void) | undefined;
  let entered = Promise.resolve();
  const copy = (r: RemoteRevision): RemoteRevision => ({ ...r, bytes: r.bytes.slice() });
  const transport: CollaborationTransport = {
    async read() { return current && copy(current); },
    async compareAndSwap(_id, base, checkpoint) {
      entering?.();
      await block;
      if ((current?.revision ?? 0) !== base) return { accepted: false, current: copy(current!) };
      current = { ...checkpoint, bytes: checkpoint.bytes.slice(), revision: base + 1 };
      if (loseAck) { loseAck = false; throw new Error("connection lost after persistence"); }
      return { accepted: true, revision: current.revision };
    },
  };
  return { transport, get current() { return current; },
    set(remote: RemoteRevision) { current = copy(remote); },
    loseNextAck() { loseAck = true; },
    pause() {
      entered = new Promise<void>(resolve => { entering = resolve; });
      block = new Promise<void>(resolve => { release = resolve; });
    },
    waiting() { return entered; },
    resume() { release?.(); block = undefined; } };
}
async function session(transport: CollaborationTransport, kind: EngineKind = "cadence") {
  const host = new CliHost(); hosts.push(host);
  return DocumentCollaboration.create(host, kind, "document:one", transport,
    [{ op: "new", payload: kind === "prism" ? { width: 4, height: 4 } : kind === "folio" ? { pages: 1 } : {} }]);
}

it("round-trips every registered engine through owned remote revisions", async () => {
  for (const kind of ENGINE_KINDS) {
    const server = provider(); const a = await session(server.transport, kind);
    const initial = (await a.describe<Record<string, unknown>>()).data;
    expect(await a.undo()).toBe(false);
    expect(await a.syncNow()).toMatchObject({ revision: 1, dirty: false, syncing: false });
    const b = await session(server.transport, kind);
    await b.acceptRemote();
    // A remote restore advances Draft's owner-local stale-input token.
    expect((await b.describe()).data).toEqual(kind === "draft"
      ? { ...initial, source_revision: expect.any(Number) } : initial);
    expect(b.state).toMatchObject({ revision: 1, dirty: false });
    await a.close(); await b.close();
  }
});

it("conflicts preserve local edits and undo, and explicit remote adoption resets history", async () => {
  const server = provider(); const a = await session(server.transport); await a.syncNow();
  const b = await session(server.transport); await b.acceptRemote();
  await a.apply([{ op: "setTempo", payload: { bpm: 140 } }]); await a.syncNow();
  await b.apply([{ op: "setTempo", payload: { bpm: 150 } }]);
  const local = await b.snapshot();
  await expect(b.syncNow()).rejects.toBeInstanceOf(CollaborationConflict);
  expect(await b.snapshot()).toEqual(local);
  expect(b.state).toMatchObject({ revision: 1, dirty: true });
  expect(await b.undo()).toBe(true);
  await b.acceptRemote();
  expect(await b.snapshot()).toEqual(await a.snapshot());
  expect(await b.undo()).toBe(false);
  expect(b.state).toMatchObject({ revision: 2, dirty: false });
});

it("a clean peer adopts a new revision without uploading it again", async () => {
  const server = provider(); const a = await session(server.transport); await a.syncNow();
  const b = await session(server.transport); await b.acceptRemote();
  await a.apply([{ op: "setTempo", payload: { bpm: 160 } }]); await a.syncNow();
  await b.syncNow();
  expect(await b.snapshot()).toEqual(await a.snapshot());
  expect(server.current?.revision).toBe(2);
});

it("recognizes a lost durable ACK without duplicate revision or lost history", async () => {
  const server = provider(); const a = await session(server.transport);
  await a.apply([{ op: "setTempo", payload: { bpm: 130 } }]);
  server.loseNextAck();
  await expect(a.syncNow()).rejects.toThrow("connection lost");
  expect(a.state).toMatchObject({ revision: 0, dirty: true });
  await a.syncNow();
  expect(server.current?.revision).toBe(1);
  expect(a.state).toMatchObject({ revision: 1, dirty: false });
  expect(await a.undo()).toBe(true);
});

it("shares sync work, queues owned edits, and drains accepted work on close", async () => {
  const server = provider(); const a = await session(server.transport);
  server.pause(); const sync = a.syncNow(); expect(a.syncNow()).toBe(sync);
  const command = [{ op: "setTempo", payload: { bpm: 135 } }];
  const edit = a.apply(command); command[0]!.payload.bpm = 199;
  const close = a.close();
  await expect(a.apply([{ op: "describe" }])).rejects.toThrow("closing");
  server.resume(); await sync; await edit; await close;
  expect(a.state).toMatchObject({ dirty: true, closed: true });
  expect(a.close()).toBe(close);
});

it("rejects corrupt, foreign and backwards remote snapshots without changing state", async () => {
  const server = provider(); const a = await session(server.transport); await a.syncNow();
  const before = await a.snapshot();
  server.set({ revision: 2, kind: "prism", bytes: before });
  await expect(a.syncNow()).rejects.toThrow("engine");
  server.set({ revision: 2, kind: "cadence", bytes: new Uint8Array([1]) });
  await expect(a.acceptRemote()).rejects.toThrow("checkpoint");
  expect(await a.snapshot()).toEqual(before);
  expect(a.state).toMatchObject({ revision: 1, dirty: false });
  server.set({ revision: 0, kind: "cadence", bytes: before });
  await expect(a.acceptRemote()).rejects.toThrow("revision");
});

it("acknowledges only the sent draft when a later edit follows a lost response", async () => {
  const server = provider(); const a = await session(server.transport);
  server.loseNextAck(); await expect(a.syncNow()).rejects.toThrow("connection lost");
  await a.apply([{ op: "setTempo", payload: { bpm: 170 } }]);
  await a.syncNow();
  expect(a.state).toMatchObject({ revision: 2, dirty: false });
  const b = await session(server.transport); await b.acceptRemote();
  expect((await b.describe<{ tempo_bpm: number }>()).data.tempo_bpm).toBe(170);
});

it("retains exact sent Folio bytes across an ambiguous response despite PDF reserialization", async () => {
  const server = provider(); const a = await session(server.transport, "folio");
  server.loseNextAck(); await expect(a.syncNow()).rejects.toThrow("connection lost");
  await a.syncNow();
  expect(a.state).toMatchObject({ revision: 1, dirty: false });
});

it("rejects a compare-and-swap race without losing the local draft or history", async () => {
  const server = provider(); const a = await session(server.transport); await a.syncNow();
  await a.apply([{ op: "setTempo", payload: { bpm: 175 } }]);
  const before = await a.snapshot();
  server.pause(); const sync = a.syncNow();
  await server.waiting();
  server.set({ ...server.current!, revision: 2 }); server.resume();
  await expect(sync).rejects.toBeInstanceOf(CollaborationConflict);
  expect(await a.snapshot()).toEqual(before);
  expect(await a.undo()).toBe(true);
});
