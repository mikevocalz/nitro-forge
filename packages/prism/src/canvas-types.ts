/**
 * Types for Prism's canvas/layers ops (docs/ENGINE_OPS.md § prism). Field
 * names match the engine's JSON exactly, so values pass through unchanged.
 */
import type { Rgba } from "./rgba";

/** Blend modes accepted by {@linkcode PrismDocument.setLayerBlend}. */
export type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten"
  | "color-dodge" | "color-burn" | "hard-light" | "soft-light"
  | "difference" | "exclusion" | "add";

/** Every {@linkcode BlendMode}, in menu order. */
export const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "add",
] as const satisfies readonly BlendMode[];

/**
 * A layer transform. A content point `p` lands on the canvas at
 * `t + o + R(rotation)·S(sx, sy)·(p - o)` with pivot `o = (ox, oy)`.
 * @see {@linkcode PrismDocument.setLayerTransform}
 */
export interface LayerTransform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  /** Degrees, clockwise on the canvas. */
  rotation: number;
  ox: number;
  oy: number;
}

/** How a new pixel selection combines with the current one. */
export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

/** Region for {@linkcode PrismDocument.selectRegion}. */
export type SelectionShape =
  | { kind: "rect" | "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "polygon"; points: [number, number][] };

/** Where {@linkcode PrismDocument.magicWand} and {@linkcode PrismDocument.floodFill} read colors. */
export type SampleSource = "composite" | "layer" | { layer: number };

/** Result of {@linkcode PrismDocument.getSelection}. */
export type SelectionState =
  | { empty: true }
  | { bounds: { x: number; y: number; w: number; h: number }; mask_b64: string; width: number; height: number };

/** One entry of {@linkcode PrismDocument.layerBounds}. */
export type LayerBounds =
  | { id: number; empty: true }
  | { id: number; x: number; y: number; w: number; h: number; corners: [number, number][] };

/** Alignment edge for {@linkcode PrismDocument.alignLayers}. */
export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
/** Reference rectangle for {@linkcode PrismDocument.alignLayers}. */
export type AlignTarget = "selection" | "canvas" | { artboard: number };

/** RGBA preview returned by the thumbnail and region ops. */
export interface PixelPreview {
  width: number;
  height: number;
  pixels_b64: string;
}

/** A page/board region; see {@linkcode PrismDocument.addArtboard}. */
export interface Artboard {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Path node handle behavior. */
export type NodeKind = "corner" | "smooth" | "symmetric";

/** A path node; `in`/`out` are handle offsets from the node. */
export interface PathNode {
  x: number;
  y: number;
  in?: [number, number];
  out?: [number, number];
  kind?: NodeKind;
}

/** One contour of a path. */
export interface Subpath {
  closed: boolean;
  nodes: PathNode[];
}

/** A gradient color stop; `offset` is in 0..1. */
export interface GradientStop {
  offset: number;
  color: Rgba;
}

/** Fill or stroke paint. Gradient coordinates are in layer content space. */
export type Paint =
  | { type: "solid"; color: Rgba }
  | { type: "linear"; x0: number; y0: number; x1: number; y1: number; stops: GradientStop[] }
  | { type: "radial"; cx: number; cy: number; r: number; fx?: number; fy?: number; stops: GradientStop[] };

/** Stroke settings for {@linkcode PrismDocument.setStroke}. */
export interface Stroke {
  paint: Paint;
  width: number;
  join?: "miter" | "round" | "bevel";
  cap?: "butt" | "round" | "square";
  miter_limit?: number;
  dash?: number[];
  dash_offset?: number;
}

/** Winding rule for path fills. */
export type FillRule = "nonzero" | "evenodd";
/** Whether the fill or the stroke paints first. */
export type PaintOrder = "fill-stroke" | "stroke-fill";
/** Boolean operation of a {@linkcode PrismDocument.booleanLayers} container. */
export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";
