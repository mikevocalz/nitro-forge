/**
 * Durable local-first board commits. No network, React, QuickDraw, or Skia
 * dependency. A host supplies one canonical document and local *atomic*
 * storage (SQLite / filesystem / another verified durable adapter).
 *
 * Each completed operation is acknowledged only after the current document
 * snapshot has been atomically persisted. Rejected writes restore the last
 * persisted document; successful sync receipts must be recorded separately.
 */
export interface BoardCheckpoint {
  readonly schemaVersion: 1;
  readonly documentId: string;
  /** Strictly increasing local commit sequence, independent of server IDs. */
  readonly revision: number;
  /** Last LOCAL revision accepted by the remote sync service. */
  readonly syncedRevision: number;
  /** Versioned serialized bytes of the single canonical document. */
  readonly data: Uint8Array;
}

/**
 * Must be genuinely local/offline and crash-safe. replaceAtomically must
 * never leave a partial checkpoint visible after a kill or power loss.
 */
export interface LocalBoardStorage {
  load(documentId: string): Promise<BoardCheckpoint | null>;
  replaceAtomically(documentId: string, checkpoint: BoardCheckpoint): Promise<void>;
}

/** The host's only editable document. Renderer copies are read-only. */
export interface BoardDocumentPort<Command> {
  apply(command: Command): Promise<void>;
  snapshot(): Promise<Uint8Array>;
  restore(data: Uint8Array): Promise<void>;
}

export type OfflineBoardStatus = "unopened" | "ready" | "failed" | "closed";
export interface OfflineBoardReceipt {
  readonly documentId: string;
  readonly revision: number;
  readonly syncedRevision: number;
  readonly needsSync: boolean;
}

export class OfflineBoardError extends Error {
  constructor(
    readonly code: "invalid-checkpoint" | "storage" | "rollback" | "lifecycle" | "revision",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OfflineBoardError";
  }
}

export interface OfflineBoardController<Command> {
  readonly status: OfflineBoardStatus;
  readonly lastReceipt: OfflineBoardReceipt | null;
  /** Opens or initializes from a local checkpoint before permitting edits. */
  open(): Promise<OfflineBoardReceipt>;
  /** Serializes operations; returns only AFTER durable local save. */
  commit(command: Command): Promise<OfflineBoardReceipt>;
  /** Save a successful server ACK without discarding newer offline revisions. */
  acknowledgeSync(revision: number): Promise<OfflineBoardReceipt>;
  /** Wait for all already submitted local commits; rejects future commits. */
  close(): Promise<void>;
}

