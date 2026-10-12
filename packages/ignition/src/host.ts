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
  openEngine(kind: string): number;
  applyJson(handle: number, commandJson: string): Promise<string>;
  snapshotB64(handle: number): Promise<string>;
  restoreB64(handle: number, bytesB64: string): Promise<void>;
  undo(handle: number): Promise<boolean>;
  redo(handle: number): Promise<boolean>;
  closeEngine(handle: number): boolean;
}

export class NitroHost implements EngineHost {
  constructor(private forge: ForgeNitro) {}

  async open(kind: EngineKind): Promise<number> {
    return this.forge.openEngine(kind);
  }

  async apply<T>(handle: number, cmd: Command): Promise<CommandResult<T>> {
    const raw = await this.forge
      .applyJson(handle, JSON.stringify(cmd))
      .catch((e: unknown) => {
        throw parseNativeError(e);
      });
    const res = JSON.parse(raw) as {
      ok?: boolean;
      data?: T;
      events?: ForgeEvent[];
      error?: EngineErrorShape;
    };
    // The C ABI reports engine failures in-band ({"ok":false,"error":{…}}),
    // not as rejections. Without this check every engine error reads as a
    // successful apply with undefined data.
    if (res.ok === false) {
      throw new EngineError(
        res.error ?? { code: "internal", message: "empty error", recoverable: false },
      );
    }
    return { data: res.data as T, events: res.events ?? [] };
  }

  async snapshot(handle: number): Promise<Uint8Array> {
    return base64ToBytes(await this.forge.snapshotB64(handle));
  }

  async restore(handle: number, bytes: Uint8Array): Promise<void> {
    await this.forge.restoreB64(handle, bytesToBase64(bytes));
  }

  undo(handle: number): Promise<boolean> {
    return this.forge.undo(handle);
  }

  redo(handle: number): Promise<boolean> {
    return this.forge.redo(handle);
  }

  async close(handle: number): Promise<boolean> {
    return this.forge.closeEngine(handle);
  }

  async dispose(): Promise<void> {}
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
