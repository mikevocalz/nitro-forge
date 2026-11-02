import type { WhiteboardRenderer } from "./WhiteboardRenderer.nitro";

/**
 * Lifecycle state of a {@linkcode WhiteboardRenderer}.
 *
 * - `initializing`: the renderer exists and is subscribing to its Viro surface id.
 * - `waiting-for-surface`: subscribed; Viro has not provided the Surface yet.
 * - `active`: drawing into the provided Surface.
 * - `suspended`: Viro withdrew the Surface (pause, material swap). The document
 *   is kept and the next provided Surface is redrawn from it.
 * - `lost`: drawing into the provided Surface failed. The document is kept;
 *   the next provided Surface is redrawn from it, and callers may reload a
 *   snapshot to be sure the renderer holds the latest document.
 * - `disposed`: `dispose()` ran. Terminal.
 *
 * @see {@linkcode WhiteboardRenderer.state}
 * @see {@linkcode WhiteboardRenderer.addOnStateChangedListener}
 */
export type WhiteboardRendererState =
  | "initializing"
  | "waiting-for-surface"
  | "active"
  | "suspended"
  | "lost"
  | "disposed";
