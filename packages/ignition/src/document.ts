import type { Command, CommandResult, EngineKind, ForgeEvent } from "./types";
import type { EngineHost } from "./host";

export type ForgeListener = (e: ForgeEvent) => void;

/**
 * DocumentHandle — a live engine session. One handle = one open document on
 * one engine worker. All document access flows through here.
 */
export class DocumentHandle {
  private listeners = new Set<ForgeListener>();
  private closed = false;

  constructor(
    readonly host: EngineHost,
    readonly kind: EngineKind,
    readonly id: number,
  ) {}

  static async open(host: EngineHost, kind: EngineKind): Promise<DocumentHandle> {
    const id = await host.open(kind);
    return new DocumentHandle(host, kind, id);
  }

  private assertOpen() {
    if (this.closed) {
      throw new Error(`document handle ${this.id} is closed`);
    }
  }

  on(listener: ForgeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(events: ForgeEvent[]) {
    for (const e of events)
      for (const l of this.listeners) {
        try {
          l(e);
        } catch (err) {
          // A throwing listener must not fail the apply that triggered it —
          // the engine command already succeeded. Surface asynchronously so
          // the error is still observable.
          queueMicrotask(() => {
            throw err;
          });
        }
      }
  }

  async apply<T = unknown>(
    op: string,
    payload?: unknown,
  ): Promise<CommandResult<T>> {
    this.assertOpen();
    const cmd: Command = { op, ...(payload === undefined ? {} : { payload }) };
    const res = await this.host.apply<T>(this.id, cmd);
    this.emit(res.events);
    return res;
  }

  /** Serialize the whole document into the versioned NFD1 envelope. */
  snapshot(): Promise<Uint8Array> {
    this.assertOpen();
    return this.host.snapshot(this.id);
  }

  /** Replace the document from envelope bytes produced by `snapshot()`. */
  async restore(bytes: Uint8Array): Promise<void> {
    this.assertOpen();
    await this.host.restore(this.id, bytes);
    this.emit([{ kind: "document:restored" }]);
  }

  undo(): Promise<boolean> {
    this.assertOpen();
    return this.host.undo(this.id);
  }

  redo(): Promise<boolean> {
    this.assertOpen();
    return this.host.redo(this.id);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    await this.host.close(this.id);
  }
}
