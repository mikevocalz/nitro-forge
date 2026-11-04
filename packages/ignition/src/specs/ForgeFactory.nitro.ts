import { Apple, Android, type HybridObject } from "nitro-core";
import type { ForgeEngineKind } from "../contracts";
import type { ForgeDocument } from "./ForgeDocument.nitro";

export * from "#nitro/ForgeFactory";

/**
 * Entry point into the seven Ignition Rust document engines.
 *
 * A native constructor may not touch a large Rust document or the UI thread.
 * open() returns a ready, exclusively owned document session asynchronously.
 */
@Apple({
  language: "c++",
  implementation: {
    include: "<NitroForgeV1/HybridForgeFactory.hpp>",
    className: "HybridForgeFactory",
  },
})
@Android({
  language: "c++",
  implementation: {
    include: "<NitroForgeV1/HybridForgeFactory.hpp>",
    className: "HybridForgeFactory",
  },
})
export declare class ForgeFactory extends HybridObject {
  /** Construct a lightweight factory; it owns no active Rust document. */
  constructor();

  /**
   * Opens a new document on a dedicated native worker and resolves when ready.
   * The caller must call document.close() when editing ends.
   */
  open(kind: ForgeEngineKind): Promise<ForgeDocument>;
}
