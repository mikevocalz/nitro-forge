/** Engine identifiers are shared with the existing Ignition command registry. */
export type ForgeEngineKind =
  | "prism" | "cadence" | "splice" | "folio"
  | "pitch" | "tally" | "quill" | "photo" | "motion" | "design" | "draft" | "scene";

/**
 * Nitro v1 supports named native structs. The current Rust engine payload
 * is heterogeneous JSON: keep it serialized until nested AnyJSON codegen is
 * supported and tested; no arbitrary object conversion is trusted here.
 */
export interface ForgeCommand {
  op: string;
  v?: number;
  payloadJson?: string;
}

/** Event payload is JSON, encoded only when details exist. */
export interface ForgeEvent {
  kind: string;
  detailJson?: string;
}

/** Transport success is implied by resolution; errors reject the Promise. */
export interface ForgeCommandResult {
  dataJson: string;
  events: ForgeEvent[];
}

/** Bytes are returned separately from scalar/event JSON; absent for ops without byte output. */
export interface ForgeBinaryCommandResult {
  dataJson:string;
  events:ForgeEvent[];
  output?:ArrayBuffer;
}
