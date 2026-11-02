import type { LocalYjsBoardSession } from "./offline-yjs";
import { OfflineBoardError } from "./offline";

export interface BoardUpdateEnvelope {
  readonly documentId: string;
  /** Monotonically increasing client-local checkpoint revision. */
  readonly revision: number;
  /** Full Yjs state update for this document; callers cannot modify it. */
  readonly update: Uint8Array;
}

export interface YjsBoardTransport {
  /**
   * Resolve ONLY after the remote server has durably accepted and authorized
   * this update. HTTP 2xx without persistence is not sufficient.
   *
   * The SDK never manages sockets, tokens or tenant credentials.
   */
  sendAndAcknowledge(envelope: BoardUpdateEnvelope): Promise<void>;
}

export type BoardSyncResult =
  | { readonly kind: "up-to-date"; readonly revision: number }
  | { readonly kind: "uploaded"; readonly revision: number };

export interface BoardSyncCoordinator {
  /** Explicit reconnect/manual sync. Concurrent callers share one operation. */
  syncNow(): Promise<BoardSyncResult>;
  /** Merge one externally authenticated remote update into the same Y.Doc. */
  receiveRemote(update: Uint8Array): Promise<void>;
  /** Prevent further sends; in-flight network actions may finish but not ACK. */
  dispose(): void;
}

/**
 * A transport-neutral bridge between a *single* existing Yjs document and
 * the host's authenticated realtime or HTTP provider.
 *
 * No network connection or second document is instantiated here.
 * Retrying full encoded Yjs state updates is safe because Yjs updates are
 * idempotent/commutative. Only an ACK for the exact sent revision is saved.
 */
export function createYjsBoardSyncCoordinator(options: {
  readonly session: LocalYjsBoardSession;
  readonly documentId: string;
  readonly transport: YjsBoardTransport;
}): BoardSyncCoordinator {
  const { session, documentId, transport } = options;
  if (!documentId || documentId.length > 256) {
    throw new RangeError("Board collaboration requires a scoped document ID");
  }
  let disposed = false;
  let inFlight: Promise<BoardSyncResult> | undefined;
  return {
    syncNow() {
      if (disposed) {
        return Promise.reject(new OfflineBoardError("lifecycle", "Board sync coordinator disposed"));
      }
      if (inFlight) return inFlight;
      const request = (async (): Promise<BoardSyncResult> => {
        // The same Yjs document is local authority. No write under failed
        // storage may be acknowledged, even when the network is working.
        if (session.hasUnpersistedChanges) await session.saveLocal();
        if (session.hasUnpersistedChanges) {
          throw new OfflineBoardError("storage", "Unsaved board changes cannot be synced");
        }
        const checkpoint = session.lastReceipt;
        if (checkpoint === null || checkpoint.documentId !== documentId) {
          throw new OfflineBoardError("lifecycle", "Board document is not initialized");
        }
        const update = session.pendingUpdate();
        if (update === null) return { kind: "up-to-date", revision: checkpoint.revision };

        const sentRevision = checkpoint.revision;
        await transport.sendAndAcknowledge({
          documentId, revision: sentRevision,
          update: new Uint8Array(update),
        });
        // A pending edit may have arrived while the network request was
        // running: ACK only the old revision, not the latest local one.
        if (disposed) {
          throw new OfflineBoardError("lifecycle", "Board sync disposed before ACK");
        }
        await session.acknowledgeSync(sentRevision);
        return { kind: "uploaded", revision: sentRevision };
      })();
      inFlight = request;
      void request.then(() => { if (inFlight === request) inFlight = undefined; },
        () => { if (inFlight === request) inFlight = undefined; });
      return request;
    },
    async receiveRemote(update) {
      if (disposed) {
        throw new OfflineBoardError("lifecycle", "Board sync coordinator disposed");
      }
      if (!(update instanceof Uint8Array) || update.byteLength === 0) {
        throw new OfflineBoardError("invalid-checkpoint", "Invalid remote Yjs update");
      }
      await session.mergeRemote(new Uint8Array(update));
    },
    dispose() { disposed = true; },
  };
}
