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

// -- brush / stroke (P06) -----------------------------------------------------

/**
 * One raw stylus sample for {@linkcode PrismDocument.modelStroke} and
 * {@linkcode PrismDocument.paintStroke}. `t` is **seconds** (monotonic
 * non-decreasing), `x`/`y` canvas pixels. `pressure`/`tilt`/`orientation`
 * are optional; absent values model as unknown. `tilt`/`orientation` are
 * radians. `contact: false` lifts the pen and ends the current segment.
 */
export interface StrokeSample {
  t: number;
  x: number;
  y: number;
  pressure?: number;
  tilt?: number;
  orientation?: number;
  contact?: boolean;
}

/** Optional tuning for the engine's stroke modeler (all fields optional). */
export interface StrokeModelParams {
  /** Wobble smoothing on/off (default true). */
  smoothing?: boolean;
  /** Averaging window in seconds (default 0.04). */
  smoothing_timeout?: number;
  /** Speed px/s at/below which full smoothing applies (default 2). */
  smoothing_speed_floor?: number;
  /** Speed px/s at/above which no smoothing applies (default 30). */
  smoothing_speed_ceiling?: number;
  /** Minimum modeled output rate per second (default 240). */
  min_output_rate?: number;
  /** Pen-tip mass/spring constant (default 11/32400). */
  spring_mass_constant?: number;
  /** Velocity drag ratio per second (default 72). */
  drag_constant?: number;
  /** End-of-stroke settling stop distance in px (default 0.01). */
  end_of_stroke_stopping_distance?: number;
  /** End-of-stroke settling iteration cap (default 20). */
  end_of_stroke_max_iterations?: number;
}

/** Velocity lookahead past the last modeled point. */
export interface StrokePredict {
  /** Points to emit, 1..=64 (default 8). */
  steps?: number;
  /** Seconds between lookahead points (default 1/min_output_rate). */
  interval?: number;
}

/** One modeled stroke point returned by `modelStroke`. */
export interface ModeledStrokePoint {
  t: number;
  x: number;
  y: number;
  pressure: number | null;
  tilt: number | null;
  orientation: number | null;
  /** Contact-segment index (0-based). */
  segment: number;
  /** Modeled tip speed, px/s. */
  speed: number;
}

/** Result of {@linkcode PrismDocument.modelStroke}. Read-only. */
export interface ModeledStroke {
  modeled: ModeledStrokePoint[];
  predicted: ModeledStrokePoint[];
}

/** Dynamics coefficients (-1..=1) mapping normalized pressure, velocity
 * (saturating at 10 brush diameters/second) and tilt (0..=1 over π/2 rad)
 * to size/opacity/flow multipliers. 0 disables a response. */
export interface BrushDynamics {
  size_pressure?: number;
  size_velocity?: number;
  size_tilt?: number;
  opacity_pressure?: number;
  opacity_velocity?: number;
  flow_pressure?: number;
  flow_velocity?: number;
}

/** Taper envelope over stroke arc length: ramps 0→1 across the first
 * `start` fraction and 1→0 across the last `end` fraction (start+end ≤ 1). */
export interface BrushTaper {
  start?: number;
  end?: number;
}

/** A document-level brush preset (≤ 64 per document). */
export interface Brush {
  id: number;
  name: string;
  /** Base dab diameter, px (0.1..=4096, default 20). */
  size: number;
  /** Master alpha multiplier 0..=1 (default 1). */
  opacity: number;
  /** Per-dab alpha multiplier 0..=1 (default 1); multiplies with opacity. */
  flow: number;
  /** Dab spacing as a fraction of `size` 0..=1 (default 0.25; 0 = every modeled point). */
  spacing: number;
  /** Fraction of the dab radius at full coverage 0..=1 (default 0.8). */
  hardness: number;
  color: Rgba;
  dynamics?: BrushDynamics;
  taper?: BrushTaper;
}

/** Partial brush fields for `addBrush`/`setBrush`/inline `brush` payloads. */
export type BrushPatch = Partial<Omit<Brush, "id">>;

/** `paintStroke` options. Exactly one of `brushId`/`brush` is required. */
export interface PaintStrokeOptions {
  /** Raster layer id. */
  id: number;
  /** Stored brush id, or an inline brush spec (fields as {@link BrushPatch}). */
  brush_id?: number;
  brush?: BrushPatch;
  samples: StrokeSample[];
  params?: StrokeModelParams;
  /** false = dry run: returns `{dabs, bounds}` without mutating (default true). */
  commit?: boolean;
}

/** Result of a committed `paintStroke`. */
export interface PaintStrokeResult {
  ok: true;
  dabs: number;
}

/** Result of `paintStroke` with `commit:false`. `bounds` is absent when the
 * stroke produces no dabs or lands fully off-canvas. */
export interface PaintStrokePreview {
  dabs: number;
  bounds?: { x: number; y: number; w: number; h: number };
}
