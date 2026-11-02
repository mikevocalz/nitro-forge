import type { WhiteboardRenderer } from "../specs/WhiteboardRenderer.nitro";

/**
 * The part of a {@linkcode WhiteboardRenderer} a binding drives.
 * @see {@linkcode WhiteboardRendererBindingOptions.renderer}
 */
export type WhiteboardRendererTarget = Pick<
  WhiteboardRenderer,
  "loadSnapshot" | "applyDiff" | "setCamera" | "setOverlay" | "addOnStateChangedListener"
>;
