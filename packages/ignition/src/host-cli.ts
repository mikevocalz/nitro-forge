import { spawn, type ChildProcess } from "node:child_process";
import type {
  Command,
  CommandResult,
  EngineErrorShape,
  EngineKind,
  ForgeEvent,
} from "./types";
import { EngineError } from "./types";
import { base64ToBytes, bytesToBase64 } from "./base64";
import type { EngineHost } from "./host";

interface Pending {
  resolve: (v: FrameResponse) => void;
  reject: (e: unknown) => void;
}

interface FrameResponse {
  id: number;
  ok: boolean;
  data?: unknown;
  events?: ForgeEvent[];
  error?: EngineErrorShape;
}

/**
 * CliHost — Node.js transport: spawns `nf-cli` and speaks the ignition
 * JSON-lines protocol against the real compiled Rust engines. Used by every
 * package's e2e suite and by apps/console. Node only — never bundled for RN.
 */
export class CliHost implements EngineHost {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(binPath?: string) {
    const path =
      binPath ??
      process.env.NF_CLI ??
      // package dir is <repo>/packages/ignition — binary lives in <repo>/target/debug
      new URL("../../../target/debug/nf-cli", import.meta.url).pathname;
    this.proc = spawn(path, [], { stdio: ["pipe", "pipe", "inherit"] });
    let remainder = "";
    this.proc.stdout!.on("data", (chunk: Buffer) => {
      remainder += chunk.toString("utf8");
      let nl: number;
      while ((nl = remainder.indexOf("\n")) >= 0) {
        const line = remainder.slice(0, nl);
        remainder = remainder.slice(nl + 1);
        if (!line.trim()) continue;
        const res = JSON.parse(line) as FrameResponse;
        const p = this.pending.get(res.id);
        if (p) {
          this.pending.delete(res.id);
          p.resolve(res);
        }
      }
    });
    this.proc.on("exit", (code) => {
      const err = new EngineError({
        code: "internal",
        message: `nf-cli exited with code ${code}`,
        recoverable: false,
      });
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  private send(req: {
    id: number;
    handle?: number;
    op: string;
    payload?: unknown;
  }): Promise<FrameResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      this.proc.stdin!.write(JSON.stringify(req) + "\n");
    });
  }

  private async call<T>(
    op: string,
    handle: number,
    payload?: unknown,
  ): Promise<CommandResult<T>> {
    const res = await this.send({ id: this.nextId++, handle, op, payload });
    if (!res.ok) {
      throw new EngineError(
        res.error ?? {
          code: "internal",
          message: "empty error",
          recoverable: false,
        },
      );
    }
    return { events: res.events ?? [], data: res.data as T };
  }

  async open(kind: EngineKind): Promise<number> {
    const r = await this.call<{ handle: number }>("open", 0, { kind });
    return r.data.handle;
  }

  apply<T>(handle: number, cmd: Command): Promise<CommandResult<T>> {
    return this.call<T>("apply", handle, cmd);
  }

  async snapshot(handle: number): Promise<Uint8Array> {
    const r = await this.call<{ bytes: string }>("snapshot", handle);
    return base64ToBytes(r.data.bytes);
  }

  async restore(handle: number, bytes: Uint8Array): Promise<void> {
    await this.call("restore", handle, { bytes: bytesToBase64(bytes) });
  }

  async undo(handle: number): Promise<boolean> {
    const r = await this.call<{ undone: boolean }>("apply", handle, {
      op: "__undo",
    });
    return r.data.undone;
  }

  async redo(handle: number): Promise<boolean> {
    const r = await this.call<{ redone: boolean }>("apply", handle, {
      op: "__redo",
    });
    return r.data.redone;
  }

  async close(handle: number): Promise<boolean> {
    const r = await this.call<{ closed: boolean }>("close", handle);
    return r.data.closed;
  }

  async dispose(): Promise<void> {
    this.proc.stdin!.end();
    this.proc.kill();
    for (const p of this.pending.values()) {
      p.reject(
        new EngineError({
          code: "internal",
          message: "host disposed",
          recoverable: false,
        }),
      );
    }
    this.pending.clear();
  }
}
