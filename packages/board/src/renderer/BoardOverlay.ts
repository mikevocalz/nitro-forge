import type { BoardCamera } from "../specs/BoardCamera";

/**
 * Minimal renderer-facing projection of an editor overlay. The full editor
 * controls its own document and can include additional JSON fields.
 */
export interface BoardOverlay {
  readonly laserStrokes: readonly { readonly endedAtMs?: number }[];
}

/**
 * Structural adapter for the existing QuickDraw headless board. Forge does
 * not depend on Viro's UI package to obtain these data and listeners.
 */
export interface BoardEditorSource {
  getOverlay(): BoardOverlay;
  addOnOverlayChangedListener(listener: (overlay: BoardOverlay) => void): { remove(): void };
  expireOverlay(timestampMs: number): void;
  getEditorState(): { camera: BoardCamera };
  addOnEditorStateChangedListener(
    listener: (state: { camera: BoardCamera }) => void,
  ): { remove(): void };
}
