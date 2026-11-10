import { ENGINE_KINDS, type EngineKind } from "./types";
import { validateCheckpoint } from "./autosave";
import type { CollaborationTransport, RemoteRevision } from "./collaboration";

/** Options for an HTTP transport consumed by DocumentCollaboration. */
export interface HttpCollaborationOptions {
  /** Service origin, using HTTPS except for an explicit local development service. */
  readonly baseUrl: string;
  /** App-owned authorized fetch. Authorization headers never enter document state. */
  readonly fetch?: typeof globalThis.fetch;
  /** Deadline includes response decoding. @default 15000 */
  readonly timeoutMs?: number;
}
/** A revision notification resource created by HttpCollaborationTransport.watch. */
export interface RevisionWatch {
  /** Abort pending network I/O and drain an accepted callback. Idempotent. */
  close(): Promise<void>;
}
/** Notification settings for HttpCollaborationTransport.watch. */
export interface RevisionWatchOptions {
  /** Authorized document to observe. */
  readonly documentId: string;
  /** Last revision already incorporated by the owner. */
  readonly afterRevision: number;
  /** Coalesced revision notification. Typically await the owner's syncNow(). */
  readonly onRevision: (revision: number) => void | Promise<void>;
  /** Explicit policy for failures, including local edit conflicts. */
  readonly onError: (error: unknown) => "retry" | "stop";
  /** Metadata polling period, 250..60000 ms. @default 1000 */
  readonly intervalMs?: number;
}
/** Revision transport with portable native/web metadata notifications. */
export interface HttpCollaborationTransport extends CollaborationTransport {
  /** Polls HEAD metadata, never whole snapshots. Close when the owner leaves. */
  watch(options: RevisionWatchOptions): RevisionWatch;
}
/** A provider/protocol rejection; document payloads and response text are excluded. */
export class CollaborationTransportError extends Error {
  constructor(readonly status: number, message: string) {
    super(message); this.name = "CollaborationTransportError";
  }
}
const CAP = 256 * 1024 * 1024;

/** Binary revision transport. Applications supply their authentication through
 * an authorized fetch. Documents keep their own atomic conflict/history policy.
 * Timed-out writes remain ambiguous until the owner's subsequent sync reads the
 * durable server revision. No automatic retry may overwrite a different base. */
