/**
 * What the person allowed.
 * - `off`: nothing is recorded.
 * - `local`: timings, failures and traces stay in a bounded on-device buffer
 *   the person can export into a bug report. Nothing is sent.
 * - `diagnostics`: as `local`, and batches go to the app's sink. Failure
 *   messages never go to the sink, only error codes.
 */
export type TelemetryConsent = "off" | "local" | "diagnostics";

/**
 * Attribute values that may be recorded. Strings must look like identifiers
 * (op names, engine kinds, error codes: letters, digits, `_ . : -`, at most
 * 64 characters); anything else is dropped so document text cannot leak in.
 */
export type TelemetryValue = string | number | boolean;
export type TelemetryAttributes = Readonly<Record<string, TelemetryValue>>;

/** One recorded event. `at` is milliseconds on the telemetry clock. */
export type TelemetryEvent =
  | {
      readonly type: "span";
      readonly name: string;
      readonly at: number;
      readonly durationMs: number;
      readonly outcome: "ok" | "error" | "cancelled";
      readonly attrs: TelemetryAttributes;
    }
  | {
      readonly type: "failure";
      readonly name: string;
      readonly at: number;
      /** Identifier-shaped `EngineError.code` or error class name; otherwise `unknown`. */
      readonly code: string;
      readonly recoverable: boolean;
      readonly attrs: TelemetryAttributes;
      /** Scrubbed message, kept only on the device (`local` and `diagnostics` buffers), never in sink batches. */
      readonly message?: string;
    }
  | {
      readonly type: "trace";
      readonly name: string;
      readonly at: number;
      readonly attrs: TelemetryAttributes;
    };

/** Receives one `diagnostics` batch at a time. A rejected write drops that batch.
 * The app owns network deadlines; a stalled sink cannot grow the bounded queue.
 * Revocation drops unsent work but cannot recall a batch already given to a sink. */
export type TelemetrySink = (batch: readonly TelemetryEvent[]) => void | Promise<void>;

/** What {@link Telemetry.exportTrace} returns for a bug report. */
export interface TraceExport {
  readonly consent: TelemetryConsent;
  readonly exportedAt: string;
  /** Events dropped because the buffer was full. */
  readonly overflowed: number;
  /** Attributes or error codes dropped because they did not look like identifiers. */
  readonly redacted: number;
  readonly events: readonly TelemetryEvent[];
}
