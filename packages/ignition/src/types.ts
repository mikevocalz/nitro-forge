/** Shared contracts mirroring rust/ignition-core. Keep in sync. */

export const ENGINE_KINDS = [
  "prism",
  "cadence",
  "splice",
  "folio",
  "pitch",
  "tally",
  "quill",
] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

export type ErrorCode =
  | "invalid_command"
  | "not_found"
  | "validation"
  | "serialization"
  | "out_of_bounds"
  | "unsupported"
  | "internal"
  | "cancelled";

export interface EngineErrorShape {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
}

export class EngineError extends Error implements EngineErrorShape {
  readonly code: ErrorCode;
  readonly recoverable: boolean;
  constructor(shape: EngineErrorShape) {
    super(shape.message);
    this.name = "EngineError";
    this.code = shape.code;
    this.recoverable = shape.recoverable;
  }
}

export interface Command {
  v?: number;
  op: string;
  payload?: unknown;
}

export interface ForgeEvent {
  kind: string;
  detail?: unknown;
}

export interface CommandResult<T = unknown> {
  events: ForgeEvent[];
  data: T;
}

/** Reserved ops routed by the host, never seen by engine.apply(). */
export const RESERVED_OPS = {
  undo: "__undo",
  redo: "__redo",
  snapshot: "__snapshot",
} as const;
