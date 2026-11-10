import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import { DocumentCollaboration, type CollaborationTransport } from "../src/collaboration";
import { createHttpCollaborationTransport } from "../src/collaboration-http";
import type { EngineHost } from "../src/host";

function frame(payload = "{}") {
  const data = Buffer.from(payload), bytes = Buffer.alloc(9 + data.length);
  bytes.set([78, 70, 68, 49, 0]); bytes.writeUInt32LE(data.length, 5); bytes.set(data, 9);
  return bytes;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function host(bytes = frame()) {
  return {
    open: vi.fn(async () => 7), restore: vi.fn(async () => {}), close: vi.fn(async () => true),
    snapshot: vi.fn(async () => bytes),
    apply: vi.fn(async () => ({ data: {}, events: [{ kind: "document:changed" }] })),
    undo: vi.fn(async () => false), redo: vi.fn(async () => false), dispose: vi.fn(async () => {}),
  } as unknown as EngineHost;
}
function transport(): CollaborationTransport {
  return { read: vi.fn(async () => undefined), compareAndSwap: vi.fn(async () => ({ accepted: true, revision: 1 })) };
}

it("owns initialization commands before allocating an asynchronous native session", async () => {
  const h = host(), opening = deferred<number>();
  vi.mocked(h.open).mockReturnValue(opening.promise);
  const commands = [{ op: "setTempo", payload: { bpm: 135 } }];
  const creating = DocumentCollaboration.create(h, "cadence", "document:one", transport(), commands);
  commands[0]!.payload.bpm = 200;
  opening.resolve(7);
  const owner = await creating;
  expect(h.apply).toHaveBeenCalledWith(7, { op: "__batch", payload: { commands: [{ op: "setTempo", payload: { bpm: 135 } }] } });
  await owner.close();
});

it("owns remote Buffer bytes and revision while native restoration is pending", async () => {
  const h = host(), provider = transport(), bytes = frame('{"tempo_bpm":135}');
  const remote = { revision: 1, kind: "cadence" as const, bytes };
  vi.mocked(provider.read).mockResolvedValue(remote);
  const owner = await DocumentCollaboration.create(h, "cadence", "document:one", provider, [{ op: "new" }]);
  const restoring = deferred<void>(), expected = Uint8Array.from(bytes);
  vi.mocked(h.restore).mockClear().mockReturnValue(restoring.promise);
  const adopting = owner.acceptRemote();
  await vi.waitFor(() => expect(h.restore).toHaveBeenCalledOnce());
  remote.bytes.fill(0); remote.revision = 9;
  expect(h.restore).toHaveBeenCalledWith(7, expected);
  restoring.resolve();
  expect(await adopting).toMatchObject({ revision: 1, dirty: false });
  await owner.close();
});

it("keeps ambiguous upload evidence independent of provider-owned Buffer inputs", async () => {
  const bytes = frame(), expected = Uint8Array.from(bytes), h = host(bytes), provider = transport();
  provider.compareAndSwap = async (_id, _base, checkpoint) => {
    checkpoint.bytes.fill(0); // A provider may reuse its input after consuming it.
    throw new Error("response lost");
  };
  const owner = await DocumentCollaboration.create(h, "cadence", "document:one", provider, [{ op: "new" }]);
  await expect(owner.syncNow()).rejects.toThrow("response lost");
  const checkpoint = await owner.checkpoint();
  expect(checkpoint.bytes).toEqual(expected);
  expect(checkpoint.pending?.bytes).toEqual(expected);
  expect(checkpoint.pending?.matchesCurrent).toBe(true);
  await owner.close();
});

it("uploads only an owned Buffer view, excluding unrelated backing allocation bytes", async () => {
  const source = frame(), carrier = Buffer.alloc(64, 99);
  carrier.set(source, 13);
  const view = carrier.subarray(13, 13 + source.length);
  let request!: RequestInit;
  const response = deferred<Response>();
  const fetcher = vi.fn((_input: unknown, init?: RequestInit) => { request = init!; return response.promise; });
  const provider = createHttpCollaborationTransport({ baseUrl: "https://collaboration.example", fetch: fetcher as typeof fetch });
  const uploading = provider.compareAndSwap("document:one", 0, { kind: "cadence", bytes: view });
  carrier.fill(0);
  expect(new Uint8Array(request.body as ArrayBuffer)).toEqual(Uint8Array.from(source));
  response.resolve(new Response(null, { status: 204, headers: { "X-Forge-Revision": "1" } }));
  expect(await uploading).toEqual({ accepted: true, revision: 1 });
});
