import type { ShapeRecord, Store } from "@quickdrawjs/core";
import type { BoardEditorSource } from "./BoardOverlay";
import type { WhiteboardRendererTarget } from "./WhiteboardRendererTarget";

/** Cross-platform binding from the single QuickDraw Store to a derived renderer. */
export interface WhiteboardRendererBindingOptions {
  readonly store: Store;
  readonly renderer: WhiteboardRendererTarget;
  /** Optional renderer decorations/camera, not document authority. */
  readonly board?: BoardEditorSource;
  /** Must use the same QuickDraw `strokeOutline` algorithm as the editor. */
  readonly getInkOutline: (shape: ShapeRecord) => number[] | undefined;
  readonly requestFrame: (callback: (timestampMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly onError?: (error: Error) => void;
}
