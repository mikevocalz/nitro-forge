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
 * Must be genuinely local/offline. replaceAtomically must publish metadata
 * and document bytes as one complete record; readers must never see a torn
 * logical checkpoint. Power-loss durability depends on the storage backend
 * and must be verified separately; a resolved write is not an fsync claim.
 * load() rejects with CorruptCheckpointError when stored bytes exist but
 * cannot be decoded; any other rejection is treated as a retryable read
 * failure.
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

/**
 * unopened -> opening -> ready | unopened (retryable read failure)
 *                     -> corrupt (stored checkpoint unreadable)
 * corrupt  -> opening (open() re-reads, or discardCorruptCheckpoint())
 * ready    -> failed (rollback impossible) | closed
 */
export type OfflineBoardStatus =
  "unopened" | "opening" | "ready" | "corrupt" | "failed" | "closed";
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

/**
 * A local checkpoint exists for this board but cannot be read. Its bytes are
 * left untouched. Show this to the user; only an explicit
 * discardCorruptCheckpoint(boardId) replaces it with a fresh board.
 */
export class CorruptCheckpointError extends OfflineBoardError {
  constructor(readonly boardId: string, message: string, options?: ErrorOptions) {
    super("invalid-checkpoint", message, options);
    this.name = "CorruptCheckpointError";
  }
}

/** True when open/initialize may be called: never opened, or last open hit corruption. */
export function canOpenFrom(status: OfflineBoardStatus): boolean {
  return status === "unopened" || status === "corrupt";
}

/** Classify a load() rejection: corruption stays typed, anything else is a retryable storage error. */
export function classifyLoadFailure(documentId: string, error: unknown): OfflineBoardError {
  if (error instanceof CorruptCheckpointError) {
    return error.boardId === documentId ? error
      : new CorruptCheckpointError(documentId, error.message, { cause: error });
  }
  if (error instanceof OfflineBoardError) return error;
  return new OfflineBoardError("storage", "Could not read the local board checkpoint", { cause: error });
}

export interface OfflineBoardController<Command> {
  readonly status: OfflineBoardStatus;
  readonly lastReceipt: OfflineBoardReceipt | null;
  /**
   * Opens or initializes from a local checkpoint before permitting edits.
   * A failed read leaves the controller retryable; an unreadable checkpoint
   * rejects with CorruptCheckpointError and status "corrupt".
   */
  open(): Promise<OfflineBoardReceipt>;
  /**
   * User-confirmed recovery after CorruptCheckpointError. Re-reads storage:
   * if the checkpoint has become readable it opens normally; otherwise it
   * replaces the unreadable checkpoint with the current document as revision 0.
   * boardId must equal this controller's document ID.
   */
  discardCorruptCheckpoint(boardId: string): Promise<OfflineBoardReceipt>;
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
    if (value === null || typeof value !== "object" || value.schemaVersion !== 1 || value.documentId !== documentId ||
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
  const verifyLoaded = (value: BoardCheckpoint): void => {
    try {
      verify(value);
    } catch (cause) {
      throw new CorruptCheckpointError(
        documentId, "Local board checkpoint is corrupt or incompatible", { cause },
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

  const createFresh = async (): Promise<BoardCheckpoint> => {
    const initial = await capture();
    const next: BoardCheckpoint = {
      schemaVersion: 1, documentId, revision: 0, syncedRevision: 0, data: initial,
    };
    await persist(next);
    return copyCheckpoint(next);
  };

  const openWith = (discardCorrupt: boolean): Promise<OfflineBoardReceipt> => {
    if (!canOpenFrom(status) || closing) {
      return Promise.reject(new OfflineBoardError("lifecycle", "Board already opened or closed"));
    }
    // Assigned synchronously so a second open() cannot start a parallel load.
    const previous = status;
    status = "opening";
    return enqueue(async () => {
      let saved: BoardCheckpoint | null;
      try {
        saved = await storage.load(documentId);
        if (saved !== null) verifyLoaded(saved);
      } catch (error) {
        const failure = classifyLoadFailure(documentId, error);
        if (!(failure instanceof CorruptCheckpointError)) {
          status = previous;
          throw failure;
        }
        if (!discardCorrupt) {
          status = "corrupt";
          throw failure;
        }
        try {
          checkpoint = await createFresh();
        } catch (writeError) {
          status = "corrupt";
          throw writeError;
        }
        status = "ready";
        return receipt(checkpoint);
      }
      try {
        if (saved !== null) {
          const restored = copyCheckpoint(saved);
          await document.restore(new Uint8Array(restored.data));
          checkpoint = restored;
        } else {
          checkpoint = await createFresh();
        }
      } catch (error) {
        status = previous;
        throw error;
      }
      status = "ready";
      return receipt(checkpoint);
    });
  };

  return {
    get status() { return status; },
    get lastReceipt() { return checkpoint === null ? null : receipt(checkpoint); },

    open() {
      return openWith(false);
    },

    discardCorruptCheckpoint(boardId) {
      if (status !== "corrupt" || closing) {
        return Promise.reject(new OfflineBoardError(
          "lifecycle", "No corrupt checkpoint was reported for this board"));
      }
      if (boardId !== documentId) {
        return Promise.reject(new OfflineBoardError(
          "lifecycle", "Discard confirmation does not match this board"));
      }
      return openWith(true);
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
