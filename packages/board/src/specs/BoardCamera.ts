import type { WhiteboardRenderer } from "./WhiteboardRenderer.nitro";

/**
 * QuickDraw's camera: `page = view / z - (x, y)`. The same value the headless
 * board takes in `setCamera`.
 *
 * @see {@linkcode WhiteboardRenderer.setCamera}
 */
export interface BoardCamera {
  /** Horizontal page offset, in page units. */
  x: number;
  /** Vertical page offset, in page units. */
  y: number;
  /** Zoom. Must be finite and greater than 0. */
  z: number;
}
