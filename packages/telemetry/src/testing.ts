import { createTelemetry, type Telemetry } from "./telemetry";
import type { TelemetryEvent } from "./types";

/**
 * The test half of N-18: a `diagnostics` telemetry with a manual clock and
 * a capturing sink, plus queries tests assert against. Use it to check that
 * an engine flow records the spans and failures it should, and that nothing
 * content-bearing gets through.
 */
export interface TestTelemetry {
  readonly telemetry: Telemetry;
  /** Moves the clock forward. */
  advance(ms: number): void;
  /** Every event recorded so far, in order. */
  events(): readonly TelemetryEvent[];
  spans(name?: string): readonly Extract<TelemetryEvent, { type: "span" }>[];
  failures(name?: string): readonly Extract<TelemetryEvent, { type: "failure" }>[];
  /** What reached the sink, after {@link Telemetry.flush}. */
  sent(): readonly TelemetryEvent[];
}

export function createTestTelemetry(options: { batchSize?: number } = {}): TestTelemetry {
  let now = 0;
  const sent: TelemetryEvent[] = [];
  const telemetry = createTelemetry({
    consent: "diagnostics",
    clock: () => now,
    batchSize: options.batchSize ?? 1000,
    sink: batch => {
      sent.push(...batch);
    },
  });
  const events = () => telemetry.exportTrace().events;
  return {
    telemetry,
    advance(ms) {
      now += ms;
    },
    events,
    spans: name =>
      events().filter((e): e is Extract<TelemetryEvent, { type: "span" }> => e.type === "span" && (!name || e.name === name)),
    failures: name =>
      events().filter((e): e is Extract<TelemetryEvent, { type: "failure" }> => e.type === "failure" && (!name || e.name === name)),
    sent: () => sent,
  };
}
