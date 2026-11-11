import type { createWhiteboardRendererBinding } from "./createWhiteboardRendererBinding";

/**
 * A live link from a QuickDraw store (and optionally a headless board) to a
 * renderer. Returned by {@linkcode createWhiteboardRendererBinding}.
 */
export interface WhiteboardRendererBinding {
  /** Sends whatever is pending now instead of on the next frame. */
  flush(): void;
  /** Stops listening and cancels the pending frame. Does not dispose the renderer. Idempotent. */
  dispose(): void;
}
