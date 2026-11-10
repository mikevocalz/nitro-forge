import type { Command, CommandResult, EngineHost, EngineKind } from "@nitro-forge/ignition";
import type { Telemetry } from "./telemetry";

/**
 * Wraps an {@link EngineHost} so every engine call is timed and every
 * failure recorded, tagged with the engine kind and op name. The wrapped
 * host behaves exactly like the original: same results, same errors.
 *
 * Recorded: `engine.open` (engine), `engine.apply` (engine, op, events),
 * `engine.snapshot` (engine, bytes), `engine.restore`, `engine.undo`,
 * `engine.redo`, `engine.close`. Payloads and results are never recorded.
 */
export function instrumentHost(host: EngineHost, telemetry: Telemetry): EngineHost {
  const kinds = new Map<number, EngineKind>();
  const engineOf = (handle: number) => kinds.get(handle) ?? "unknown";
  return {
    async open(kind) {
      const handle = await telemetry.time("engine.open", { engine: kind }, () => host.open(kind));
      kinds.set(handle, kind);
      return handle;
    },
    async apply<T = unknown>(handle: number, cmd: Command): Promise<CommandResult<T>> {
      const span = telemetry.span("engine.apply", { engine: engineOf(handle), op: cmd.op });
      try {
        const result = await host.apply<T>(handle, cmd);
        if (span.end("ok")) telemetry.trace("engine.events", { engine: engineOf(handle), op: cmd.op, count: result.events.length });
        return result;
      } catch (error) {
        if (span.end("error")) telemetry.failure("engine.apply", error, { engine: engineOf(handle), op: cmd.op });
        throw error;
      }
    },
    async snapshot(handle) {
      const attrs = { engine: engineOf(handle) };
      const span = telemetry.span("engine.snapshot", attrs);
      try {
        const bytes = await host.snapshot(handle);
        if (span.end("ok")) telemetry.trace("engine.snapshot.size", { ...attrs, bytes: bytes.byteLength });
        return bytes;
      } catch (error) {
        if (span.end("error")) telemetry.failure("engine.snapshot", error, attrs);
        throw error;
      }
    },
    restore: (handle, bytes) =>
      telemetry.time("engine.restore", { engine: engineOf(handle), bytes: bytes.byteLength }, () => host.restore(handle, bytes)),
    undo: handle => telemetry.time("engine.undo", { engine: engineOf(handle) }, () => host.undo(handle)),
    redo: handle => telemetry.time("engine.redo", { engine: engineOf(handle) }, () => host.redo(handle)),
    async close(handle) {
      const closed = await telemetry.time("engine.close", { engine: engineOf(handle) }, () => host.close(handle));
      kinds.delete(handle);
      return closed;
    },
    async dispose() {
      try { await host.dispose(); } finally { kinds.clear(); }
    },
  };
}
