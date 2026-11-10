import type {
  BoardCheckpoint, LocalBoardStorage, OfflineBoardReceipt, OfflineBoardStatus,
} from "./offline";
import {
  canOpenFrom, classifyLoadFailure, CorruptCheckpointError, OfflineBoardError,
} from "./offline";

/**
 * Structural interface matching Moyo's existing Yjs BoardDoc.
 * No new Y.Doc, Store or undo history is created by NitroForge.
 */
export interface YjsBoardDocumentPort {
  /** Y.encodeStateAsUpdate() of the EXISTING authoritative Y.Doc. */
  encode(): Uint8Array;
  /**
   * Y.applyUpdate() into that same document, with tracked origin. A throw
   * disables the session because a CRDT merge may already have changed it;
   * recover using a fresh host-owned document and the saved checkpoint.
   */
  merge(update: Uint8Array, origin: "restore" | "remote"): void;
}

export interface LocalYjsBoardSession {
  readonly status: OfflineBoardStatus;
  readonly lastReceipt: OfflineBoardReceipt | null;
  /** A local transaction has not yet been durably stored; do not show "Saved". */
  readonly hasUnpersistedChanges: boolean;
  /**
   * Restore a local update into the existing Y.Doc before mounting any view.
   * A failed read leaves the session retryable; an unreadable checkpoint
   * rejects with CorruptCheckpointError and status "corrupt".
   */
  initialize(): Promise<OfflineBoardReceipt>;
  /**
   * User-confirmed recovery after CorruptCheckpointError. Re-reads storage:
   * a now-readable checkpoint is restored normally; otherwise the unreadable
   * checkpoint is replaced by the current Y.Doc state as revision 0. Yjs
   * cannot clear a live Y.Doc, so whatever it already holds is kept.
   */
  discardCorruptCheckpoint(boardId: string): Promise<OfflineBoardReceipt>;
  /** Call after a completed local Yjs/QuickDraw transaction, not on each pen point. */
  saveLocal(): Promise<OfflineBoardReceipt>;
  /** Merge a remote CRDT update and durably persist the resulting union. */
  mergeRemote(update: Uint8Array): Promise<OfflineBoardReceipt>;
  /**
   * Mark an ACK of a durably saved revision. Later local edits, saved or
   * not, stay pending for the next sync.
   */
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
  /**
   * Optional listener on the EXISTING board's Yjs/QuickDraw record updates.
   * For Moyo: handler => boardDoc.onRecords(() => handler()).
   * Subscribe after initialize; saves are queued once per completed change.
   */
  readonly subscribeChanges?: (listener: () => void) => () => void;
  /** Required when subscribeChanges is provided: never silently swallow a failed save. */
  readonly onPersistenceError?: (error: unknown) => void;
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
  // A new epoch is issued synchronously when an edit is observed. A save
  // cannot mark a newer edit durable merely because an older write finished.
  let editEpoch = 0;
  let durableEpoch = 0;
  let suppressObserver = false;
  let unsubscribe: (() => void) | undefined;
  if (options.subscribeChanges !== undefined &&
      typeof options.onPersistenceError !== "function") {
    throw new TypeError("subscribeChanges requires an onPersistenceError handler");
  }

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
  const save = async (epoch: number): Promise<OfflineBoardReceipt> => {
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
    durableEpoch = Math.max(durableEpoch, epoch);
    return receipt(checkpoint);
  };

  const queueObservedSave = (): void => {
    if (suppressObserver || state !== "ready") return;
    const epoch = ++editEpoch;
    // Closing drains observed transactions too, including a transaction
    // arriving while the final storage write is pending.
    if (closing) return;
    // Preserve errors for the host UI; never claim an asynchronous write
    // succeeded merely because the observer itself returned.
    void enqueue(() => save(epoch)).catch((error: unknown) => {
      options.onPersistenceError?.(error);
    });
  };

  const validLoaded = (loaded: BoardCheckpoint): boolean =>
    loaded !== null && typeof loaded === "object" &&
    loaded.schemaVersion === 1 && loaded.documentId === documentId &&
    Number.isSafeInteger(loaded.revision) && loaded.revision >= 0 &&
    Number.isSafeInteger(loaded.syncedRevision) && loaded.syncedRevision >= 0 &&
    loaded.syncedRevision <= loaded.revision &&
    loaded.data instanceof Uint8Array && loaded.data.byteLength >= 1 &&
    loaded.data.byteLength <= maxBytes;

  const createFresh = async (): Promise<BoardCheckpoint> => {
    const fresh: BoardCheckpoint = {
      schemaVersion: 1, documentId, revision: 0, syncedRevision: 0, data: snapshot(),
    };
    await persist(fresh);
    return copy(fresh);
  };

