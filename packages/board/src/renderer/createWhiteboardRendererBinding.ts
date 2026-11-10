import { composeDiff } from "@quickdrawjs/core";
import type { Camera, Diff } from "@quickdrawjs/core";
import type { BoardOverlay } from "./BoardOverlay";
import { createInkOutlineEncoder } from "./createInkOutlineEncoder";
import type { WhiteboardRendererBinding } from "./WhiteboardRendererBinding";
import type { WhiteboardRendererBindingOptions } from "./WhiteboardRendererBindingOptions";

const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

const sameCamera = (a: Camera | undefined, b: Camera): boolean =>
  a !== undefined && a.x === b.x && a.y === b.y && a.z === b.z;

/**
 * Keeps a whiteboard renderer in step with a QuickDraw store.
 *
 * Sends a full snapshot first, then at most one coalesced diff per frame:
 * every store diff between two frames is composed with QuickDraw's
 * `composeDiff` and sent as one `applyDiff` with the next revision.
 * Overlay and camera changes ride the same frame. Revisions increase by one
 * per call, so the renderer can reject anything out of order.
 *
 * When the renderer rejects a call, or reports `lost`, the binding drops the
 * pending diff and sends a fresh snapshot on the next frame. A rejected
 * camera or overlay is sent again with the next frame, and `lost` resends
 * both with the snapshot. If that
 * snapshot is rejected too, it waits for the next store change before trying
 * again, so a renderer that rejects everything does not spin.
 */
export function createWhiteboardRendererBinding(options: WhiteboardRendererBindingOptions): WhiteboardRendererBinding {
  const { store, renderer, board, requestFrame, cancelFrame, onError } = options;
  const encoder = createInkOutlineEncoder(options.getInkOutline);

  let revision = 0;
  let pendingDiff: Diff | undefined;
  let needsSnapshot = true;
  let isResyncBlocked = false;
  let pendingOverlay: BoardOverlay | undefined = board?.getOverlay();
  let sentCamera: Camera | undefined;
  let pendingCamera: Camera | undefined = board?.getEditorState().camera;
  let frameHandle: number | undefined;
  let isInFrame = false;
  let isDisposed = false;

  const report = (error: unknown) => {
    if (onError !== undefined) onError(toError(error));
  };

  const hasFadingLaser = (overlay: BoardOverlay): boolean =>
    overlay.laserStrokes.some((stroke) => stroke.endedAtMs !== undefined);

  const schedule = () => {
    // Changes made while a frame runs are sent by that frame's flush.
    if (isDisposed || isInFrame || frameHandle !== undefined) return;
    frameHandle = requestFrame(onFrame);
  };

  const sendSnapshot = () => {
    pendingDiff = undefined;
    try {
      revision += 1;
      renderer.loadSnapshot(revision, encoder.encodeSnapshot(store.getSnapshot()));
      needsSnapshot = false;
      isResyncBlocked = false;
    } catch (error) {
      // Keep needing a snapshot: a diff on top of a document the renderer
      // never accepted would leave it incomplete.
      needsSnapshot = true;
      isResyncBlocked = true;
      report(error);
    }
  };

  const sendDiff = (diff: Diff) => {
    pendingDiff = undefined;
    try {
      revision += 1;
      renderer.applyDiff(revision, encoder.encodeDiff(diff));
    } catch (error) {
      report(error);
      needsSnapshot = true;
    }
  };

  const flush = () => {
    if (isDisposed) return;
    if (needsSnapshot) {
      if (!isResyncBlocked) sendSnapshot();
    } else if (pendingDiff !== undefined) {
      sendDiff(pendingDiff);
      // A rejected diff is answered with a snapshot in this same flush.
      if (needsSnapshot) sendSnapshot();
    }
    // A rejected camera or overlay stays pending, unless a newer value
    // arrived meanwhile, so the next frame sends it again.
    if (pendingCamera !== undefined && !sameCamera(sentCamera, pendingCamera)) {
      const camera = pendingCamera;
      pendingCamera = undefined;
      try {
        renderer.setCamera(camera);
        sentCamera = camera;
      } catch (error) {
        if (pendingCamera === undefined) pendingCamera = camera;
        report(error);
      }
    }
    if (pendingOverlay !== undefined) {
      const overlay = pendingOverlay;
      pendingOverlay = undefined;
      try {
        renderer.setOverlay(JSON.stringify(overlay));
      } catch (error) {
        if (pendingOverlay === undefined) pendingOverlay = overlay;
        report(error);
      }
    }
  };

  function onFrame(timestampMs: number) {
    frameHandle = undefined;
    if (isDisposed) return;
    isInFrame = true;
    try {
      if (board !== undefined && hasFadingLaser(board.getOverlay())) {
        // Emits an overlay change, which lands in pendingOverlay before flush.
        board.expireOverlay(timestampMs);
      }
      flush();
    } finally {
      isInFrame = false;
    }
    if (board !== undefined && hasFadingLaser(board.getOverlay())) schedule();
  }

  const unlistenStore = store.listen((diff) => {
    if (needsSnapshot) {
      isResyncBlocked = false;
    } else {
      pendingDiff = pendingDiff === undefined ? diff : composeDiff(pendingDiff, diff);
    }
    schedule();
  });

  const overlaySubscription = board?.addOnOverlayChangedListener((overlay) => {
    pendingOverlay = overlay;
    schedule();
  });

  const editorSubscription = board?.addOnEditorStateChangedListener((state) => {
    if (sameCamera(sentCamera, state.camera)) return;
    pendingCamera = state.camera;
    schedule();
  });

  // A lost renderer may have lost its camera and overlay with the document.
  const stateSubscription = renderer.addOnStateChangedListener((state) => {
    if (state !== "lost") return;
    needsSnapshot = true;
    isResyncBlocked = false;
    if (board !== undefined) {
      sentCamera = undefined;
      pendingCamera = board.getEditorState().camera;
      pendingOverlay = board.getOverlay();
    }
    schedule();
  });

  schedule();

  return {
    flush,
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      if (frameHandle !== undefined) cancelFrame(frameHandle);
      frameHandle = undefined;
      unlistenStore();
      overlaySubscription?.remove();
      editorSubscription?.remove();
      stateSubscription.remove();
    },
  };
}
