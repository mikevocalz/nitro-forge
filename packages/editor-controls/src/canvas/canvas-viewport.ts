/**
 * Document-to-screen mapping shared by the canvas guide controls
 * ({@linkcode CanvasViewport}). Document coordinates are the engine's pixels;
 * screen coordinates are layout units inside the overlay, whose top-left
 * corner is (0,0). The mapping is `screen = document * zoom + pan` on each
 * axis, and it never mirrors: canvas geometry stays left to right in RTL.
 */

/** How the document is shown in an overlay of `width` × `height` layout units. */
export interface CanvasViewport {
  /** Screen units per document pixel. Must be positive. */
  readonly zoom:number;
  /** Screen x of document x = 0. */
  readonly panX:number;
  /** Screen y of document y = 0. */
  readonly panY:number;
  readonly width:number;
  readonly height:number;
}
/** A point in document pixels. */
export interface DocPoint {
  readonly x:number;
  readonly y:number;
}
/**
 * A rectangle in document pixels, shaped like one entry of the engine's
 * `layerBounds` result (`w`/`h`, not `width`/`height`).
 */
export interface DocRect {
  readonly x:number;
  readonly y:number;
  readonly w:number;
  readonly h:number;
}
/** The two directions a ruler, a guide or a distribution runs. */
export type CanvasAxis="x"|"y";

/** Throws a `RangeError` naming the bad field when `viewport` cannot be drawn. */
export function validateViewport(viewport:CanvasViewport):void{
  const {zoom,panX,panY,width,height}=viewport;
  if(!Number.isFinite(zoom)||zoom<=0)throw new RangeError(`Canvas zoom must be a positive number, got ${zoom}`);
  if(![panX,panY].every(Number.isFinite))throw new RangeError("Canvas pan must be finite");
  if(![width,height].every(v=>Number.isFinite(v)&&v>=0))throw new RangeError("Canvas viewport size must be finite and not negative");
}
/** Screen coordinate of a document coordinate on one axis. */
export function docToScreen(viewport:CanvasViewport,axis:CanvasAxis,value:number):number{
  return axis==="x"?value*viewport.zoom+viewport.panX:value*viewport.zoom+viewport.panY;
}
/** Document coordinate under a screen coordinate on one axis. */
export function screenToDoc(viewport:CanvasViewport,axis:CanvasAxis,value:number):number{
  return axis==="x"?(value-viewport.panX)/viewport.zoom:(value-viewport.panY)/viewport.zoom;
}
/** Screen point of a document point. */
export function docPointToScreen(viewport:CanvasViewport,p:DocPoint):DocPoint{
  return {x:docToScreen(viewport,"x",p.x),y:docToScreen(viewport,"y",p.y)};
}
/** Document point under a screen point. */
export function screenPointToDoc(viewport:CanvasViewport,p:DocPoint):DocPoint{
  return {x:screenToDoc(viewport,"x",p.x),y:screenToDoc(viewport,"y",p.y)};
}
/** The part of the document the overlay shows, in document pixels. */
export function visibleDocRect(viewport:CanvasViewport):DocRect{
  return {x:screenToDoc(viewport,"x",0),y:screenToDoc(viewport,"y",0),w:viewport.width/viewport.zoom,h:viewport.height/viewport.zoom};
}
/** Throws a `RangeError` when a rectangle has a non-finite field or a negative size. */
export function validateDocRect(rect:DocRect,what="Rectangle"):void{
  if(![rect.x,rect.y,rect.w,rect.h].every(Number.isFinite))throw new RangeError(`${what} must have finite x, y, w and h`);
  if(rect.w<0||rect.h<0)throw new RangeError(`${what} must not have a negative size`);
}
/** Rounds away float noise such as 0.30000000000000004 so labels and commits stay clean. */
export function tidy(value:number,digits=6):number{
  const f=10**digits;
  const r=Math.round(value*f)/f;
  return Object.is(r,-0)?0:r;
}
