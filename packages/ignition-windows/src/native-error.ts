import { EngineError, type ErrorCode } from "@nitro-forge/ignition";

const errorCodes = new Set<ErrorCode>([
  "invalid_command", "not_found", "validation", "serialization",
  "out_of_bounds", "unsupported", "internal",
]);

/** Preserve the existing engine error shape in RNW promise rejections. */
export async function nativeCall<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const start = message.indexOf("{");
    if (start >= 0) {
      let shape: unknown;
      try { shape = JSON.parse(message.slice(start)); } catch { /* Not a Rust error. */ }
      if (shape !== null && typeof shape === "object" &&
          "code" in shape && typeof shape.code === "string" &&
          errorCodes.has(shape.code as ErrorCode) &&
          "message" in shape && typeof shape.message === "string" &&
          "recoverable" in shape && typeof shape.recoverable === "boolean") {
        throw new EngineError({
          code: shape.code as ErrorCode,
          message: shape.message,
          recoverable: shape.recoverable,
        });
      }
    }
    throw new EngineError({ code: "internal", message, recoverable: false });
  }
}
