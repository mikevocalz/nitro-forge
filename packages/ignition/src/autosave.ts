import { DocumentHandle } from "./document";
import type { EngineHost } from "./host";
import type { EngineKind } from "./types";

// Persisted NFC1 tags are fixed independently of the runtime engine list's
// order. Adding an engine requires an explicit new tag, never renumbering.
const ENGINE_TAGS: Readonly<Record<EngineKind, number>> = {
  prism: 0, cadence: 1, splice: 2, folio: 3, pitch: 4, tally: 5, quill: 6, photo: 7, motion: 8, design: 9,
};
const MAX_CHECKPOINT_BYTES = 256 * 1024 * 1024;
const ENGINES_BY_TAG = new Map(Object.entries(ENGINE_TAGS).map(([kind, tag]) => [tag, kind as EngineKind]));

export interface Checkpoint {
  readonly kind: EngineKind;
  readonly bytes: Uint8Array;
}

/** Providers must replace a checkpoint atomically and retain the last good
 * version if a write rejects. Engine snapshots never perform storage I/O. */
export interface CheckpointStore {
  read(key: string): Promise<Checkpoint | undefined>;
  write(key: string, checkpoint: Checkpoint): Promise<void>;
}

/** Structural boundary implemented by real platform storage adapters. Writes
 * replace a record atomically and retain the previous good record on rejection. */
export interface BinaryCheckpointStorage {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, bytes: Uint8Array): Promise<void>;
}

/** NFC1 adds engine identity around NFD1 without modifying engine snapshots. */
export function createCheckpointStore(storage: BinaryCheckpointStorage): CheckpointStore {
  return {
    async read(key) {
      const bytes = await storage.read(key);
      if (!bytes) return undefined;
      if (bytes.length < 14 || bytes.byteLength > MAX_CHECKPOINT_BYTES + 5 || String.fromCharCode(...bytes.subarray(0, 4)) !== "NFC1")
        throw new Error("Invalid checkpoint record");
      const kind = ENGINES_BY_TAG.get(bytes[4]!);
      if (!kind) throw new Error("Unknown checkpoint engine");
      const snapshot = Uint8Array.from(bytes.subarray(5));
      validateCheckpoint(snapshot);
      return { kind, bytes: snapshot };
    },
    async write(key, checkpoint) {
      validateCheckpoint(checkpoint.bytes);
      if (!Object.hasOwn(ENGINE_TAGS, checkpoint.kind)) throw new Error("Unknown checkpoint engine");
      const kind = ENGINE_TAGS[checkpoint.kind];
      if (kind === undefined) throw new Error("Unknown checkpoint engine");
      const bytes = new Uint8Array(checkpoint.bytes.byteLength + 5);
      bytes.set([78, 70, 67, 49, kind]);
      bytes.set(checkpoint.bytes, 5);
      await storage.write(key, bytes);
    },
  };
}

export interface AutosaveState {
  readonly revision: number;
  readonly savedRevision: number;
  readonly saving: boolean;
  readonly error: unknown;
}

/** Bound and validate the NFD1 framing before persisting or opening a session. */
export function validateCheckpoint(bytes: Uint8Array): void {
  if (bytes.byteLength < 9 || bytes.byteLength > MAX_CHECKPOINT_BYTES ||
      String.fromCharCode(...bytes.subarray(0, 4)) !== "NFD1" || bytes[4] !== 0 ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5, true) !== bytes.byteLength - 9)
    throw new Error("Invalid or oversized NFD1 checkpoint");
}

/** Debounced, serialized saves; edits during a write always get a later save.
 * Keep this resource in a ref. The immutable state contains no native handles. */
export class DocumentAutosave {
  private revision = 0;
  private savedRevision = 0;
  private error: unknown = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private closing?: Promise<void>;
  private stopped = false;
  private listeners = new Set<(state: AutosaveState) => void>();
  private unsubscribe: () => void;

  constructor(
    private readonly document: DocumentHandle,
    private readonly store: CheckpointStore,
    private readonly key: string,
    private readonly delayMs = 1000,
  ) {
    if (!key || key.length > 256 || !Number.isFinite(delayMs) || delayMs < 0)
      throw new RangeError("Autosave requires a bounded key and nonnegative delay");
    this.unsubscribe = document.on(event => {
      if (this.stopped) return;
      if (event.kind === "document:changed" || event.kind === "document:restored") {
        this.revision++;
        this.notify();
        // A synchronous observer can close this resource during publication.
        if (this.stopped) return;
        this.cancelTimer();
        this.timer = setTimeout(() => {
          this.timer = undefined;
          // Failure is retained in observable state; flush() permits retry.
          void this.flush().catch(() => undefined);
        }, delayMs);
      }
    });
  }

  get state(): AutosaveState {
    return Object.freeze({ revision: this.revision, savedRevision: this.savedRevision,
      saving: this.running !== undefined, error: this.error });
  }

  subscribe(listener: (state: AutosaveState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    for (const listener of this.listeners) {
      try { listener(this.state); } catch { /* Observers cannot invalidate a save. */ }
    }
  }

  private cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  flush(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Autosave is closed"));
    return this.drain();
  }

  private drain(): Promise<void> {
    this.cancelTimer();
    if (this.running) return this.running;
    this.error = null;
    this.running = Promise.resolve().then(async () => {
      while (this.savedRevision < this.revision) {
        const revision = this.revision;
        const bytes = await this.document.snapshot();
        validateCheckpoint(bytes);
        await this.store.write(this.key, { kind: this.document.kind, bytes: Uint8Array.from(bytes) });
        this.savedRevision = revision;
        this.notify();
      }
    }).catch(error => {
      this.error = error;
      throw error;
    }).finally(() => {
      this.running = undefined;
      this.notify();
    });
    this.notify();
    return this.running;
  }

  /** Detach before closing the engine. Rejected flush remains observable and
   * rejects close; the caller can offer recovery without claiming a save. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true;
    this.unsubscribe();
    this.closing = this.drain().finally(() => { this.listeners.clear(); });
    return this.closing;
  }

  /** Recover into a new, unpublished session. Cancellation closes a session
   * opened by this attempt before it can be published. Already-submitted
   * storage/engine work may finish; the signal prevents subsequent admission. */
  static async recover(host: EngineHost, kind: EngineKind, store: CheckpointStore,
    key: string, signal?: AbortSignal): Promise<DocumentHandle | undefined> {
    const checkCancelled = () => {
      if (!signal?.aborted) return;
      const error = new Error("Checkpoint recovery cancelled", { cause: signal.reason });
      error.name = "AbortError";
      throw error;
    };
    checkCancelled();
    const checkpoint = await store.read(key);
    checkCancelled();
    if (!checkpoint) return undefined;
    if (checkpoint.kind !== kind) throw new Error("Checkpoint belongs to another engine");
    // Own the bytes before open() yields: a storage adapter may reuse its buffer.
    // Uint8Array.from also copies Node Buffer inputs, whose slice() aliases memory.
    validateCheckpoint(checkpoint.bytes);
    const bytes = Uint8Array.from(checkpoint.bytes);
    validateCheckpoint(bytes);
    return DocumentHandle.openInitialized(host, kind, async document => {
      checkCancelled();
      await document.restore(bytes);
      checkCancelled();
    });
  }
}
