import { describe, expect, it, vi } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import type { NativeForgeWindows } from "./native-transport";
import { WindowsHost } from "./windows-host";

function transport(): NativeForgeWindows {
  return {
    openEngine: vi.fn(async () => "9007199254740993"),
    apply: vi.fn(async () => ({ dataJson: '{"value":42}', events: [] })),
    snapshotB64: vi.fn(async () => "TkZEMQ=="),
    restoreB64: vi.fn(async () => {}),
    undo: vi.fn(async () => true),
    redo: vi.fn(async () => false),
    closeEngine: vi.fn(async () => true),
  };
}

describe("Windows EngineHost transport", () => {
  it("keeps native string tokens exact while exposing safe local numbers", async () => {
    const native = transport();
    const host = new WindowsHost(native);
    const id = await host.open("tally");
    expect(id).toBe(1);
    expect(await host.apply(id, { op: "evaluate", payload: { formula: "=B1" } }))
      .toEqual({ data: { value: 42 }, events: [] });
    expect(native.apply).toHaveBeenCalledWith({
      documentId: "9007199254740993", operation: "evaluate",
      payloadJson: '{"formula":"=B1"}', version: 1,
    });
    await host.dispose();
  });

  it("preserves absent payloads, explicit null, and event details", async () => {
    const native = transport();
    vi.mocked(native.apply).mockResolvedValue({
      dataJson: "null",
      events: [{ kind: "document:changed", detailJson: "" }, { kind: "detail", detailJson: "null" }],
    });
    const host = new WindowsHost(native);
    const id = await host.open("tally");
    const result = await host.apply(id, { op: "workbook" });
    expect(vi.mocked(native.apply).mock.calls[0]?.[0].payloadJson).toBe("");
    expect(result.events).toEqual([{ kind: "document:changed" }, { kind: "detail", detail: null }]);
    await host.apply(id, { op: "workbook", payload: null });
    expect(vi.mocked(native.apply).mock.calls[1]?.[0].payloadJson).toBe("null");
    await host.dispose();
  });

  it("maps Rust errors without losing recoverability", async () => {
    const native = transport();
    vi.mocked(native.apply).mockRejectedValue(new Error(
      'setCell: {"code":"validation","message":"invalid address","recoverable":true}',
    ));
    const host = new WindowsHost(native);
    const id = await host.open("tally");
    await expect(host.apply(id, { op: "setCell" })).rejects.toMatchObject({
      name: "EngineError", code: "validation", message: "invalid address", recoverable: true,
    });
    await host.dispose();
  });

  it("rejects malformed native results instead of treating them as success", async () => {
    const native = transport();
    vi.mocked(native.apply).mockResolvedValue({ dataJson: "not-json", events: [] });
    const host = new WindowsHost(native);
    const id = await host.open("tally");
    await expect(host.apply(id, { op: "workbook" })).rejects.toMatchObject({ code: "internal" });
    await host.dispose();
  });

  it("owns a copy of the selected restore bytes before yielding", async () => {
    const native = transport();
    const host = new WindowsHost(native);
    const id = await host.open("tally");
    const buffer = new Uint8Array([9, 1, 2, 3, 9]);
    const restoring = host.restore(id, buffer.subarray(1, 4));
    buffer.fill(0);
    await restoring;
    expect(native.restoreB64).toHaveBeenCalledWith("9007199254740993", "AQID");
    expect(await host.snapshot(id)).toEqual(new Uint8Array([78, 70, 68, 49]));
    await host.dispose();
  });

  it("does not admit operations after close starts and shares pending close", async () => {
    const native = transport();
    let finish!: (value: boolean) => void;
    vi.mocked(native.closeEngine).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const host = new WindowsHost(native);
    const id = await host.open("tally");
    const closing = host.close(id);
    expect(host.close(id)).toBe(closing);
    await expect(host.apply(id, { op: "workbook" })).rejects.toMatchObject({ code: "not_found" });
    finish(true);
    expect(await closing).toBe(true);
    expect(await host.close(id)).toBe(false);
    expect(native.closeEngine).toHaveBeenCalledTimes(1);
  });

  it("can retry a close that failed before native completion", async () => {
    const native = transport();
    vi.mocked(native.closeEngine).mockRejectedValueOnce(new Error("submission failed"));
    const host = new WindowsHost(native);
    const id = await host.open("tally");
    await expect(host.close(id)).rejects.toBeInstanceOf(EngineError);
    expect(await host.close(id)).toBe(true);
    expect(native.closeEngine).toHaveBeenCalledTimes(2);
  });

  it("closes an open that finishes after dispose started", async () => {
    const native = transport();
    let finish!: (value: string) => void;
    vi.mocked(native.openEngine).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const host = new WindowsHost(native);
    const opening = host.open("tally");
    const disposing = host.dispose();
    expect(host.dispose()).toBe(disposing);
    finish("18446744073709551614");
    await expect(opening).rejects.toThrow("disposed");
    await disposing;
    expect(native.closeEngine).toHaveBeenCalledExactlyOnceWith("18446744073709551614");
  });

  it("disposes only documents owned by this host instance", async () => {
    const native = transport();
    vi.mocked(native.openEngine).mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const first = new WindowsHost(native);
    const second = new WindowsHost(native);
    await first.open("tally");
    const secondId = await second.open("tally");
    await first.dispose();
    expect(native.closeEngine).toHaveBeenCalledExactlyOnceWith("first");
    expect(await second.undo(secondId)).toBe(true);
    await second.dispose();
  });

  it("returns promise rejections for invalid IDs and a disposed host", async () => {
    const host = new WindowsHost(transport());
    const undo = host.undo(Number.MAX_SAFE_INTEGER + 1);
    const redo = host.redo(0);
    const close = host.close(NaN);
    await expect(undo).rejects.toMatchObject({ code: "validation" });
    await expect(redo).rejects.toMatchObject({ code: "validation" });
    await expect(close).rejects.toMatchObject({ code: "validation" });
    await host.dispose();
    await expect(host.open("tally")).rejects.toThrow("disposed");
  });
});
