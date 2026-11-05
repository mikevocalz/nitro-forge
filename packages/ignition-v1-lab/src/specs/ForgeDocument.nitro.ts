import { Apple, Android, type HybridObject } from "nitro-core";
import type {
  ForgeEngineKind, ForgeCommand, ForgeCommandResult,
} from "../contracts";

export * from "#nitro/ForgeDocument";

/**
 * A single, native-owned Ignition document session.
 *
 * Construction is intentionally inaccessible to JS; ForgeFactory.open()
 * returns a fully initialized instance. Its Rust session is released by
 * close(), with final native disposal as a fallback.
 *
 * This is a *v1 alpha code-generation contract*, not a linked implementation.
 */
@Apple({
  language: "c++",
  implementation: {
    include: "\"HybridForgeDocument.hpp\"",
    className: "HybridForgeDocument",
  },
})
@Android({
  language: "c++",
  implementation: {
    include: "\"HybridForgeDocument.hpp\"",
    className: "HybridForgeDocument",
  },
})
export declare class ForgeDocument extends HybridObject {
  /** The Rust engine type for this document. */
  readonly kind: ForgeEngineKind;

  /**
   * Atomically apply one validated command. Errors reject the Promise.
   * The generated binding transfers a typed outer struct. Its heterogeneous
   * payloadJson remains serialized JSON pending verified nested-AnyJSON support.
   */
  apply(command: ForgeCommand): Promise<ForgeCommandResult>;

  /**
   * Return an owned NFD1 byte snapshot through ArrayBuffer, not base64.
   * This is NOT proof of zero-copy Rust/Skia texture interoperability.
   */
  snapshot(): Promise<ArrayBuffer>;

  /** Restore a previously validated NFD1 snapshot without replacing the session. */
  restore(bytes: ArrayBuffer): Promise<void>;

  /** Undo the latest committed engine command, when one is available. */
  undo(): Promise<boolean>;

  /** Redo a previously undone command, when one is available. */
  redo(): Promise<boolean>;

  /** Idempotently release this session and its background native resources. */
  close(): Promise<void>;
}
