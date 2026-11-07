import { describe, expect, it, vi } from "vitest";
import { NitroHost, normalizeNativeEngineError, type ForgeDocumentNative } from "../src/host";
import { EngineError } from "../src/types";

function document(): ForgeDocumentNative {
  return {
    apply: vi.fn(async () => ({ dataJson: '{"ok":true}', events: [{ kind: 'document:changed', detailJson: '{"id":1}' }] })),
    snapshot: vi.fn(async () => new Uint8Array([78, 70, 68, 49]).buffer),
    restore: vi.fn(async () => {}),
    undo: vi.fn(async () => true), redo: vi.fn(async () => false), close: vi.fn(async () => {}),
  };
}

describe('Nitro v1 host', () => {
  it('preserves actual v1 envelope and legacy Rust error codes and recoverability', () => {
    expect(normalizeNativeEngineError(new Error('__batch: {"ok":false,"error":{"code":"validation","message":"bad tempo","recoverable":true}}')))
      .toMatchObject({ code: 'validation', message: 'bad tempo', recoverable: true });
    expect(normalizeNativeEngineError(new Error('snapshot: Serialization: truncated')))
      .toMatchObject({ code: 'serialization', message: 'truncated', recoverable: true });
    expect(normalizeNativeEngineError(new Error('applyBinary: {"ok":false,"error":{"code":"cancelled","message":"task cancelled","recoverable":true}}')))
      .toMatchObject({ code: 'cancelled', recoverable: true });
    expect(normalizeNativeEngineError(new Error('open: Internal: panic')))
      .toMatchObject({ code: 'internal', recoverable: false });
    expect(normalizeNativeEngineError(new Error('restore: Validation: Internal: document label')))
      .toMatchObject({ code: 'validation', message: 'Internal: document label', recoverable: true });
    expect(normalizeNativeEngineError(new Error('{"code":"future","message":"unknown","recoverable":true}')))
      .toMatchObject({ code: 'internal', recoverable: false });
  });
  it('adapts typed commands, results and events', async () => {
    const doc = document(); const host = new NitroHost({ open: async () => doc });
    const handle = await host.open('tally');
    expect(await host.apply(handle, { op: 'new', payload: {}, v: 1 })).toEqual({ data: { ok: true }, events: [{ kind: 'document:changed', detail: { id: 1 } }] });
    expect(doc.apply).toHaveBeenCalledWith({ op: 'new', payloadJson: '{}', v: 1 });
    expect(await host.undo(handle)).toBe(true); expect(await host.redo(handle)).toBe(false);
  });
  it('transfers binary snapshots and only the selected restore view', async () => {
    const doc = document(); const host = new NitroHost({ open: async () => doc }); const h = await host.open('prism');
    expect([...await host.snapshot(h)]).toEqual([78, 70, 68, 49]);
    await host.restore(h, new Uint8Array([9, 1, 2, 9]).subarray(1, 3));
    expect([...new Uint8Array(vi.mocked(doc.restore).mock.calls[0]![0])]).toEqual([1, 2]);
  });
  it('closes once and rejects unknown handles', async () => {
    const doc = document(); const host = new NitroHost({ open: async () => doc }); const h = await host.open('quill');
    expect(await host.close(h)).toBe(true); expect(await host.close(h)).toBe(false);
    await expect(host.apply(h, { op: 'describe' })).rejects.toMatchObject({ code: 'not_found' });
    expect(doc.close).toHaveBeenCalledTimes(1);
  });
  it('normalizes native errors for all operations', async () => {
    const doc = document(); vi.mocked(doc.snapshot).mockRejectedValue(new Error('native: {"code":"serialization","message":"bad","recoverable":true}'));
    const host = new NitroHost({ open: async () => doc }); const h = await host.open('folio');
    await expect(host.snapshot(h)).rejects.toBeInstanceOf(EngineError);
    await expect(host.snapshot(h)).rejects.toMatchObject({ code: 'serialization', recoverable: true });
  });
  it('disposes all documents and refuses new opens', async () => {
    const docs = [document(), document()]; const host = new NitroHost({ open: async () => docs.shift()! });
    const first = docs[0]!; const second = docs[1]!;
    await host.open('prism'); await host.open('tally'); await host.dispose(); await host.dispose();
    expect(first.close).toHaveBeenCalledTimes(1); expect(second.close).toHaveBeenCalledTimes(1);
    await expect(host.open('prism')).rejects.toThrow('disposed');
  });
  it('closes sessions that finish opening during disposal', async () => {
    let finish!: (doc: ForgeDocumentNative) => void;
    const host = new NitroHost({ open: () => new Promise(resolve => { finish = resolve; }) });
    const opening = host.open('splice'); const rejection = expect(opening).rejects.toThrow('disposed');
    const disposing = host.dispose(); const doc = document(); finish(doc);
    await rejection; await disposing; expect(doc.close).toHaveBeenCalledTimes(1);
  });
  it('coalesces disposal and waits for an already-closing document', async () => {
    let finish!: () => void;
    const doc = document(); vi.mocked(doc.close).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const host = new NitroHost({ open: async () => doc }); const h = await host.open('tally');
    const closing = host.close(h);
    const first = host.dispose(); const second = host.dispose(); expect(first).toBe(second);
    let disposed = false; void first.then(() => { disposed = true; });
    await Promise.resolve(); await Promise.resolve(); expect(disposed).toBe(false);
    finish(); await closing; await first; expect(disposed).toBe(true);
  });

});
