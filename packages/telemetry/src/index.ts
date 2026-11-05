export { createTelemetry, type Span, type Telemetry, type TelemetryOptions } from "./telemetry";
export { instrumentHost } from "./instrument";
export { redactAttributes, scrubMessage } from "./redact";
export type {
  TelemetryAttributes,
  TelemetryConsent,
  TelemetryEvent,
  TelemetrySink,
  TelemetryValue,
  TraceExport,
} from "./types";
