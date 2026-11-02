import type {
  BoardCheckpoint, LocalBoardStorage, OfflineBoardReceipt, OfflineBoardStatus,
} from "./offline";
import { OfflineBoardError } from "./offline";

/**
 * Structural interface matching Moyo's existing Yjs BoardDoc.
 * No new Y.Doc, Store or undo history is created by NitroForge.
 */
export interface YjsBoardDocumentPort {
  /** Y.encodeStateAsUpdate() of the EXISTING authoritative Y.Doc. */
  encode(): Uint8Array;
  /** Y.applyUpdate() into that same document, with tracked origin. */
  merge(update: Uint8Array, origin: "restore" | "remote"): void;
}

export interface LocalYjsBoardSession {
  readonly status: OfflineBoardStatus;
  readonly lastReceipt: OfflineBoardReceipt | null;
  /** Restore a local update into the existing Y.Doc before mounting any view. */
  initialize(): Promise<OfflineBoardReceipt>;
  /** Call after a completed local Yjs/QuickDraw transaction, not on each pen point. */
  saveLocal(): Promise<OfflineBoardReceipt>;
  /** Merge a remote CRDT update and durably persist the resulting union. */
  mergeRemote(update: Uint8Array): Promise<OfflineBoardReceipt>;
  /** Mark an ACK without discarding newer offline work. */
  acknowledgeSync(localRevision: number): Promise<OfflineBoardReceipt>;
  /** Full Yjs update to transmit to an app-owned sync provider on reconnect. */
  pendingUpdate(): Uint8Array | null;
  close(): Promise<void>;
}

/**
 * MMKV-backed persistence usually supplies LocalBoardStorage. A caller may
 * provide another truly local storage port for desktop/web; no network,
 * WebView or Yjs collaboration provider is constructed here.
 *
 * Crucially, Yjs state updates MERGE, they cannot be used as a destructive
 * "restore" on a live Y.Doc to roll back an edit. Save failures therefore
 * keep the unsaved change in memory and reject the receipt. The caller must
 * surface the unsaved state/retry, not pretend undo or cloud sync succeeded.
 */
export function createLocalYjsBoardSession(options: {
  readonly documentId: string;
  readonly document: YjsBoardDocumentPort;
  readonly storage: LocalBoardStorage;
  readonly maxSnapshotBytes?: number;
}): LocalYjsBoardSession {
  const { documentId, document, storage } = options;
  const maxBytes = options.maxSnapshotBytes ?? 32 * 1024 * 1024;
  if (!documentId || documentId.length > 256 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Yjs board requires a scoped document ID and byte limit");
  }
  let state: OfflineBoardStatus = "unopened";
  let checkpoint: BoardCheckpoint | null = null;
  let closing = false;
  let closeTask: Promise<void> | undefined;
  let tail: Promise<void> = Promise.resolve();

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const task = tail.then(fn);
    tail = task.then(() => undefined, () => undefined);
    return task;
  };
  const requireReady = (): BoardCheckpoint => {
    if (state !== "ready" || checkpoint === null) {
      throw new OfflineBoardError("lifecycle", "Yjs board is not initialized");
    }
    return checkpoint;
  };
  const copy = (c: BoardCheckpoint): BoardCheckpoint =>
    ({ ...c, data: new Uint8Array(c.data) });
  const receipt = (c: BoardCheckpoint): OfflineBoardReceipt => ({
    documentId, revision: c.revision, syncedRevision: c.syncedRevision,
    needsSync: c.revision > c.syncedRevision,
  });
  const snapshot = (): Uint8Array => {
    const bytes = document.encode();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 ||
        bytes.byteLength > maxBytes) {
      throw new OfflineBoardError("invalid-checkpoint", "Invalid Yjs state update size");
    }
    return new Uint8Array(bytes);
  };
  const persist = async (c: BoardCheckpoint): Promise<void> => {
    try {
      await storage.replaceAtomically(documentId, copy(c));
    } catch (cause) {
      throw new OfflineBoardError("storage", "Yjs board remains edited in memory but not saved locally", { cause });
    }
  };
  const save = async (): Promise<OfflineBoardReceipt> => {
    const current = requireReady();
    if (current.revision >= Number.MAX_SAFE_INTEGER) {
      throw new OfflineBoardError("revision", "Local Yjs revision exhausted");
    }
    const next: BoardCheckpoint = {
      schemaVersion: 1, documentId, revision: current.revision + 1,
      syncedRevision: current.syncedRevision, data: snapshot(),
    };
    await persist(next);
    checkpoint = copy(next);
    return receipt(checkpoint);
  };

  return {
    get status() { return state; },
    get lastReceipt() { return checkpoint === null ? null : receipt(checkpoint); },
    initialize() {
      if (state !== "unopened" || closing) {
        return Promise.reject(new OfflineBoardError("lifecycle", "Yjs board already initialized"));
      }
      state = "failed"; // blocks double initialization until ready
      return enqueue(async () => {
        const loaded = await storage.load(documentId);
        if (loaded !== null) {
          if (loaded.schemaVersion !== 1 || loaded.documentId !== documentId ||
              !Number.isSafeInteger(loaded.revision) || loaded.revision < 0 ||
              !Number.isSafeInteger(loaded.syncedRevision) || loaded.syncedRevision < 0 ||
              loaded.syncedRevision > loaded.revision ||
              !(loaded.data instanceof Uint8Array) || loaded.data.byteLength < 1 ||
              loaded.data.byteLength > maxBytes) {
            throw new OfflineBoardError("invalid-checkpoint", "Invalid persisted Yjs board checkpoint");
          }
          document.merge(new Uint8Array(loaded.data), "restore");
          checkpoint = copy(loaded);
        } else {
          const fresh: BoardCheckpoint = {
            schemaVersion: 1, documentId, revision: 0,
            syncedRevision: 0, data: snapshot(),
          };
          await persist(fresh);
          checkpoint = copy(fresh);
        }
        state = "ready";
        return receipt(checkpoint);
      });
    },
    saveLocal() {
      if (closing) return Promise.reject(new OfflineBoardError("lifecycle", "Yjs board is closing"));
      return enqueue(save);
    },
    mergeRemote(update) {
      if (closing) return Promise.reject(new OfflineBoardError("lifecycle", "Yjs board is closing"));
      return enqueue(async () => {
        requireReady();
        if (!(update instanceof Uint8Array) || update.byteLength < 1 ||
            update.byteLength > maxBytes) {
          throw new OfflineBoardError("invalid-checkpoint", "Invalid remote Yjs update");
        }
        // Yjs handles concurrent/offline updates by merging CRDT operations.
        // Persist the full merged update, not just the last incoming delta.
        document.merge(new Uint8Array(update), "remote");
        return save();
      });
    },
    acknowledgeSync(revision) {
      if (closing) return Promise.reject(new OfflineBoardError("lifecycle", "Yjs board is closing"));
      return enqueue(async () => {
        const current = requireReady();
        if (!Number.isSafeInteger(revision) || revision < 0 || revision > current.revision) {
          throw new OfflineBoardError("revision", "Invalid local sync acknowledgement");
        }
        if (revision <= current.syncedRevision) return receipt(current);
        const next = copy({ ...current, syncedRevision: revision });
        await persist(next);
        checkpoint = copy(next);
        return receipt(checkpoint);
      });
    },
    pendingUpdate() {
      const current = requireReady();
      return current.revision > current.syncedRevision ? snapshot() : null;
    },
    close() {
      if (closeTask) return closeTask;
      closing = true;
      closeTask = enqueue(async () => { state = "closed"; });
      return closeTask;
    },
  };
}
