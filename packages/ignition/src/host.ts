import type {
  Command,
  CommandResult,
  EngineErrorShape,
  EngineKind,
  ForgeEvent,
} from "./types";
import { EngineError } from "./types";
import { base64ToBytes, bytesToBase64 } from "./base64";

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

/**
 * The Forge HybridObject's native surface (see Forge.nitro.ts). Commands and
 * results cross as JSON strings; snapshots as base64. The native side runs
 * every engine call on the document's dedicated worker so `apply` never
 * blocks the UI thread.
 */
export interface ForgeNitro {
  openEngine(kind: string): Promise<number>;
  applyJson(handle: number, commandJson: string): Promise<string>;
  snapshotB64(handle: number): Promise<string>;
  restoreB64(handle: number, bytesB64: string): Promise<void>;
  undo(handle: number): Promise<boolean>;
  redo(handle: number): Promise<boolean>;
  closeEngine(handle: number): Promise<boolean>;
}

/**
 * The current v1 Nitro surface transports Rust u64 session IDs as JS numbers.
 * Reject any value outside JS's exact integer range before allowing it to
 * address an engine. A future generated HybridDocument API can eliminate
 * numeric handle transport entirely; never silently round a Rust handle.
 */
export function assertSafeEngineHandle(handle: number): void {
  if (!Number.isSafeInteger(handle) || handle <= 0) {
    throw new EngineError({
      code: "validation",
      message: "Invalid or unsafe native document handle",
      recoverable: false,
    });
  }
}

export class NitroHost implements EngineHost {
  constructor(private forge: ForgeNitro) {}

  async open(kind: EngineKind): Promise<number> {
    const handle = await native(this.forge.openEngine(kind));
    assertSafeEngineHandle(handle);
    return handle;
  }

  async apply<T>(handle: number, cmd: Command): Promise<CommandResult<T>> {
    assertSafeEngineHandle(handle);
    const raw = await native(this.forge.applyJson(handle, JSON.stringify(cmd)));
    let res: {
      ok?: boolean;
      data?: T;
      events?: ForgeEvent[];
      error?: EngineErrorShape;
    } | null;
    try {
      res = JSON.parse(raw) as typeof res;
    } catch {
      throw new EngineError({
        code: "internal",
        message: "Malformed native engine response",
        recoverable: false,
      });
    }
    // Native failures arrive in-band; a missing status is never successful.
    if (res?.ok === false) {
      throw new EngineError(
        res.error ?? { code: "internal", message: "empty error", recoverable: false },
      );
    }
    if (res?.ok !== true || (res.events !== undefined &&
      (!Array.isArray(res.events) || res.events.some((e) =>
        e === null || typeof e !== "object" || typeof e.kind !== "string")))) {
      throw new EngineError({
        code: "internal",
        message: "Invalid native engine response shape",
        recoverable: false,
      });
    }
    return { data: res.data as T, events: res.events ?? [] };
  }

  async snapshot(handle: number): Promise<Uint8Array> {
    assertSafeEngineHandle(handle);
    return base64ToBytes(await native(this.forge.snapshotB64(handle)));
  }

  async restore(handle: number, bytes: Uint8Array): Promise<void> {
    assertSafeEngineHandle(handle);
    await native(this.forge.restoreB64(handle, bytesToBase64(bytes)));
  }

  async undo(handle: number): Promise<boolean> {
    assertSafeEngineHandle(handle);
    return native(this.forge.undo(handle));
  }

  async redo(handle: number): Promise<boolean> {
    assertSafeEngineHandle(handle);
    return native(this.forge.redo(handle));
  }

  async close(handle: number): Promise<boolean> {
    assertSafeEngineHandle(handle);
    return native(this.forge.closeEngine(handle));
  }

  async dispose(): Promise<void> {}
}

/**
 * Every native call rejects with an Error whose message embeds the EngineError
 * JSON. Route all of them through one mapper so callers always receive an
 * EngineError, whichever method failed.
 */
async function native<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e: unknown) {
    throw parseNativeError(e);
  }
}

/** Native errors surface as rejections whose message embeds the EngineError JSON. */
function parseNativeError(e: unknown): EngineError {
  const msg = e instanceof Error ? e.message : String(e);
  const start = msg.indexOf("{");
  if (start >= 0) {
    try {
      const shape = JSON.parse(msg.slice(start)) as EngineErrorShape;
      if (shape.code) return new EngineError(shape);
    } catch {
      /* fall through */
    }
  }
  return new EngineError({ code: "internal", message: msg, recoverable: false });
}

/**
 * Create the production host. Resolves `react-native-nitro-modules` lazily so
 * this module stays importable where Nitro doesn't exist (Node tooling).
 */
export function createNitroHost(): EngineHost {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NitroModules } = require("react-native-nitro-modules") as {
    NitroModules: { createHybridObject<T>(name: string): T };
  };
  return new NitroHost(NitroModules.createHybridObject<ForgeNitro>("Forge"));
}
