import { expect, it, vi } from "vitest";
import { DocumentHandle } from "../src/document";
import { NitroHost, type ForgeDocumentNative } from "../src/host";

function setup() {
  const native: ForgeDocumentNative = {
    apply: vi.fn(async () => ({ dataJson: "{}", events: [] })),
    restore: vi.fn(async () => {}), snapshot: vi.fn(async () => new ArrayBuffer(0)),
    undo: vi.fn(async () => false), redo: vi.fn(async () => false),
    close: vi.fn(async () => {}),
  };
  return { native, host: new NitroHost({ open: async () => native }) };
}

it("closes an unpublished failed initialization exactly once", async () => {
  const { host, native } = setup();
  const failure = new Error("invalid import");
  await expect(DocumentHandle.openInitialized(host, "quill", async () => { throw failure; }))
    .rejects.toBe(failure);
  expect(native.close).toHaveBeenCalledTimes(1);
  await host.dispose();
  expect(native.close).toHaveBeenCalledTimes(1);
});

it("keeps a successfully initialized session alive until its owner closes", async () => {
  const { host, native } = setup();
  const handle = await DocumentHandle.openInitialized(host, "cadence", d => d.apply("new"));
  expect(native.apply).toHaveBeenCalledTimes(1);
  expect(native.close).not.toHaveBeenCalled();
  await handle.close();
  expect(native.close).toHaveBeenCalledTimes(1);
});

it("retains initialization and cleanup failures for diagnosis", async () => {
  const { host, native } = setup();
  vi.mocked(native.close).mockRejectedValue(new Error("close failed"));
  const failure = new Error("restore failed");
  await expect(DocumentHandle.openInitialized(host, "prism", async () => { throw failure; }))
    .rejects.toMatchObject({ cause: failure, errors: [failure, expect.any(Error)] });
});
