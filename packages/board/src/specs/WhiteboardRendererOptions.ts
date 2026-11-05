import type { WhiteboardRendererFactory } from "./WhiteboardRendererFactory.nitro";

/**
 * Options for {@linkcode WhiteboardRendererFactory.createRenderer}.
 *
 * Board units are QuickDraw view units: the space headless-board pointer
 * samples use before the camera is applied.
 */
export interface WhiteboardRendererOptions {
  /**
   * The id the Viro `canvasSource` material was created with. The renderer
   * draws into the Surface Viro provides for this id. Integer.
   */
  surfaceId: number;
  /**
   * Surface width in pixels the caller allocated the material with. If Viro
   * provides a Surface of a different size, drawing is scaled so the same
   * board area fills it. Positive integer.
   */
  widthPx: number;
  /** Surface height in pixels; see {@linkcode WhiteboardRendererOptions.widthPx}. Positive integer. */
  heightPx: number;
  /**
   * Surface pixels per board unit at `widthPx`, like a device pixel ratio.
   * A 1008 x 630 board on a 2016 x 1260 Surface uses 2. Finite and > 0.
   */
  pixelRatio: number;
  /**
   * Radius of the paper's corners in pixels at `widthPx`. Outside the rounded
   * rectangle the Surface stays transparent. 0 draws square corners, for a
   * panel whose corners come from the shared coverage function instead.
   * Clamped to half the shorter side.
   */
  cornerRadiusPx: number;
  /** Paper colour as `#RRGGBB` or `#RRGGBBAA`, sRGB-encoded. */
  backgroundColor: string;
}
