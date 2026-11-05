import {
  EngineError, base64ToBytes, bytesToBase64,
  type Command, type CommandResult, type EngineHost, type EngineKind,
} from "@nitro-forge/ignition";
import type { NativeForgeWindows } from "./native-transport";
import { nativeCall } from "./native-error";

/** @internal Adapts RNW transport to the existing EngineHost contract. */
export class WindowsHost implements EngineHost {
  private readonly documents = new Map<number, string>();
  private readonly closing = new Map<number, Promise<boolean>>();
  private readonly opening = new Set<Promise<number>>();
  private nextId = 1;
  private disposed = false;
  private disposing: Promise<void> | undefined;

  constructor(private readonly native: NativeForgeWindows) {}

  async open(kind: EngineKind): Promise<number> {
    this.assertActive();
    if (!Number.isSafeInteger(this.nextId)) {
      throw new EngineError({ code: "internal", message: "Document ID space exhausted", recoverable: false });
    }
    const id = this.nextId++;
    const pending = (async () => {
      const token = await nativeCall(this.native.openEngine(kind));
      if (typeof token !== "string" || token.length === 0) {
        throw new EngineError({ code: "internal", message: "Invalid native document token", recoverable: false });
      }
      this.documents.set(id, token);
      if (this.disposed) {
        await this.close(id);
        this.assertActive();
      }
      return id;
    })();
    this.opening.add(pending);
    void pending.then(() => this.opening.delete(pending), () => this.opening.delete(pending));
    return pending;
  }

  async apply<T = unknown>(id: number, command: Command): Promise<CommandResult<T>> {
    const documentId = this.document(id);
    const payloadJson = command.payload === undefined ? "" : JSON.stringify(command.payload);
    if (payloadJson === undefined) {
      throw new EngineError({ code: "validation", message: "Command payload must be JSON serializable", recoverable: true });
    }
    const reply = await nativeCall(this.native.apply({
      documentId, operation: command.op, payloadJson, version: command.v ?? 1,
    }));
    try {
      if (typeof reply.dataJson !== "string" || !Array.isArray(reply.events)) throw new Error();
      return {
        data: JSON.parse(reply.dataJson) as T,
        events: reply.events.map((event) => {
          if (typeof event.kind !== "string" || typeof event.detailJson !== "string") throw new Error();
          return event.detailJson === ""
            ? { kind: event.kind }
            : { kind: event.kind, detail: JSON.parse(event.detailJson) as unknown };
        }),
      };
    } catch {
      throw new EngineError({ code: "internal", message: "Malformed native command result", recoverable: false });
    }
  }

  async snapshot(id: number): Promise<Uint8Array> {
    return base64ToBytes(await nativeCall(this.native.snapshotB64(this.document(id))));
  }

  async restore(id: number, bytes: Uint8Array): Promise<void> {
    const documentId = this.document(id);
    // Serialize before yielding: callers can reuse or mutate their input buffer.
    await nativeCall(this.native.restoreB64(documentId, bytesToBase64(bytes)));
  }

  async undo(id: number): Promise<boolean> {
    return nativeCall(this.native.undo(this.document(id)));
  }

  async redo(id: number): Promise<boolean> {
    return nativeCall(this.native.redo(this.document(id)));
  }

  close(id: number): Promise<boolean> {
    try { this.assertId(id); } catch (error: unknown) { return Promise.reject(error); }
    const pending = this.closing.get(id);
    if (pending) return pending;
    const token = this.documents.get(id);
    if (token === undefined) return Promise.resolve(false);
    const closing = nativeCall(this.native.closeEngine(token)).then((closed) => {
      this.documents.delete(id);
      this.closing.delete(id);
      return closed;
    }, (error: unknown) => {
      this.closing.delete(id);
      throw error;
    });
    this.closing.set(id, closing);
    return closing;
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    const pending = (async () => {
      await Promise.allSettled([...this.opening]);
      const results = await Promise.allSettled([...this.documents.keys()].map((id) => this.close(id)));
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })();
    this.disposing = pending;
    void pending.catch(() => { this.disposing = undefined; });
    return pending;
  }

  private document(id: number): string {
    this.assertActive();
    this.assertId(id);
    const token = this.documents.get(id);
    if (token === undefined || this.closing.has(id)) {
      throw new EngineError({ code: "not_found", message: "Document is closed or belongs to another host", recoverable: false });
    }
    return token;
  }

  private assertId(id: number): void {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new EngineError({ code: "validation", message: "Invalid document ID", recoverable: false });
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new EngineError({ code: "internal", message: "Windows engine host is disposed", recoverable: false });
    }
  }
}
