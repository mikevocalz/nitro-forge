/** A renderer-owned image lease. Each render returns its own immutable lease. */
export interface XRPresentationFrame {
  readonly revision: number;
  readonly uri: string;
  readonly widthPx: number;
  readonly heightPx: number;
  dispose(): void;
}

/** One committed surface's hold on an image file. Release is idempotent. */
export interface XRImageLease { release(): void }

/**
 * An offered image, distinct from a rendered or presented frame. Viro acquires
 * a lease before mounting its native image and acknowledges actual load events.
 */
export interface XRPresentationImage {
  readonly revision: number;
  readonly uri: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Null if this offer was withdrawn or its presentation was disposed. */
  retain(): XRImageLease | null;
  /** Call only after successful native loading. Ignores stale offers. */
  loaded(): boolean;
  /** Withdraw a failed image. The surface reports its renderer-specific error. */
  failed(): boolean;
}

export interface XRPresentationSource {
  getRevision(): number;
  addOnChangedListener(listener: () => void): { remove(): void };
  /** Must produce the requested immutable revision or reject. Abort may be advisory. */
  renderFrame(revision: number, signal: AbortSignal): Promise<XRPresentationFrame>;
}
export interface XRPresentation {
  refresh(): void;
  /** Withdraws offers. Mounted image leases stay alive until their surfaces detach. */
  dispose(): void;
}
export interface XRPresentationOptions {
  readonly source: XRPresentationSource;
  /** Store this offer; ViroDocumentSurface handles its lease and load acknowledgment. */
  readonly onFrame: (image: XRPresentationImage | null) => void;
  readonly onError: (error: Error) => void;
}

interface ImageEntry {
  frame: XRPresentationFrame;
  image: XRPresentationImage;
  owned: boolean;
  users: number;
  released: boolean;
}
interface RenderRequest { revision: number; controller: AbortController }

/**
 * One running render, one latest requested revision, and at most two owned
 * image files (displayed + loading). Ignored aborts cannot create overlapping
 * renderer work. A new offer blocks further rendering until loading succeeds,
 * fails, or its last mounted surface detaches. No document or XR session is copied.
 */
export function createXRPresentation({ source, onFrame, onError }: XRPresentationOptions): XRPresentation {
  let disposed = false;
  let desired: number | undefined;
  let running: RenderRequest | undefined;
  let current: ImageEntry | undefined;
  let offered: ImageEntry | undefined;
  const releasedFrames = new WeakSet<XRPresentationFrame>();
  const seenFrames = new WeakSet<XRPresentationFrame>();
  const report = (error: unknown) => {
    // A diagnostic callback must not interrupt the remaining resource cleanup.
    try { onError(error instanceof Error ? error : new Error(String(error))); } catch { /* owner callback */ }
  };
  const releaseRaw = (frame: XRPresentationFrame) => {
    if (releasedFrames.has(frame)) return;
    releasedFrames.add(frame);
    try { frame.dispose(); } catch (error) { report(error); }
  };
  const releaseIfUnused = (entry: ImageEntry) => {
    if (!entry.owned && entry.users === 0 && !entry.released) {
      entry.released = true;
      releaseRaw(entry.frame);
    }
  };
  const dropOwnership = (entry: ImageEntry | undefined) => {
    if (!entry) return;
    entry.owned = false;
    releaseIfUnused(entry);
  };
  const notify = (entry: ImageEntry | undefined) => {
    try { onFrame(entry?.image ?? null); return true; }
    catch (error) { report(error); return false; }
  };
  function fail(entry: ImageEntry): boolean {
    if (disposed || entry !== offered && entry !== current) return false;
    const wasOffer = entry === offered;
    if (wasOffer) offered = undefined;
    if (entry === current) current = undefined;
    dropOwnership(entry);
    if (wasOffer || !offered) notify(current);
    pump();
    return true;
  }
  function offer(frame: XRPresentationFrame): ImageEntry {
    const entry: ImageEntry = { frame, image: undefined!, owned: true, users: 0, released: false };
    entry.image = Object.freeze({
      revision: frame.revision, uri: frame.uri, widthPx: frame.widthPx, heightPx: frame.heightPx,
      retain() {
        if (disposed || !entry.owned || entry.released) return null;
        entry.users++;
        let released = false;
        return { release() {
          if (released) return;
          released = true;
          entry.users--;
          releaseIfUnused(entry);
          // An effect replay can reacquire before this turn ends. An actually
          // removed loading surface must not hold the queue forever.
          if (entry.users === 0 && entry === offered) queueMicrotask(() => {
            if (entry.users === 0 && entry === offered) fail(entry);
          });
        } };
      },
      loaded() {
        if (disposed) return false;
        if (entry === current) return true;
        if (entry !== offered) return false;
        const previous = current;
        current = entry;
        offered = undefined;
        dropOwnership(previous);
        pump();
        return !disposed && current === entry;
      },
      failed: () => fail(entry),
    });
    return entry;
  }
  function pump() {
    if (disposed || running || offered || desired === undefined) return;
    const request: RenderRequest = { revision: desired, controller: new AbortController() };
    desired = undefined;
    running = request;
    void Promise.resolve().then(async () => {
      try {
        if (request.controller.signal.aborted) return;
        const frame = await source.renderFrame(request.revision, request.controller.signal);
        if (seenFrames.has(frame)) {
          if (!disposed && !request.controller.signal.aborted) report(new Error('XR renderFrame must return a distinct image lease.'));
          return;
        }
        seenFrames.add(frame);
        if (disposed || request.controller.signal.aborted) { releaseRaw(frame); return; }
        if (frame.revision !== request.revision || !Number.isSafeInteger(frame.widthPx) || !Number.isSafeInteger(frame.heightPx) ||
          frame.widthPx <= 0 || frame.heightPx <= 0 || !/^(file|content|https):\/\//.test(frame.uri)) {
          releaseRaw(frame);
          report(new Error('XR renderer returned an invalid image or a different document revision.'));
          return;
        }
        const entry = offer(frame);
        offered = entry;
        if (!notify(entry)) fail(entry);
      } catch (error) {
        if (!disposed && !request.controller.signal.aborted) report(error);
      } finally {
        if (running === request) running = undefined;
        pump();
      }
    });
  }
  function refresh() {
    if (disposed) return;
    try {
      const revision = source.getRevision();
      if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError('XR presentation revision must be a nonnegative safe integer.');
      desired = revision;
      running?.controller.abort();
      pump();
    } catch (error) { report(error); }
  }
  const subscription = source.addOnChangedListener(refresh);
  refresh();
  return { refresh, dispose() {
    if (disposed) return;
    disposed = true;
    desired = undefined;
    running?.controller.abort();
    const previous = current;
    const candidate = offered;
    current = undefined;
    offered = undefined;
    try { subscription.remove(); } catch (error) { report(error); }
    notify(undefined);
    dropOwnership(candidate);
    dropOwnership(previous);
  } };
}
