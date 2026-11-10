import type {
  Command,
  CommandResult,
  EngineErrorShape,
  EngineKind,
} from "./types";
import { EngineError } from "./types";
import type { ForgeFactory } from "./specs/ForgeFactory.nitro";

/**
 * EngineHost — the transport contract between TypeScript and Rust engines.
 * Two real implementations exist:
 *   NitroHost — production; Nitro HybridObject on the app engine worker.
 *   CliHost   — Node-only; lives in `@nitro-forge/ignition/cli`.
 */
export interface EngineHost {
  open(kind: EngineKind): Promise<number>;
  apply<T = unknown>(handle: number, cmd: Command): Promise<CommandResult<T>>;
  snapshot(handle: number): Promise<Uint8Array>;
  restore(handle: number, bytes: Uint8Array): Promise<void>;
  undo(handle: number): Promise<boolean>;
  redo(handle: number): Promise<boolean>;
  close(handle: number): Promise<boolean>;
  dispose(): Promise<void>;
}

/** Structural v1 contracts keep CLI/web imports free of native runtime effects. */
export interface ForgeDocumentNative {
  apply(command: { op: string; v?: number; payloadJson?: string }): Promise<{
    dataJson: string; events: { kind: string; detailJson?: string }[];
  }>;
  snapshot(): Promise<ArrayBuffer>;
  restore(bytes: ArrayBuffer): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  close(): Promise<void>;
}
export interface ForgeFactoryNative {
  open(kind: EngineKind): Promise<ForgeDocumentNative>;
}

/** Adapts native per-document ownership to the existing public handle API. */
export class NitroHost implements EngineHost {
  private documents = new Map<number, ForgeDocumentNative>();
  private nextHandle = 1;
  private disposed = false;
  private pending = new Set<Promise<number>>();
  private closing = new Set<Promise<boolean>>();
  private disposing?: Promise<void>;
  constructor(private factory: ForgeFactoryNative) {}

  open(kind: EngineKind): Promise<number> {
    if (this.disposed) return Promise.reject(new Error("NitroHost is disposed"));
    const opening = this.factory.open(kind).then(async (document) => {
      if (this.disposed || !Number.isSafeInteger(this.nextHandle)) {
        await document.close();
        throw new Error("NitroHost is disposed or handles are exhausted");
      }
      const handle = this.nextHandle++;
      this.documents.set(handle, document);
      return handle;
    }).catch((error: unknown) => { throw parseNativeError(error); });
    this.pending.add(opening);
    void opening.then(() => this.pending.delete(opening), () => this.pending.delete(opening));
    return opening;
  }

  private document(handle: number): ForgeDocumentNative {
    const document = this.documents.get(handle);
    if (!Number.isSafeInteger(handle) || !document) {
      throw new EngineError({ code: "not_found", message: "Document is closed or unknown", recoverable: true });
    }
    return document;
  }

  async apply<T>(handle: number, cmd: Command): Promise<CommandResult<T>> {
    try {
      const result = await this.document(handle).apply({
        op: cmd.op,
        ...(cmd.v === undefined ? {} : { v: cmd.v }),
        ...(cmd.payload === undefined ? {} : { payloadJson: JSON.stringify(cmd.payload) }),
      });
      return {
        data: JSON.parse(result.dataJson) as T,
        events: result.events.map(({ kind, detailJson }) => ({
          kind, ...(detailJson === undefined ? {} : { detail: JSON.parse(detailJson) }),
        })),
      };
    } catch (error) { throw parseNativeError(error); }
  }

  async snapshot(handle: number): Promise<Uint8Array> {
    try { return new Uint8Array(await this.document(handle).snapshot()); }
    catch (error) { throw parseNativeError(error); }
  }
  async restore(handle: number, bytes: Uint8Array): Promise<void> {
    // Copy the view, not its backing buffer (which can include unrelated bytes).
    try { await this.document(handle).restore(new Uint8Array(bytes).buffer); }
    catch (error) { throw parseNativeError(error); }
  }
  async undo(handle: number): Promise<boolean> {
    try { return await this.document(handle).undo(); }
    catch (error) { throw parseNativeError(error); }
  }
  async redo(handle: number): Promise<boolean> {
    try { return await this.document(handle).redo(); }
    catch (error) { throw parseNativeError(error); }
  }
  close(handle: number): Promise<boolean> {
    const document = this.documents.get(handle);
    if (!document) return Promise.resolve(false);
    this.documents.delete(handle);
    // Queue through a Promise so even synchronous native throws are tracked.
    const closing = Promise.resolve().then(() => document.close()).then(() => true)
      .catch((error: unknown) => { throw parseNativeError(error); });
    this.closing.add(closing);
    void closing.then(() => this.closing.delete(closing), () => this.closing.delete(closing));
    return closing;
  }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    for (const handle of this.documents.keys()) void this.close(handle);
    this.disposing = (async () => {
      const results = await Promise.allSettled([...this.closing]);
      await Promise.allSettled([...this.pending]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })();
    return this.disposing;
  }
}

/** Native errors surface as rejections whose message embeds the EngineError JSON. */
function parseNativeError(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const start = msg.indexOf("{");
  if (start >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(start)) as Record<string, unknown>;
      const shape = (parsed.code ? parsed : parsed.error) as EngineErrorShape | undefined;
      if (shape && ["invalid_command", "not_found", "validation", "serialization", "out_of_bounds", "unsupported", "internal", "cancelled"].includes(shape.code) &&
          typeof shape.message === "string" && typeof shape.recoverable === "boolean") return new EngineError(shape);
    } catch {
      /* fall through */
    }
  }
  // Older open/snapshot entrypoints return Rust's Display form, whereas
  // command results carry {ok:false,error:{...}} JSON. Preserve both formats.
  const legacy = /^(?:(?:open|snapshot|restore|undo|redo|apply|applyBinary|Error|native|Native):\s*){0,2}(InvalidCommand|NotFound|Validation|Serialization|OutOfBounds|Unsupported|Internal|Cancelled):\s*([\s\S]*)$/.exec(msg);
  if (legacy) {
    const codes: Record<string, EngineErrorShape["code"]> = {
      InvalidCommand: "invalid_command", NotFound: "not_found", Validation: "validation",
      Serialization: "serialization", OutOfBounds: "out_of_bounds", Unsupported: "unsupported",
      Internal: "internal", Cancelled: "cancelled",
    };
    const code = codes[legacy[1]!]!;
    return new EngineError({ code, message: legacy[2]!, recoverable: code !== "internal" });
  }
  return new EngineError({ code: "internal", message: msg, recoverable: false });
}

/** Normalize rejections from raw native documents/tasks using the same closed
 * error categories as EngineHost. Unknown native failures remain fatal. */
export { parseNativeError as normalizeNativeEngineError };

/**
 * Create the production factory, including native tasks and media caches.
 * Resolve the generated constructor lazily so Node/web imports have no native
 * runtime side effects. Callers own and must close documents and caches.
 */
export function createNativeForgeFactory(): ForgeFactory {
  // Generated v1 constructor uses getHybridClass, never the removed v0 API.
  // Loading it only here preserves Node tooling and web host isolation.
  const { ForgeFactory } = require("#forge-factory") as {
    ForgeFactory: new () => ForgeFactory;
  };
  return new ForgeFactory();
}

export function createNitroHost(): EngineHost {
  return new NitroHost(createNativeForgeFactory());
}
