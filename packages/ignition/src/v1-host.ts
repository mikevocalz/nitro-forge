import type { Command, CommandResult, EngineKind, ForgeEvent } from "./types";
import type { EngineHost } from "./host";

/**
 * Structural contract of the generated Nitro v1 class API in the isolated
 * ForgeFactory/ForgeDocument lab. No Nitro 0.x createHybridObject calls.
 */
export interface ForgeV1Command {
  readonly op: string;
  readonly v?: number;
  readonly payloadJson?: string;
}
export interface ForgeV1CommandResult {
  readonly dataJson: string;
  readonly events: readonly { kind: string; detailJson?: string }[];
}
export interface ForgeV1Document {
  readonly kind: EngineKind;
  apply(command: ForgeV1Command): Promise<ForgeV1CommandResult>;
  snapshot(): Promise<ArrayBuffer>;
  restore(bytes: ArrayBuffer): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  close(): Promise<void>;
}
export interface ForgeV1Factory {
  open(kind: EngineKind): Promise<ForgeV1Document>;
}

/**
 * Compatibility layer: legacy DocumentHandle's EngineHost contract wraps
 * Nitro v1's *native-owned per-document* HybridObject.
 */
export class ForgeV1EngineHost implements EngineHost {
  private readonly documents = new Map<number, ForgeV1Document>();
  private nextId = 1;
  private disposed = false;
  constructor(private readonly factory: ForgeV1Factory) {}

  async open(kind: EngineKind): Promise<number> {
    if (this.disposed) throw new Error("Nitro v1 host is disposed");
    const doc = await this.factory.open(kind);
    if (this.disposed) {
      await doc.close();
      throw new Error("Nitro v1 host was disposed during open");
    }
    if (doc.kind !== kind) {
      await doc.close();
      throw new Error("Nitro v1 returned a document with the wrong engine kind");
    }
    const id = this.nextId++;
    if (!Number.isSafeInteger(id)) throw new RangeError("Too many v1 document handles");
    this.documents.set(id, doc);
    return id;
  }

  private requireDoc(handle: number): ForgeV1Document {
    const doc = this.documents.get(handle);
    if (!doc) throw new Error("Closed or invalid Nitro v1 document handle");
    return doc;
  }

  async apply<T = unknown>(handle: number, command: Command): Promise<CommandResult<T>> {
    const doc = this.requireDoc(handle);
    const request: ForgeV1Command = {
      op: command.op,
      ...(command.v === undefined ? {} : { v: command.v }),
      ...(command.payload === undefined
        ? {} : { payloadJson: JSON.stringify(command.payload) }),
    };
    const result = await doc.apply(request);
    const data = JSON.parse(result.dataJson) as T;
    const events: ForgeEvent[] = result.events.map(event => ({
      kind: event.kind,
      ...(event.detailJson === undefined
        ? {} : { detail: JSON.parse(event.detailJson) as unknown }),
    }));
    return { data, events };
  }

  async snapshot(handle: number): Promise<Uint8Array> {
    const owned = await this.requireDoc(handle).snapshot();
    // Copy out of the Nitro-owned buffer before delivering to consumers.
    return new Uint8Array(owned).slice();
  }

  async restore(handle: number, bytes: Uint8Array): Promise<void> {
    // v1 requires an owned ArrayBuffer for async native document restore.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    await this.requireDoc(handle).restore(buffer);
  }

  undo(handle: number): Promise<boolean> { return this.requireDoc(handle).undo(); }
  redo(handle: number): Promise<boolean> { return this.requireDoc(handle).redo(); }

  async close(handle: number): Promise<boolean> {
    const doc = this.documents.get(handle);
    if (!doc) return false;
    this.documents.delete(handle);
    await doc.close();
    return true;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const pending = Array.from(this.documents.values());
    this.documents.clear();
    await Promise.all(pending.map(doc => doc.close()));
  }
}

/** Factory registration is a process-level constructor dependency, NOT a document. */
let registeredFactory: ForgeV1Factory | undefined;
export function registerForgeV1Factory(factory: ForgeV1Factory): void {
  if (!factory || typeof factory.open !== "function")
    throw new TypeError("An actual generated Nitro v1 ForgeFactory is required");
  registeredFactory = factory;
}

/** Throws visibly until the native generated v1 factory is installed. */
export function createRegisteredForgeV1Host(): EngineHost {
  if (!registeredFactory) throw new Error(
    "Nitro Forge v1 factory is not registered. Link the generated ForgeFactory " +
    "from ignition-v1-lab and registerForgeV1Factory(new ForgeFactory()) at app startup."
  );
  return new ForgeV1EngineHost(registeredFactory);
}
