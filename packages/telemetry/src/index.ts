export { createTelemetry, type Span, type Telemetry, type TelemetryOptions } from "./telemetry.ts";
export { instrumentHost } from "./instrument.ts";
export { redactAttributes, scrubMessage } from "./redact.ts";
export type {
  TelemetryAttributes,
  TelemetryConsent,
  TelemetryEvent,
  TelemetrySink,
  TelemetryValue,
  TraceExport,
} from "./types.ts";
