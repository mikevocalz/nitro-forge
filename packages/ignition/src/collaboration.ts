import { ownedJson } from "./owned-json";
import { ownCollaborationCheckpoint, type CollaborationCheckpoint } from "./collaboration-checkpoint";
import { DocumentHandle } from "./document";
import { validateCheckpoint } from "./autosave";
import type { EngineHost } from "./host";
import type { Command, EngineKind } from "./types";

/** The provider must authorize the document and retain immutable revisions.
 * Revision zero denotes absence. compareAndSwap is atomic and durable: it must
 * reject a stale base without writing, and resolve only after persistence.
 * Authentication, transport timeouts and reconnect policy belong to the host. */
export interface CollaborationTransport {
  read(documentId: string): Promise<RemoteRevision | undefined>;
  compareAndSwap(documentId: string, baseRevision: number,
    checkpoint: { readonly kind: EngineKind; readonly bytes: Uint8Array }): Promise<
      { readonly accepted: true; readonly revision: number } |
      { readonly accepted: false; readonly current: RemoteRevision }>;
}
export interface RemoteRevision {
  readonly revision: number;
  readonly kind: EngineKind;
  readonly bytes: Uint8Array;
}
export class CollaborationConflict extends Error {
  constructor(readonly localBase: number, readonly remoteRevision: number) {
    super(`Document conflict: local base ${localBase}, remote revision ${remoteRevision}`);
    this.name = "CollaborationConflict";
  }
}
export interface CollaborationState {
  readonly revision: number;
  readonly dirty: boolean;
  readonly syncing: boolean;
  readonly closed: boolean;
}
/** Restore options for DocumentCollaboration.recover. Checkpoints belong to
 * private application storage scoped to the service/account/document. */
export interface RecoverCollaborationOptions {
  readonly host: EngineHost;
  readonly transport: CollaborationTransport;
  readonly documentId: string;
  readonly checkpoint: CollaborationCheckpoint;
}

/** Owns one authoritative Rust session. All edits/history flow through this
 * owner, so a remote replacement can never race an uncoordinated local edit.
 * Keep it in a ref; its state getter exposes no handles or document bytes.
 * This adapter provides explicit revision conflicts, not CRDT merging.
 */
export class DocumentCollaboration {
  private tail: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private dirty = true;
  private generation = 0;
  private attempted: { bytes: Uint8Array; generation: number; base: number } | undefined;
  private syncing = false;
  private closing = false;
  private closed = false;
  private closePromise?: Promise<void>;
  private syncPromise: Promise<CollaborationState> | undefined;
  private unsubscribe: () => void;

  private constructor(private document: DocumentHandle,
    private transport: CollaborationTransport, private documentId: string) {
    this.unsubscribe = document.on(e => {
      if (e.kind === "document:changed" || e.kind === "document:restored") {
        this.dirty = true; this.generation++;
      }
    });
  }

  static async create(host: EngineHost, kind: EngineKind, documentId: string,
    transport: CollaborationTransport, initial: readonly Command[]): Promise<DocumentCollaboration> {
    if (!/^[\w.:-]{1,256}$/.test(documentId)) throw new RangeError("Invalid collaboration document ID");
    const document = await DocumentHandle.openInitialized(host, kind, async d => {
      await d.applyBatch(initial);
      // Initialization is not part of the user's edit history.
      await d.restore(await d.snapshot());
    });
    return new DocumentCollaboration(document, transport, documentId);
  }

  /** Reopens an unpublished Rust session with its durable remote base and exact
   * ambiguous upload. Later offline edits remain dirty after lost-ACK recovery. */
  static async recover(options: RecoverCollaborationOptions): Promise<DocumentCollaboration> {
    const value = ownCollaborationCheckpoint(options.checkpoint);
    if (value.documentId !== options.documentId) throw new Error("Checkpoint belongs to another collaboration document");
    const document = await DocumentHandle.openInitialized(options.host, value.kind, d => d.restore(value.bytes));
    const owner = new DocumentCollaboration(document, options.transport, options.documentId);
    owner.revision = value.revision;
    owner.dirty = value.dirty;
    owner.generation = value.pending && !value.pending.matchesCurrent ? 1 : 0;
    if (value.pending) owner.attempted = { bytes: value.pending.bytes, generation: 0, base: value.revision };
    return owner;
  }

  /** Captures one atomic private recovery record. Snapshot bytes remain owned
   * by the caller. Persist it before closing the owner or acknowledging shutdown. */
  checkpoint(): Promise<CollaborationCheckpoint> {
    return this.enqueue(async () => ownCollaborationCheckpoint({ version: 1, documentId: this.documentId,
      kind: this.document.kind, revision: this.revision, dirty: this.dirty, bytes: await this.document.snapshot(),
      ...(this.attempted ? { pending: { bytes: this.attempted.bytes,
        matchesCurrent: this.attempted.generation === this.generation } } : {}) }));
  }

