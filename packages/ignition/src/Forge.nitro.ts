import type { HybridObject } from "react-native-nitro-modules";

/**
 * Forge — the single Nitro hybrid object hosting all Nitro-Forge engines.
 *
 * One instance owns a SessionRegistry of Rust engines. `openEngine` returns a
 * handle; every `*Json`/`snapshot`/`restore` call on that handle is dispatched
 * to the document's dedicated worker thread on the native side, so these
 * methods are async from JS's perspective even though engines are sync.
 *
 * Wire format: commands in/out as JSON strings; snapshots as base64.
 * Errors reject with a message embedding the serialized EngineError JSON.
 */
export interface Forge extends HybridObject {
  /** Create a ready engine on a native-owned worker; returns a positive JS-safe handle. */
  openEngine(kind: string): Promise<number>;
  /** Apply a JSON-serialized Command. Resolves to JSON CommandResult. */
  applyJson(handle: number, commandJson: string): Promise<string>;
  /** Serialize the document to the NFD1 envelope, base64-encoded. */
  snapshotB64(handle: number): Promise<string>;
  /** Replace the document from NFD1 envelope bytes (base64). */
  restoreB64(handle: number, bytesB64: string): Promise<void>;
  undo(handle: number): Promise<boolean>;
  redo(handle: number): Promise<boolean>;
  /** Close a document on its worker and deterministically release the engine. */
  closeEngine(handle: number): Promise<boolean>;
}
