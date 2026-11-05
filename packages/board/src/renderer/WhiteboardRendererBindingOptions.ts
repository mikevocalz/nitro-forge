import type { ShapeRecord, Store } from "@quickdrawjs/core";
import type { BoardEditorSource } from "./BoardOverlay";
import type { WhiteboardRendererTarget } from "./WhiteboardRendererTarget";

/** Cross-platform binding from an authoritative document to a derived renderer. */
export interface WhiteboardRendererBindingOptions {
  /** Read-only source; document edits and undo remain owned by the host. */
  readonly store: Pick<Store, "getSnapshot" | "listen">;
  readonly renderer: WhiteboardRendererTarget;
  /** Optional renderer decorations/camera, not document authority. */
  readonly board?: BoardEditorSource;
  /** Must use the same QuickDraw `strokeOutline` algorithm as the editor. */
  readonly getInkOutline: (shape: ShapeRecord) => number[] | undefined;
  readonly requestFrame: (callback: (timestampMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly onError?: (error: Error) => void;
}
