import type { WhiteboardRendererOptions } from "../specs/WhiteboardRendererOptions";
import type { WhiteboardRendererBindingOptions } from "./WhiteboardRendererBindingOptions";

/** Options plus the single QuickDraw store and precomputed ink outline function. */
export interface UseWhiteboardRendererOptions extends WhiteboardRendererOptions {
  readonly store: WhiteboardRendererBindingOptions["store"];
  readonly board?: WhiteboardRendererBindingOptions["board"];
  readonly getInkOutline: WhiteboardRendererBindingOptions["getInkOutline"];
  readonly onError?: (error: Error) => void;
}
