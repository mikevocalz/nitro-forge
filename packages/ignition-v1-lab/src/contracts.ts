import type { AnyJSON } from "nitro-core";

/** Engine identifiers remain identical to the existing Ignition command registry. */
export type ForgeEngineKind =
  | "prism" | "cadence" | "splice" | "folio"
  | "pitch" | "tally" | "quill";

/**
 * A typed Nitro v1 native command. No JSON strings cross the JavaScript/JSI
 * boundary. Native validates and encodes the command for Ignition's Rust API.
 */
export interface ForgeCommand {
  op: string;
  v?: number;
  payload?: AnyJSON;
}

/** An engine event emitted after the Rust state machine commits a command. */
export interface ForgeEvent {
  kind: string;
  detail?: AnyJSON;
}

/** The native command result, without an in-band ok/error ambiguity. */
export interface ForgeCommandResult {
  data: AnyJSON;
  events: ForgeEvent[];
}
