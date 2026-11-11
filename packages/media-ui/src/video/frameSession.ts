import { createStore, type StoreApi } from "zustand/vanilla";
import type { DecodedFrame, MediaDecoder } from "@nyc-tron/platform-services/media";

export interface VideoMonitorState {
  readonly status: "loading" | "ready" | "error" | "closed";
  readonly playing: boolean;
  readonly playbackTimeUs: number;
  readonly bufferedTimeUs: number;
  readonly durationUs: number;
  readonly requestedIndex: number | null;
  /** Current source-index load admission, never a native resource handle. */
  readonly pendingIndexToken: number | null;
  /** Set only from a decoder result whose real presentation time matches the index. */
  readonly decoded: { readonly index: number; readonly frame: DecodedFrame } | null;
  readonly error: string | null;
}
export const createVideoMonitorStore = (): StoreApi<VideoMonitorState> => createStore(() => ({
  status: "loading", playing: false, playbackTimeUs: 0, bufferedTimeUs: 0,
  durationUs: 0, requestedIndex: null, pendingIndexToken: null, decoded: null, error: null,
}));

/** A real presentation-time index, supplied by the source/container owner. No FPS extrapolation. */
export function presentationIndex(times: readonly number[]): readonly number[] {
  if (!times.length || times.length > 200_000) throw new RangeError("Presentation index must contain 1...200000 frames");
  let previous = -1;
  for (const time of times) {
    if (!Number.isSafeInteger(time) || time <= previous) throw new RangeError("Presentation times must be distinct, increasing nonnegative integer microseconds");
    previous = time;
  }
  return Object.freeze([...times]);
}

export function indexAtTime(times: readonly number[], timeUs: number): number {
  let low = 0, high = times.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (times[mid]! <= timeUs) low = mid + 1; else high = mid;
  }
  return Math.max(0, low - 1);
}

export interface FrameTransport { pause(): Promise<void>; seekTo(seconds: number): Promise<void> }
export type FrameResult = { readonly kind: "decoded"; readonly frame: DecodedFrame; readonly index: number } | { readonly kind: "superseded" };
export interface FrameSession {
  readonly timesUs: readonly number[];
  preview(index: number): Promise<FrameResult>;
  commit(index: number): Promise<FrameResult>;
  close(): void;
}

type Request = {
  readonly generation: number; readonly index: number; readonly final: boolean;
  readonly resolve: (result: FrameResult) => void; readonly reject: (error: unknown) => void;
};

/** One decode in flight, one replaceable pending request, and a checked final presentation time. */
export function createFrameSession(options: {
  readonly uri: string;
  readonly timesUs: readonly number[];
  readonly decoder: Pick<MediaDecoder, "decodeFrame"> & {
    readonly indexedFrameVersion?: 1;
    decodeIndexedFrame?(uri: string, options: Parameters<MediaDecoder["decodeFrame"]>[1]): ReturnType<MediaDecoder["decodeFrame"]>;
  };
  readonly transport: FrameTransport;
  readonly store: StoreApi<VideoMonitorState>;
}): FrameSession {
  const timesUs = presentationIndex(options.timesUs);
  let generation = 0, closed = false, running = false;
  const cancellation = new AbortController();
  let pending: Request | null = null;
  let active: Request | null = null;
  const current = (request: Request) => !closed && request.generation === generation;
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (pending && !closed) {
        const request: Request = pending;
        active = request;
        pending = null;
        try {
          await options.transport.pause();
          if (!current(request)) { request.resolve({ kind: "superseded" }); continue; }
          options.store.setState({ playing: false });
          if (!current(request)) { request.resolve({ kind: "superseded" }); continue; }
          const timeUs = timesUs[request.index]!;
          if (request.final) await options.transport.seekTo(timeUs / 1_000_000);
          if (!current(request)) { request.resolve({ kind: "superseded" }); continue; }
          const requestOptions = { timeUs, signal: cancellation.signal };
          const decoder = options.decoder;
          const frame = decoder.indexedFrameVersion === 1 && typeof decoder.decodeIndexedFrame === "function"
            ? await decoder.decodeIndexedFrame(options.uri, requestOptions)
            : await decoder.decodeFrame(options.uri, requestOptions);
          if (!current(request)) { request.resolve({ kind: "superseded" }); continue; }
          if (frame.timing !== "presentation" || frame.actualTimeUs !== timeUs) {
            throw new Error(`Decoder returned ${frame.actualTimeUs}us (${frame.timing}); frame ${request.index} requires ${timeUs}us`);
          }
          options.store.setState({ status: "ready", requestedIndex: null, decoded: { index: request.index, frame }, error: null });
          if (!current(request)) { request.resolve({ kind: "superseded" }); continue; }
          request.resolve({ kind: "decoded", index: request.index, frame });
        } catch (error) {
          if (!current(request)) { request.resolve({ kind: "superseded" }); continue; }
          options.store.setState({ status: "error", requestedIndex: null, error: error instanceof Error ? error.message : String(error) });
          if (!current(request)) { request.resolve({ kind: "superseded" }); continue; }
          request.reject(error);
        } finally { active = null; }
      }
    } finally { running = false; }
  }
  function request(index: number, final: boolean): Promise<FrameResult> {
    if (closed) return Promise.reject(Error("Frame session is closed"));
    if (!Number.isSafeInteger(index) || index < 0 || index >= timesUs.length) return Promise.reject(RangeError("Frame index is outside this source"));
    const ticket = ++generation;
    pending?.resolve({ kind: "superseded" });
    const result = new Promise<FrameResult>((resolve, reject) => { pending = { generation: ticket, index, final, resolve, reject }; });
    options.store.setState({ requestedIndex: index, error: null });
    void drain();
    return result;
  }
  return {
    timesUs,
    preview: index => request(index, false),
    commit: index => request(index, true),
    close() {
      if (closed) return;
      closed = true; generation++; cancellation.abort();
      pending?.resolve({ kind: "superseded" }); active?.resolve({ kind: "superseded" }); pending = null;
      options.store.setState({ status: "closed", playing: false, requestedIndex: null });
      // The decoder's bounded cache is shared. A monitor must not delete another monitor's outputs.
    },
  };
}