function finiteRevision(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

function receipt(state: BoardCheckpoint): OfflineBoardReceipt {
  return {
    documentId: state.documentId,
    revision: state.revision,
    syncedRevision: state.syncedRevision,
    needsSync: state.revision > state.syncedRevision,
  };
}

export function createOfflineBoardController<Command>(options: {
  readonly documentId: string;
  readonly document: BoardDocumentPort<Command>;
  readonly storage: LocalBoardStorage;
  readonly maxSnapshotBytes?: number;
}): OfflineBoardController<Command> {
  const { documentId, document, storage } = options;
  const maxBytes = options.maxSnapshotBytes ?? 32 * 1024 * 1024;
  if (!documentId || documentId.length > 256 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Invalid local board identifier or snapshot budget");
  }

  let status: OfflineBoardStatus = "unopened";
  let checkpoint: BoardCheckpoint | null = null;
  let closing = false;
  let closeTask: Promise<void> | undefined;
  let tail: Promise<void> = Promise.resolve();

  // Queue runs even after a previous promise rejects. State errors still
  // reject the individual operation without permanently poisoning the queue.
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const task = tail.then(work);
    tail = task.then(() => undefined, () => undefined);
    return task;
  };

  const capture = async (): Promise<Uint8Array> => {
    const bytes = await document.snapshot();
    if (!(bytes instanceof Uint8Array) ||
        bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
      throw new OfflineBoardError(
        "invalid-checkpoint", "Snapshot is empty, invalid or exceeds the local storage budget",
      );
    }
    return new Uint8Array(bytes);
  };

  const verify = (value: BoardCheckpoint): void => {
    if (value.schemaVersion !== 1 || value.documentId !== documentId ||
        !finiteRevision(value.revision) ||
        !finiteRevision(value.syncedRevision) ||
        value.syncedRevision > value.revision ||
        !(value.data instanceof Uint8Array) ||
        value.data.byteLength === 0 || value.data.byteLength > maxBytes) {
      throw new OfflineBoardError(
        "invalid-checkpoint", "Local board checkpoint is corrupt or incompatible",
      );
    }
  };

  const copyCheckpoint = (value: BoardCheckpoint): BoardCheckpoint => ({
    schemaVersion: 1,
    documentId,
    revision: value.revision,
    syncedRevision: value.syncedRevision,
    data: new Uint8Array(value.data),
  });

  const persist = async (next: BoardCheckpoint): Promise<void> => {
    verify(next);
    // Never hand the live document's mutable backing bytes to storage.
    await storage.replaceAtomically(documentId, copyCheckpoint(next));
  };

  const requireReady = (): BoardCheckpoint => {
    if (status !== "ready" || checkpoint === null) {
      throw new OfflineBoardError("lifecycle", "Board is not open for editing");
    }
    return checkpoint;
  };

  const rollback = async (prior: BoardCheckpoint, cause: unknown): Promise<never> => {
    try {
      await document.restore(new Uint8Array(prior.data));
    } catch (restoreError) {
      status = "failed";
      throw new OfflineBoardError(
        "rollback",
        "Local save failed and restoring the previous document failed; editing disabled",
        { cause: restoreError },
      );
    }
    throw new OfflineBoardError(
      "storage",
      "Board edit was not committed to local storage; previous document restored",
      { cause },
    );
  };

  return {
    get status() { return status; },
    get lastReceipt() { return checkpoint === null ? null : receipt(checkpoint); },

    open() {
      if (status !== "unopened" || closing) {
        return Promise.reject(new OfflineBoardError("lifecycle", "Board already opened or closed"));
      }
      // Assign status synchronously to prevent duplicate open() calls.
      status = "failed";
      return enqueue(async () => {
        const saved = await storage.load(documentId);
        if (saved !== null) {
          verify(saved);
          const restored = copyCheckpoint(saved);
          await document.restore(new Uint8Array(restored.data));
          checkpoint = restored;
        } else {
          const initial = await capture();
          const next: BoardCheckpoint = {
            schemaVersion: 1, documentId, revision: 0, syncedRevision: 0, data: initial,
          };
          await persist(next);
          checkpoint = copyCheckpoint(next);
        }
        status = "ready";
        return receipt(checkpoint);
      });
    },

    commit(command) {
      if (closing || status === "closed") {
        return Promise.reject(new OfflineBoardError("lifecycle", "Board is closing or closed"));
      }
      return enqueue(async () => {
        const prior = requireReady();
        if (prior.revision >= Number.MAX_SAFE_INTEGER) {
          throw new OfflineBoardError("revision", "Local revision sequence exhausted");
        }
        try {
          await document.apply(command);
          const bytes = await capture();
          const next: BoardCheckpoint = {
            schemaVersion: 1,
            documentId,
            revision: prior.revision + 1,
            syncedRevision: prior.syncedRevision,
            data: bytes,
          };
          await persist(next);
          checkpoint = copyCheckpoint(next);
          return receipt(checkpoint);
        } catch (error) {
          return rollback(prior, error);
        }
      });
    },

    acknowledgeSync(revision) {
      if (closing || status === "closed") {
        return Promise.reject(new OfflineBoardError("lifecycle", "Board is closing or closed"));
      }
      return enqueue(async () => {
        const current = requireReady();
        if (!finiteRevision(revision) || revision > current.revision) {
          throw new OfflineBoardError("revision", "Sync ACK is beyond the last local commit");
        }
        if (revision <= current.syncedRevision) return receipt(current);
        const next: BoardCheckpoint = {
          ...current, syncedRevision: revision, data: new Uint8Array(current.data),
        };
        try {
          await persist(next);
        } catch (cause) {
          throw new OfflineBoardError("storage", "Could not persist sync acknowledgement", { cause });
        }
        checkpoint = copyCheckpoint(next);
        return receipt(checkpoint);
      });
    },

    close() {
      if (closeTask !== undefined) return closeTask;
      closing = true;
      closeTask = enqueue(async () => { status = "closed"; });
      return closeTask;
    },
  };
}
