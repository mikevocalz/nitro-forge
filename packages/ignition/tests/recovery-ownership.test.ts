import { Buffer } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { createCheckpointStore, DocumentAutosave } from '../src/autosave';
import { createCollaborationCheckpointStore, ownCollaborationCheckpoint } from '../src/collaboration-checkpoint';
import { DocumentHandle } from '../src/document';
import type { EngineHost } from '../src/host';

function frame(payload = '{}') {
  const data = Buffer.from(payload);
  const bytes = Buffer.alloc(9 + data.length);
  bytes.set([78, 70, 68, 49, 0]);
  bytes.writeUInt32LE(data.length, 5); bytes.set(data, 9);
  return bytes;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function host() {
  return {
    open: vi.fn(async () => 7), restore: vi.fn(async () => {}), close: vi.fn(async () => true),
    snapshot: vi.fn(async () => frame()),
    apply: vi.fn(async () => ({ data: {}, events: [{ kind: 'document:changed' }] })),
    undo: vi.fn(async () => false), redo: vi.fn(async () => false), dispose: vi.fn(async () => {}),
  } as unknown as EngineHost;
}
afterEach(() => { vi.useRealTimers(); });

it('detaches a Node Buffer checkpoint record from storage', async () => {
  const source = frame(); const record = Buffer.concat([Buffer.from([78, 70, 67, 49, 1]), source]);
  const store = createCheckpointStore({ read: async () => record, write: async () => {} });
  const owned = (await store.read('doc'))!;
  owned.bytes.fill(0);
  expect(record.subarray(5)).toEqual(source);
});

it('owns recovery Buffer bytes before asynchronous session allocation', async () => {
  const h = host(), allocated = deferred<number>();
  vi.mocked(h.open).mockReturnValue(allocated.promise);
  const bytes = frame(), expected = Uint8Array.from(bytes);
  const recovery = DocumentAutosave.recover(h, 'cadence', { read: async () => ({ kind: 'cadence', bytes }), write: async () => {} }, 'doc');
  await vi.waitFor(() => expect(h.open).toHaveBeenCalledOnce());
  bytes.fill(0); allocated.resolve(7);
  const document = (await recovery)!;
  expect(h.restore).toHaveBeenCalledWith(7, expected);
  await document.close();
});

it('cancels before read, after read, and after open without publishing or leaking a session', async () => {
  const h = host(), read = vi.fn(async () => ({ kind: 'cadence' as const, bytes: frame() }));
  const cancelled = new AbortController(); cancelled.abort('already closed');
  await expect(DocumentAutosave.recover(h, 'cadence', { read, write: async () => {} }, 'doc', cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).not.toHaveBeenCalled(); expect(h.open).not.toHaveBeenCalled();
  const reading = deferred<Awaited<ReturnType<typeof read>>>(), duringRead = new AbortController();
  const readRecovery = DocumentAutosave.recover(h, 'cadence', { read: () => reading.promise, write: async () => {} }, 'doc', duringRead.signal);
  duringRead.abort(); reading.resolve({ kind: 'cadence', bytes: frame() });
  await expect(readRecovery).rejects.toMatchObject({ name: 'AbortError' }); expect(h.open).not.toHaveBeenCalled();
  const allocated = deferred<number>(), duringOpen = new AbortController();
  vi.mocked(h.open).mockReturnValue(allocated.promise);
  const openRecovery = DocumentAutosave.recover(h, 'cadence', { read, write: async () => {} }, 'doc', duringOpen.signal);
  await vi.waitFor(() => expect(h.open).toHaveBeenCalledOnce());
  duringOpen.abort(); allocated.resolve(7);
  await expect(openRecovery).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.restore).not.toHaveBeenCalled(); expect(h.close).toHaveBeenCalledExactlyOnceWith(7);
});

it('closes a recovered session when cancellation arrives during restore', async () => {
  const h = host(), restoring = deferred<void>(), controller = new AbortController();
  vi.mocked(h.restore).mockReturnValue(restoring.promise);
  const recovery = DocumentAutosave.recover(h, 'cadence', { read: async () => ({ kind: 'cadence', bytes: frame() }), write: async () => {} }, 'doc', controller.signal);
  await vi.waitFor(() => expect(h.restore).toHaveBeenCalledOnce());
  controller.abort(); restoring.resolve();
  await expect(recovery).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.close).toHaveBeenCalledExactlyOnceWith(7);
});

it('preserves restoration and cleanup failures together', async () => {
  const h = host(), restoreError = new Error('restore rejected'), closeError = new Error('release rejected');
  vi.mocked(h.restore).mockRejectedValue(restoreError); vi.mocked(h.close).mockRejectedValue(closeError);
  const recovery = DocumentAutosave.recover(h, 'cadence', { read: async () => ({ kind: 'cadence', bytes: frame() }), write: async () => {} }, 'doc');
  const failure = await recovery.catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toEqual([restoreError, closeError]); expect(failure.cause).toBe(restoreError);
  expect(h.close).toHaveBeenCalledOnce();
});

it('does not schedule a debounce after an observer synchronously closes autosave', async () => {
  vi.useFakeTimers();
  const h = host(), document = new DocumentHandle(h, 'cadence', 7);
  const write = vi.fn(async () => {});
  const autosave = new DocumentAutosave(document, { read: async () => undefined, write }, 'doc', 1000);
  let closing: Promise<void> | undefined, requestedClose = false;
  autosave.subscribe(state => { if (state.revision === 1 && !requestedClose) { requestedClose = true; closing = autosave.close(); } });
  await document.apply('edit'); await closing;
  expect(vi.getTimerCount()).toBe(0); expect(write).toHaveBeenCalledOnce();
  await document.close();
});

it('owns local and pending Buffer frames and owns a record before yielding CRC validation', async () => {
  const local = frame(), pending = frame('{"pending":true}');
  const value = { version: 1 as const, kind: 'cadence' as const, documentId: 'private:doc', revision: 1, dirty: true, bytes: local, pending: { bytes: pending, matchesCurrent: false } };
  const owned = ownCollaborationCheckpoint(value);
  local.fill(0); pending.fill(0);
  expect(owned.bytes[0]).toBe(78); expect(owned.pending!.bytes[0]).toBe(78);
  const large = frame(JSON.stringify({ padding: 'a'.repeat(2 * 1024 * 1024) }));
  let record!: Buffer;
  const store = createCollaborationCheckpointStore({ read: async () => record, write: async (_key, bytes) => { record = Buffer.from(bytes); } });
  await store.write('doc', { ...value, bytes: large, pending: undefined });
  const reading = store.read('doc');
  // read() owns the record after its storage await and before the first CRC yield.
  await Promise.resolve(); record.fill(0);
  const recovered = (await reading)!;
  expect(recovered.bytes).toEqual(Uint8Array.from(large));
});