  const initializeWith = (discardCorrupt: boolean): Promise<OfflineBoardReceipt> => {
    if (!canOpenFrom(state) || closing) {
      return Promise.reject(new OfflineBoardError("lifecycle", "Yjs board already initialized"));
    }
    // Assigned synchronously so a second initialize() cannot load in parallel.
    const previous = state;
    state = "opening";
    return enqueue(async () => {
      let loaded: BoardCheckpoint | null;
      try {
        loaded = await storage.load(documentId);
        if (loaded !== null && !validLoaded(loaded)) {
          throw new CorruptCheckpointError(documentId, "Invalid persisted Yjs board checkpoint");
        }
        if (loaded !== null) {
          try {
            document.merge(new Uint8Array(loaded.data), "restore");
          } catch (cause) {
            throw new CorruptCheckpointError(
              documentId, "Persisted Yjs board update could not be applied", { cause });
          }
        }
      } catch (error) {
        const failure = classifyLoadFailure(documentId, error);
        if (!(failure instanceof CorruptCheckpointError)) {
          state = previous;
          throw failure;
        }
        if (!discardCorrupt) {
          state = "corrupt";
          throw failure;
        }
        loaded = null;
      }
      try {
        checkpoint = loaded !== null ? copy(loaded) : await createFresh();
      } catch (error) {
        state = previous;
        throw error;
      }
      state = "ready";
      unsubscribe = options.subscribeChanges?.(queueObservedSave);
      return receipt(checkpoint);
    });
  };

  return {
    get status() { return state; },
    get lastReceipt() { return checkpoint === null ? null : receipt(checkpoint); },
    get hasUnpersistedChanges() { return editEpoch > durableEpoch; },
    initialize() {
      return initializeWith(false);
    },
    discardCorruptCheckpoint(boardId) {
      if (state !== "corrupt" || closing) {
        return Promise.reject(new OfflineBoardError(
          "lifecycle", "No corrupt checkpoint was reported for this board"));
      }
      if (boardId !== documentId) {
        return Promise.reject(new OfflineBoardError(
          "lifecycle", "Discard confirmation does not match this board"));
      }
      return initializeWith(true);
    },
    saveLocal() {
      if (closing) return Promise.reject(new OfflineBoardError("lifecycle", "Yjs board is closing"));
      // With an observer, explicit saveLocal acts as a flush rather than
      // recording the same Yjs transaction twice.
      const epoch = options.subscribeChanges ? editEpoch : ++editEpoch;
      return enqueue(async () => {
        const current = requireReady();
        return epoch > durableEpoch ? save(epoch) : receipt(current);
      });
    },
    mergeRemote(update) {
      if (closing) return Promise.reject(new OfflineBoardError("lifecycle", "Yjs board is closing"));
      if (!(update instanceof Uint8Array) || update.byteLength < 1 ||
          update.byteLength > maxBytes) {
        return Promise.reject(new OfflineBoardError("invalid-checkpoint", "Invalid remote Yjs update"));
      }
      // Take ownership before entering the asynchronous queue. A caller may
      // reuse or modify its transport buffer immediately after this returns.
      const owned = new Uint8Array(update);
      return enqueue(async () => {
        requireReady();
        // Suppress the observer for this explicit merge; it is saved once
        // below, not twice by the observer AND by mergeRemote().
        suppressObserver = true;
        const epoch = ++editEpoch;
        try {
          document.merge(owned, "remote");
        } catch (cause) {
          state = "failed";
          throw new OfflineBoardError("invalid-checkpoint",
            "Remote Yjs merge failed; reopen a fresh document from the saved checkpoint", { cause });
        } finally {
          suppressObserver = false;
        }
        return save(epoch);
      });
    },
    acknowledgeSync(revision) {
      if (closing) return Promise.reject(new OfflineBoardError("lifecycle", "Yjs board is closing"));
      return enqueue(async () => {
        // Only durable revisions can have been sent, so an ACK is checked
        // against the saved checkpoint. Edits not yet saved locally have no
        // revision; they stay pending and pendingUpdate() keeps returning them.
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
      return editEpoch > durableEpoch ||
        current.revision > current.syncedRevision ? snapshot() : null;
    },
    close() {
      if (closeTask) return closeTask;
      closing = true;
      closeTask = enqueue(async () => {
        while (state === "ready" && editEpoch > durableEpoch) {
          // Refuse a clean close until the in-memory Yjs update is saved.
          await save(editEpoch);
        }
        state = "closed";
        unsubscribe?.();
        unsubscribe = undefined;
      }).catch(error => {
        // A failed close is retryable once local storage is repaired.
        closing = false;
        closeTask = undefined;
        throw error;
      });
      return closeTask;
    },
  };
}