export function createHttpCollaborationTransport(options: HttpCollaborationOptions): HttpCollaborationTransport {
  const base = new URL(options.baseUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new RangeError("A collaboration service requires an HTTP(S) URL without embedded credentials or query");
  if (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(base.hostname))
    throw new RangeError("Nonlocal collaboration services require HTTPS");
  const timeout = options.timeoutMs ?? 15000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300000) throw new RangeError("Invalid collaboration deadline");
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const endpoint = (id: string) => {
    if (!/^[\w.:-]{1,256}$/.test(id)) throw new RangeError("Invalid collaboration document ID");
    return `${base.href.replace(/\/$/, "")}/v1/documents/${encodeURIComponent(id)}`;
  };
  const call = async <T>(id: string, init: RequestInit, decode: (response: Response) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const upstream = init.signal;
    const abort = () => controller.abort();
    if (upstream?.aborted) controller.abort();
    upstream?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeout);
    try { return await decode(await fetcher(endpoint(id), { ...init, signal: controller.signal })); }
    finally { clearTimeout(timer); upstream?.removeEventListener("abort", abort); }
  };
  const revision = (response: Response) => {
    const header = response.headers.get("X-Forge-Revision");
    const value = header && /^\d+$/.test(header) ? Number(header) : NaN;
    if (!Number.isSafeInteger(value) || value < 1)
      throw new CollaborationTransportError(response.status, "Invalid collaboration revision header");
    return value;
  };
  const decode = async (response: Response): Promise<RemoteRevision> => {
    const rawKind = response.headers.get("X-Forge-Engine");
    if (!ENGINE_KINDS.includes(rawKind as EngineKind))
      throw new CollaborationTransportError(response.status, "Invalid collaboration engine header");
    const sizeHeader = response.headers.get("Content-Length");
    const size = sizeHeader && /^\d+$/.test(sizeHeader) ? Number(sizeHeader) : NaN;
    if (!Number.isSafeInteger(size) || size < 9 || size > CAP)
      throw new CollaborationTransportError(response.status, "Invalid collaboration snapshot length");
    const bytes = new Uint8Array(size);
    const reader = response.body?.getReader?.();
    if (reader) {
      let offset = 0;
      try {
        while (true) {
          const item = await reader.read(); if (item.done) break;
          if (offset + item.value.length > size) throw new Error("Collaboration response exceeds declared size");
          bytes.set(item.value, offset); offset += item.value.length;
        }
        if (offset !== size) throw new Error("Truncated collaboration response");
      } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
      finally { reader.releaseLock(); }
    } else {
      // React Native fetch may expose only arrayBuffer. The authorized provider
      // must honor Content-Length; the frame is validated before engine restore.
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.length !== size) throw new Error("Collaboration response length mismatch");
      bytes.set(body);
    }
    validateCheckpoint(bytes);
    return { revision: revision(response), kind: rawKind as EngineKind, bytes };
  };
  return {
    read(id) {
      return call(id, { method: "GET" }, async response => {
        if (response.status === 404) return undefined;
        if (response.status !== 200) throw new CollaborationTransportError(response.status, "Collaboration read rejected");
        return decode(response);
      });
    },
    compareAndSwap(id, baseRevision, checkpoint) {
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0)
        return Promise.reject(new RangeError("Invalid collaboration base revision"));
      if (!ENGINE_KINDS.includes(checkpoint.kind)) return Promise.reject(new RangeError("Invalid collaboration engine"));
      validateCheckpoint(checkpoint.bytes);
      return call(id, { method: "PUT", headers: { "Content-Type": "application/octet-stream",
        "X-Forge-Base-Revision": String(baseRevision), "X-Forge-Engine": checkpoint.kind },
        body: checkpoint.bytes.slice().buffer as ArrayBuffer }, async response => {
        if (response.status === 409) return { accepted: false, current: await decode(response) } as const;
        if (response.status !== 204) throw new CollaborationTransportError(response.status, "Collaboration write rejected");
        const next = revision(response);
        if (next <= baseRevision) throw new CollaborationTransportError(204, "Collaboration acknowledgement did not advance");
        return { accepted: true, revision: next } as const;
      });
    },
    watch(watchOptions) {
      endpoint(watchOptions.documentId);
      const interval = watchOptions.intervalMs ?? 1000;
      if (!Number.isSafeInteger(watchOptions.afterRevision) || watchOptions.afterRevision < 0 ||
          !Number.isSafeInteger(interval) || interval < 250 || interval > 60000)
        throw new RangeError("Invalid revision watch bounds");
      let last = watchOptions.afterRevision, stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let wake: (() => void) | undefined;
      const controller = new AbortController();
      const work = (async () => {
        while (!stopped) {
          try {
            const current = await call(watchOptions.documentId, { method: "HEAD", signal: controller.signal }, async response => {
              if (response.status === 404 && last === 0) return 0;
              if (response.status !== 200) throw new CollaborationTransportError(response.status, "Collaboration watch rejected");
              return revision(response);
            });
            if (stopped) break;
            if (current < last) throw new Error("Remote revision moved backwards");
            if (current > last) { await watchOptions.onRevision(current); last = current; }
          } catch (error) {
            if (stopped) break;
            let policy: "retry" | "stop" = "stop";
            try { policy = watchOptions.onError(error); } catch { /* Stop if the error observer fails. */ }
            if (policy !== "retry") { stopped = true; break; }
          }
          if (!stopped) await new Promise<void>(resolve => {
            wake = resolve; timer = setTimeout(resolve, interval);
          });
        }
      })();
      return { close() { stopped = true; controller.abort(); clearTimeout(timer); wake?.(); return work; } };
    },
  };
}
