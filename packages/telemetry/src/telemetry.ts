import { EngineError } from "@nitro-forge/ignition";
import { redactAttributes, scrubMessage } from "./redact";
import type {
  TelemetryConsent,
  TelemetryEvent,
  TelemetrySink,
  TraceExport,
} from "./types";

/** Options for {@link createTelemetry}. */
export interface TelemetryOptions {
  /** What the person allowed. Change it later with {@link Telemetry.setConsent}. */
  consent: TelemetryConsent;
  /** Receives `diagnostics` batches; ignored for other consents. */
  sink?: TelemetrySink;
  /** Events kept on the device; the oldest go first. Default 500. */
  maxEvents?: number;
  /** Events per sink batch. Default 50. */
  batchSize?: number;
  /** Milliseconds clock. Default `performance.now`. */
  clock?: () => number;
}

/** An open timing; end it exactly once. */
export interface Span {
  end(outcome?: "ok" | "error" | "cancelled"): void;
}

/**
 * Permission-aware timings, failures and debug traces (N-18). Every call is
 * a no-op under `off`, so instrumented code needs no consent checks of its own.
 */
export interface Telemetry {
  readonly consent: TelemetryConsent;
  /** Turning consent down clears what the old consent allowed: `off` empties the buffer, and the unsent sink queue is dropped. */
  setConsent(consent: TelemetryConsent): void;
  span(name: string, attrs?: Readonly<Record<string, unknown>>): Span;
  /** Times `fn`; a throw is recorded as an `error` span plus a failure, then rethrown. */
  time<T>(name: string, attrs: Readonly<Record<string, unknown>> | undefined, fn: () => Promise<T>): Promise<T>;
  failure(name: string, error: unknown, attrs?: Readonly<Record<string, unknown>>): void;
  trace(name: string, attrs?: Readonly<Record<string, unknown>>): void;
  /** The on-device buffer for a bug report. Empty under `off`. */
  exportTrace(): TraceExport;
  /** Sends queued `diagnostics` events now. */
  flush(): Promise<void>;
}

const NAME = /^[\w.:-]{1,64}$/;
const noop: Span = { end() {} };

/** Builds a {@link Telemetry}. */
export function createTelemetry(options: TelemetryOptions): Telemetry {
  const maxEvents = options.maxEvents ?? 500;
  const batchSize = options.batchSize ?? 50;
  const clock = options.clock ?? (() => globalThis.performance.now());
  for (const [name, value] of [["maxEvents", maxEvents], ["batchSize", batchSize]] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10000)
      throw new RangeError(`${name} must be an integer in 1..10000`);
  }
  const checkConsent = (value: TelemetryConsent) => {
    if (!["off", "local", "diagnostics"].includes(value)) throw new RangeError("Invalid telemetry consent");
  };
  checkConsent(options.consent);
  let epoch = 0;
  const pending = new Set<Promise<void>>();
  let consent = options.consent;
  let buffer: TelemetryEvent[] = [];
  let queue: TelemetryEvent[] = [];
  let overflowed = 0;
  let redacted = 0;

  const checkName = (name: string) => {
    if (!NAME.test(name)) throw new RangeError(`Telemetry names must look like identifiers, got "${name}"`);
  };
  const attrsOf = (raw: Readonly<Record<string, unknown>> | undefined) => {
    const { attrs, dropped } = redactAttributes(raw);
    redacted += dropped;
    return attrs;
  };
  const send = async (batch: TelemetryEvent[]) => {
    try {
      await options.sink?.(batch);
    } catch {
      // A failed upload drops the batch; telemetry must never fail the app.
    }
  };
  const record = (event: TelemetryEvent) => {
    Object.freeze(event.attrs);
    Object.freeze(event);
    buffer.push(event);
    if (buffer.length > maxEvents) {
      buffer.splice(0, buffer.length - maxEvents);
      overflowed += 1;
    }
    if (consent !== "diagnostics" || !options.sink) return;
    // Messages stay on the device.
    queue.push(event.type === "failure" ? withoutMessage(event) : event);
    if (queue.length >= batchSize) {
      const batch = queue;
      queue = [];
      const sending = send(Object.freeze(batch) as unknown as TelemetryEvent[]);
      pending.add(sending);
      void sending.finally(() => pending.delete(sending));
    }
  };

  const telemetry: Telemetry = {
    get consent() {
      return consent;
    },
    setConsent(next) {
      checkConsent(next);
      if (next !== consent) epoch += 1;
      if (next === "off") {
        buffer = [];
        overflowed = 0;
        redacted = 0;
      }
      if (next !== "diagnostics") queue = [];
      consent = next;
    },
    span(name, attrs) {
      checkName(name);
      if (consent === "off") return noop;
      const startedEpoch = epoch;
      const start = clock();
      const kept = attrsOf(attrs);
      let ended = false;
      return {
        end(outcome = "ok") {
          if (ended || consent === "off" || startedEpoch !== epoch) return;
          ended = true;
          record({ type: "span", name, at: start, durationMs: Math.max(0, clock() - start), outcome, attrs: kept });
        },
      };
    },
    async time(name, attrs, fn) {
      const span = telemetry.span(name, attrs);
      try {
        const value = await fn();
        span.end("ok");
        return value;
      } catch (error) {
        span.end("error");
        telemetry.failure(name, error, attrs);
        throw error;
      }
    },
    failure(name, error, attrs) {
      checkName(name);
      if (consent === "off") return;
      const engine = error instanceof EngineError ? error : undefined;
      const code = engine?.code ?? (error instanceof Error ? error.name : "unknown");
      const message = error instanceof Error ? scrubMessage(error.message) : undefined;
      record({
        type: "failure",
        name,
        at: clock(),
        code,
        recoverable: engine?.recoverable ?? false,
        attrs: attrsOf(attrs),
        ...(message ? { message } : {}),
      });
    },
    trace(name, attrs) {
      checkName(name);
      if (consent === "off") return;
      record({ type: "trace", name, at: clock(), attrs: attrsOf(attrs) });
    },
    exportTrace() {
      return {
        consent,
        exportedAt: new Date().toISOString(),
        overflowed,
        redacted,
        events: consent === "off" ? [] : [...buffer],
      };
    },
    async flush() {
      if (consent === "diagnostics" && queue.length) {
        const batch = queue;
        queue = [];
        const sending = send(Object.freeze(batch) as unknown as TelemetryEvent[]);
        pending.add(sending);
        void sending.finally(() => pending.delete(sending));
      }
      await Promise.all([...pending]);
    },
  };
  return telemetry;
}

function withoutMessage(event: Extract<TelemetryEvent, { type: "failure" }>): TelemetryEvent {
  const { message: _message, ...rest } = event;
  return rest;
}
