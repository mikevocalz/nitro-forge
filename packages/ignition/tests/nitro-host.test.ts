import { describe, expect, it, vi } from "vitest";
import { EngineError } from "../src/types";
import { assertSafeEngineHandle, NitroHost, type ForgeNitro } from "../src/host";

function bridge(openHandle = 1) {
  const methods = {
    openEngine: vi.fn(async (_kind: string) => openHandle),
    applyJson: vi.fn(async (_handle: number, _commandJson: string) =>
      JSON.stringify({ ok: true, data: { ok: true }, events: [] })),
    snapshotB64: vi.fn(async (_handle: number) => "TkZEMQ=="),
    restoreB64: vi.fn(async (_handle: number, _bytes: string) => {}),
    undo: vi.fn(async (_handle: number) => true),
    redo: vi.fn(async (_handle: number) => true),
    closeEngine: vi.fn(async (_handle: number) => true),
  } satisfies ForgeNitro;
  return methods;
}

describe("NitroHost native Rust u64 handle boundary", () => {
  it("accepts positive exact integers and rejects unsafe or malformed handles", () => {
    for (const handle of [1, 42, Number.MAX_SAFE_INTEGER]) {
      expect(() => assertSafeEngineHandle(handle)).not.toThrow();
    }
    for (const handle of [0, -1, 1.25, Number.NaN, Infinity,
      Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertSafeEngineHandle(handle)).toThrowError(EngineError);
    }
  });

  it("rejects an unsafe native open result, instead of silently rounding a document ID", async () => {
    const methods = bridge(Number.MAX_SAFE_INTEGER + 1);
    await expect(new NitroHost(methods).open("prism")).rejects.toMatchObject({
      code: "validation", recoverable: false,
    });
    expect(methods.applyJson).not.toHaveBeenCalled();
  });

  it("blocks stale/unsafe handles before invoking native engine operations", async () => {
    const methods = bridge();
    const host = new NitroHost(methods);
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    await expect(host.apply(unsafe, { op: "new", payload: {} })).rejects.toBeInstanceOf(EngineError);
    await expect(host.snapshot(unsafe)).rejects.toBeInstanceOf(EngineError);
    await expect(host.restore(unsafe, new Uint8Array([1]))).rejects.toBeInstanceOf(EngineError);
    await expect(host.close(unsafe)).rejects.toBeInstanceOf(EngineError);
    // Every EngineHost method is async: invalid input rejects, never throws synchronously.
    await expect(host.undo(unsafe)).rejects.toBeInstanceOf(EngineError);
    await expect(host.redo(unsafe)).rejects.toBeInstanceOf(EngineError);
    expect(methods.applyJson).not.toHaveBeenCalled();
    expect(methods.snapshotB64).not.toHaveBeenCalled();
    expect(methods.restoreB64).not.toHaveBeenCalled();
    expect(methods.undo).not.toHaveBeenCalled();
    expect(methods.redo).not.toHaveBeenCalled();
    expect(methods.closeEngine).not.toHaveBeenCalled();
  });

  it("fails closed on malformed or status-free native command frames", async () => {
    const methods = bridge(9);
    const host = new NitroHost(methods);
    for (const raw of ["{not json", "null", "{}", JSON.stringify({
      ok: true, data: { ok: true }, events: [{ bogus: "missing kind" }],
    })]) {
      methods.applyJson.mockResolvedValueOnce(raw);
      await expect(host.apply(9, { op: "describe" })).rejects.toMatchObject({
        code: "internal", recoverable: false,
      });
    }
  });

  it("keeps the existing v1 happy path and engine error semantics", async () => {
    const methods = bridge(7);
    const host = new NitroHost(methods);
    expect(await host.open("tally")).toBe(7);
    const value = await host.apply<{ ok: boolean }>(7, { op: "new", payload: {} });
    expect(value.data.ok).toBe(true);
    methods.applyJson.mockResolvedValueOnce(JSON.stringify({
      ok: false, error: { code: "validation", message: "bad input", recoverable: true },
    }));
    await expect(host.apply(7, { op: "setCell", payload: {} })).rejects.toMatchObject({
      code: "validation", recoverable: true,
    });
    expect(await host.close(7)).toBe(true);
  });

  it("maps native rejections from every method to EngineError", async () => {
    const shaped = () => Promise.reject(new Error(
      'native: {"code":"not_found","message":"no such document","recoverable":false}',
    ));
    const methods = bridge(5);
    const host = new NitroHost(methods);
    methods.openEngine.mockImplementationOnce(shaped);
    methods.snapshotB64.mockImplementationOnce(shaped);
    methods.restoreB64.mockImplementationOnce(shaped);
    methods.undo.mockImplementationOnce(shaped);
    methods.redo.mockImplementationOnce(shaped);
    methods.closeEngine.mockImplementationOnce(shaped);
    const expected = { code: "not_found", recoverable: false };
    await expect(host.open("prism")).rejects.toMatchObject(expected);
    await expect(host.snapshot(5)).rejects.toMatchObject(expected);
    await expect(host.restore(5, new Uint8Array([1]))).rejects.toMatchObject(expected);
    await expect(host.undo(5)).rejects.toMatchObject(expected);
    await expect(host.redo(5)).rejects.toMatchObject(expected);
    await expect(host.close(5)).rejects.toMatchObject(expected);
    methods.undo.mockImplementationOnce(() => Promise.reject(new Error("plain failure")));
    await expect(host.undo(5)).rejects.toMatchObject({ code: "internal", message: "plain failure" });
  });
});