  get state(): CollaborationState {
    return Object.freeze({ revision: this.revision, dirty: this.dirty,
      syncing: this.syncing, closed: this.closed });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("Collaboration session is closing"));
    const task = this.tail.then(work);
    this.tail = task.catch(() => undefined);
    return task;
  }

  apply(commands: readonly Command[]) {
    // Copy now, before queued work runs. Engine validation remains authoritative.
    let owned: Command[];
    try { owned = ownedJson(commands) as Command[]; }
    catch (error) { return Promise.reject(error); }
    return this.enqueue(() => this.document.applyBatch(owned));
  }
  undo(): Promise<boolean> { return this.enqueue(() => this.document.undo()); }
  redo(): Promise<boolean> { return this.enqueue(() => this.document.redo()); }
  snapshot(): Promise<Uint8Array> { return this.enqueue(() => this.document.snapshot()); }
  describe<T = unknown>() { return this.enqueue(() => this.document.apply<T>("describe")); }

  /** Explicit conflict resolution: discard the local draft and adopt the latest
   * remote snapshot, resetting undo. Never invoke without a user discard choice. */
  acceptRemote(): Promise<CollaborationState> {
    return this.enqueue(async () => {
      const remote = await this.transport.read(this.documentId);
      if (!remote) throw new Error("Remote document does not exist");
      await this.restoreRemote(remote);
      return this.state;
    });
  }

  /** Commands accepted during sync queue behind its revision boundary. A failed
   * or conflicting upload leaves the local snapshot, dirty flag and undo intact.
   * Ambiguous network failures are resolved by the next read: exact snapshot
   * equality recognizes a durable upload without creating another revision. */
  syncNow(): Promise<CollaborationState> {
    if (this.closing) return Promise.reject(new Error("Collaboration session is closing"));
    if (this.syncPromise) return this.syncPromise;
    const task = this.enqueue(async () => {
      this.syncing = true;
      try {
        const remote = await this.transport.read(this.documentId);
        if (remote) this.validateRemote(remote);
        const remoteRevision = remote?.revision ?? 0;
        if (remoteRevision < this.revision) throw new Error("Remote revision moved backwards");
        if (remoteRevision !== this.revision) {
          if (!this.dirty) await this.restoreRemote(remote!);
          else {
            const attempt = this.attempted;
            if (remote && attempt && remote.revision > attempt.base && equalBytes(attempt.bytes, remote.bytes)) {
              this.revision = remote.revision;
              this.dirty = this.generation !== attempt.generation;
              this.attempted = undefined;
            } else throw new CollaborationConflict(this.revision, remoteRevision);
          }
        }
        if (this.dirty) {
          const bytes = await this.document.snapshot();
          this.attempted = { bytes: bytes.slice(), generation: this.generation, base: this.revision };
          const response = await this.transport.compareAndSwap(this.documentId, this.revision,
            { kind: this.document.kind, bytes: bytes.slice() });
          if (!response.accepted) {
            this.attempted = undefined;
            this.validateRemote(response.current);
            throw new CollaborationConflict(this.revision, response.current.revision);
          }
          if (!Number.isSafeInteger(response.revision) || response.revision <= this.revision)
            throw new Error("Invalid acknowledged collaboration revision");
          this.attempted = undefined;
          this.revision = response.revision;
          this.dirty = false;
        }
      } finally { this.syncing = false; }
      return this.state;
    });
    this.syncPromise = task;
    void task.then(() => { this.syncPromise = undefined; }, () => { this.syncPromise = undefined; });
    return task;
  }

  private validateRemote(remote: RemoteRevision): void {
    if (remote.kind !== this.document.kind || !Number.isSafeInteger(remote.revision) || remote.revision < 1)
      throw new Error("Invalid remote engine or revision");
    if (remote.revision < this.revision) throw new Error("Remote revision moved backwards");
    validateCheckpoint(remote.bytes);
  }
  private async restoreRemote(remote: RemoteRevision): Promise<void> {
    this.validateRemote(remote);
    const bytes = remote.bytes.slice();
    // Rust restore validates document semantics atomically and resets history.
    await this.document.restore(bytes);
    this.attempted = undefined;
    this.revision = remote.revision;
    this.dirty = false;
  }

  /** Drains accepted edits and sync, then releases this document, not the host. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.tail.then(async () => {
      this.unsubscribe();
      this.attempted = undefined;
      try { await this.document.close(); } finally { this.closed = true; }
    });
    return this.closePromise;
  }
}
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
