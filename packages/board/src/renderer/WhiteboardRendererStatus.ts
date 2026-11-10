import type { WhiteboardRenderer } from "../specs/WhiteboardRenderer.nitro";
import type { WhiteboardRendererState } from "../specs/WhiteboardRendererState";

/** Unavailable is a supported result, never an excuse for a blank canvas. */
export type WhiteboardRendererStatus =
  | { readonly kind: "unavailable" }
  | { readonly kind: "creating" }
  | { readonly kind: "ready"; readonly renderer: WhiteboardRenderer; readonly state: WhiteboardRendererState }
  | { readonly kind: "failed"; readonly error: Error };
