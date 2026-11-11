import { describe, expect, it, vi } from "vitest";
import { createFrameSession, createVideoMonitorStore, indexAtTime, presentationIndex } from "../src/video/frameSession";

const frame = (actualTimeUs: number, timing: "presentation" | "seek-target" = "presentation") => ({ uri: `file:///frame-${actualTimeUs}.jpg`, actualTimeUs, timing, width: 192, height: 128 });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(decodeFrame = vi.fn(async (_uri: string, request: { timeUs: number }) => frame(request.timeUs))) {
  const store = createVideoMonitorStore();
  const transport = { pause: vi.fn(async () => {}), seekTo: vi.fn(async (_seconds: number) => {}) };
  const session = createFrameSession({ uri: "file:///source.mp4", timesUs: [0, 40_000, 90_000, 150_000], decoder: { decodeFrame }, transport, store });
  return { session, store, transport, decodeFrame };
}

describe("presentation-index frame ownership", () => {
  it("accepts variable presentation intervals and protects the index from caller mutation", () => {
    const source = [0, 40_000, 90_000, 150_000];
    const index = presentationIndex(source);
    source[1] = 5;
    expect(index[1]).toBe(40_000);
    expect(indexAtTime(index, 89_999)).toBe(1);
    expect(indexAtTime(index, 90_000)).toBe(2);
    for (const bad of [[], [0, 0], [-1], [1.5], [3, 2]]) expect(() => presentationIndex(bad)).toThrow(RangeError);
  });
  it("seeks to the indexed timestamp, then reports only an exact native presentation result", async () => {
    const { session, store, transport } = setup();
    const result = await session.commit(2);
    expect(result.kind).toBe("decoded");
    expect(transport.seekTo).toHaveBeenCalledWith(.09);
    expect(store.getState().decoded?.frame.actualTimeUs).toBe(90_000);
    expect(store.getState().requestedIndex).toBeNull();
  });
  it("coalesces drag bursts and prevents a late decode from overwriting the final frame", async () => {
    const first = deferred<ReturnType<typeof frame>>();
    const decode = vi.fn(async (_uri: string, request: { timeUs: number }) => request.timeUs === 0 ? first.promise : frame(request.timeUs));
    const { session, store, transport } = setup(decode);
    const a = session.preview(0);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    const b = session.preview(1), c = session.preview(2), final = session.commit(3);
    first.resolve(frame(0));
    expect(await a).toEqual({ kind: "superseded" });
    expect(await b).toEqual({ kind: "superseded" });
    expect(await c).toEqual({ kind: "superseded" });
    expect((await final).kind).toBe("decoded");
    expect(decode.mock.calls.map(([, request]) => request.timeUs)).toEqual([0, 150_000]);
    expect(transport.seekTo.mock.calls).toEqual([[.15]]);
    expect(store.getState().decoded?.index).toBe(3);
  });
  it("does not publish an obsolete failure and continues the queued final commit", async () => {
    const first = deferred<ReturnType<typeof frame>>();
    const { session, store, decodeFrame } = setup(vi.fn(async (_uri: string, request: { timeUs: number }) => request.timeUs === 0 ? first.promise : frame(request.timeUs)));
    const old = session.preview(0);
    await vi.waitFor(() => expect(decodeFrame).toHaveBeenCalledTimes(1));
    const final = session.commit(2);
    first.reject(Error("Obsolete codec error"));
    expect(await old).toEqual({ kind: "superseded" });
    await final;
    expect(store.getState().error).toBeNull();
    expect(store.getState().decoded?.index).toBe(2);
  });
  it.each([frame(89_999), frame(90_000, "seek-target")])("rejects approximate or browser seek evidence", async result => {
    const { session, store } = setup(vi.fn(async () => result));
    await expect(session.commit(2)).rejects.toThrow("requires 90000us");
    expect(store.getState().decoded).toBeNull();
    expect(store.getState().status).toBe("error");
  });
  it("settles waiters on close and ignores a codec result that arrives after unmount", async () => {
    const pending = deferred<ReturnType<typeof frame>>();
    const { session, store, decodeFrame } = setup(vi.fn(async () => pending.promise));
    const active = session.preview(0);
    await vi.waitFor(() => expect(decodeFrame).toHaveBeenCalledTimes(1));
    const queued = session.commit(2);
    session.close(); session.close();
    expect(await active).toEqual({ kind: "superseded" });
    expect(await queued).toEqual({ kind: "superseded" });
    pending.resolve(frame(0));
    await Promise.resolve(); await Promise.resolve();
    expect(store.getState().status).toBe("closed");
    expect(store.getState().decoded).toBeNull();
    await expect(session.commit(0)).rejects.toThrow("closed");
  });
  it("preserves a newer request submitted synchronously by a store subscriber", async () => {
    const { session, store, decodeFrame } = setup();
    let final: ReturnType<typeof session.commit> | undefined;
    const unsubscribe = store.subscribe(state => {
      if (state.requestedIndex === 0 && !final) final = session.commit(2);
    });
    const old = session.preview(0);
    expect(await old).toEqual({ kind: "superseded" });
    expect((await final!).kind).toBe("decoded");
    expect(decodeFrame.mock.calls.map(([, request]) => request.timeUs)).toEqual([90_000]);
    unsubscribe();
  });
  it("rejects a failed transport operation without starting a decode", async () => {
    const { session, transport, decodeFrame } = setup();
    transport.seekTo.mockRejectedValueOnce(Error("Released transport"));
    await expect(session.commit(1)).rejects.toThrow("Released transport");
    expect(decodeFrame).not.toHaveBeenCalled();
    await expect(session.commit(1)).resolves.toMatchObject({ kind: "decoded", index: 1 });
  });
  it("supersedes a decoded acknowledgement when a subscriber requests the next frame", async () => {
    const { session, store } = setup();
    let final: ReturnType<typeof session.commit> | undefined;
    const unsubscribe = store.subscribe(state => {
      if (state.decoded?.index === 0 && state.requestedIndex === null && !final)
        final = session.commit(2);
    });
    expect(await session.preview(0)).toEqual({ kind: "superseded" });
    expect(await final!).toMatchObject({ kind: "decoded", index: 2 });
    expect(store.getState().decoded?.index).toBe(2);
    unsubscribe();
  });
  it("supersedes an error acknowledgement when a subscriber retries synchronously", async () => {
    const { session, store } = setup(vi.fn(async (_uri: string, request: { timeUs: number }) => {
      if (request.timeUs === 0) throw Error("Retryable decode error");
      return frame(request.timeUs);
    }));
    let final: ReturnType<typeof session.commit> | undefined;
    const unsubscribe = store.subscribe(state => {
      if (state.status === "error" && state.error && !final) final = session.commit(2);
    });
    expect(await session.preview(0)).toEqual({ kind: "superseded" });
    expect(await final!).toMatchObject({ kind: "decoded", index: 2 });
    expect(store.getState().error).toBeNull();
    unsubscribe();
  });

});
