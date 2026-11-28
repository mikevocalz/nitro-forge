/**
 * Engine-neutral vector contract shared by the vector-tools cluster
 * ({@linkcode PathNode}, {@linkcode Subpath}, {@linkcode Paint}, {@linkcode Stroke}).
 * Field names and limits mirror the Prism v2 vector ops so a host adapter
 * passes these values to the engine unchanged. Nothing here renders pixels.
 */

/** An 8-bit RGBA color, each channel 0..255 (alpha 255 is opaque). */
export type Rgba=readonly [r:number,g:number,b:number,a:number];
/** How a {@linkcode PathNode}'s handles relate: free, collinear, or collinear with equal length. */
export type NodeKind="corner"|"smooth"|"symmetric";
/** Handle offset from its node, `[dx, dy]` in content coordinates. */
export type HandleOffset=readonly [dx:number,dy:number];

/**
 * One path node in content coordinates. `in` leads into the node from the
 * previous segment and `out` leaves toward the next one; a segment with
 * neither handle is a straight line, otherwise a cubic Bézier.
 * @see {@linkcode Subpath.nodes}
 */
export interface PathNode {
  readonly x:number;
  readonly y:number;
  readonly in?:HandleOffset;
  readonly out?:HandleOffset;
  readonly kind:NodeKind;
}
/** A run of {@linkcode PathNode}s; `closed` adds a segment from the last node back to the first. */
export interface Subpath {
  readonly closed:boolean;
  /** At least one node. */
  readonly nodes:readonly PathNode[];
}
/** Identifies one node: `subpath` and `index` are positions in the path's arrays. */
export interface NodeRef {
  readonly subpath:number;
  readonly index:number;
}

/** A gradient color stop. `offset` is 0..1 along the gradient. */
export interface GradientStop {
  readonly offset:number;
  readonly color:Rgba;
}
/** Flat color paint. */
export interface SolidPaint {
  readonly type:"solid";
  readonly color:Rgba;
}
/** Linear gradient from `(x0, y0)` to `(x1, y1)` in content coordinates. */
export interface LinearPaint {
  readonly type:"linear";
  readonly x0:number;
  readonly y0:number;
  readonly x1:number;
  readonly y1:number;
  readonly stops:readonly GradientStop[];
}
/** Radial gradient around `(cx, cy)` with radius `r`; `fx`/`fy` set a focal point strictly inside the circle. */
export interface RadialPaint {
  readonly type:"radial";
  readonly cx:number;
  readonly cy:number;
  readonly r:number;
  readonly fx?:number;
  readonly fy?:number;
  readonly stops:readonly GradientStop[];
}
/** Fill or stroke paint. Gradient coordinates are in content space. */
export type Paint=SolidPaint|LinearPaint|RadialPaint;
/** Gradient variants of {@linkcode Paint}, the ones with stops. */
export type GradientPaint=LinearPaint|RadialPaint;

export type LineJoin="miter"|"round"|"bevel";
export type LineCap="butt"|"round"|"square";
export type FillRule="nonzero"|"evenodd";
/** `fill-stroke` paints the fill first, so the stroke sits on top. */
export type PaintOrder="fill-stroke"|"stroke-fill";
export type BooleanOp="union"|"subtract"|"intersect"|"exclude";

/** Stroke settings; `dash` lengths and `dash_offset` are in content units. */
export interface Stroke {
  readonly paint:Paint;
  readonly width:number;
  readonly join:LineJoin;
  readonly cap:LineCap;
  readonly miter_limit:number;
  readonly dash:readonly number[];
  readonly dash_offset:number;
}

/** Most stops a gradient may carry. */
export const MAX_GRADIENT_STOPS=256;
/** Fewest stops a gradient may carry. */
export const MIN_GRADIENT_STOPS=2;
/** Miter limit range the engine accepts. */
export const MITER_LIMIT_RANGE={min:1,max:1000} as const;
/** Most entries in a dash pattern. */
export const MAX_DASH_ENTRIES=64;

/**
 * 2D affine map from content coordinates to overlay (view) coordinates,
 * `[a, b, c, d, e, f]`: `x' = a*x + c*y + e`, `y' = b*x + d*y + f`. The host
 * composes its zoom, pan and the layer transform into one matrix.
 */
export type ViewTransform=readonly [a:number,b:number,c:number,d:number,e:number,f:number];
/** The identity {@linkcode ViewTransform}: content units are view points. */
export const IDENTITY_TRANSFORM:ViewTransform=[1,0,0,1,0,0];
/** A 2D point. */
export interface Point {
  readonly x:number;
  readonly y:number;
}

const finite=(...values:number[])=>values.every(Number.isFinite);

/** Throws a RangeError unless `t` is an invertible matrix of finite numbers. */
export function validateTransform(t:ViewTransform):void{
  if(t.length!==6||!finite(...t))throw new RangeError("View transform needs six finite numbers");
  const determinant=t[0]*t[3]-t[1]*t[2];
  if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-12)throw new RangeError("View transform is not invertible");
}
/** Content point to view point. */
export function toView(t:ViewTransform,p:Point):Point{
  return {x:t[0]*p.x+t[2]*p.y+t[4],y:t[1]*p.x+t[3]*p.y+t[5]};
}
/** View point to content point. */
export function toContent(t:ViewTransform,p:Point):Point{
  const det=t[0]*t[3]-t[1]*t[2];
  const x=p.x-t[4],y=p.y-t[5];
  return {x:(t[3]*x-t[2]*y)/det,y:(-t[1]*x+t[0]*y)/det};
}
/** A view-space drag distance as a content-space distance (translation ignored). */
export function deltaToContent(t:ViewTransform,dx:number,dy:number):Point{
  const det=t[0]*t[3]-t[1]*t[2];
  return {x:(t[3]*dx-t[2]*dy)/det,y:(-t[1]*dx+t[0]*dy)/det};
}
/** Average view points per content unit, for converting a touch tolerance into content units. */
export function transformScale(t:ViewTransform):number{
  return Math.sqrt(Math.abs(t[0]*t[3]-t[1]*t[2]));
}

/** Throws a RangeError unless `color` has four integer channels in 0..255. */
export function validateRgba(color:Rgba):void{
  if(color.length!==4||!color.every(c=>Number.isInteger(c)&&c>=0&&c<=255))
    throw new RangeError("Color needs four integer channels in 0..255");
}
/** CSS `rgba()` text for a {@linkcode Rgba}, for drawing swatches. */
export function rgbaToCss(color:Rgba):string{
  return `rgba(${color[0]},${color[1]},${color[2]},${Math.round(color[3]/255*1000)/1000})`;
}
/** Spoken description of a color: hex digits plus opacity when not opaque, e.g. "#1F7A6D, 50% opacity". */
export function describeRgba(color:Rgba):string{
  const hex="#"+color.slice(0,3).map(c=>c.toString(16).padStart(2,"0")).join("").toUpperCase();
  return color[3]===255?hex:`${hex}, ${Math.round(color[3]/255*100)}% opacity`;
}

/** Throws a RangeError naming the first rule `stops` breaks (count, range, order, color). */
export function validateStops(stops:readonly GradientStop[]):void{
  if(stops.length<MIN_GRADIENT_STOPS)throw new RangeError("A gradient needs at least two stops");
  if(stops.length>MAX_GRADIENT_STOPS)throw new RangeError("A gradient has at most 256 stops");
  let last=0;
  for(const stop of stops){
    if(!Number.isFinite(stop.offset)||stop.offset<0||stop.offset>1)throw new RangeError("Stop offsets must be in 0..1");
    if(stop.offset<last)throw new RangeError("Stop offsets must not decrease");
    last=stop.offset;
    validateRgba(stop.color);
  }
}
/** Throws a RangeError when the engine would reject `paint`. */
export function validatePaint(paint:Paint):void{
  switch(paint.type){
    case "solid":validateRgba(paint.color);return;
    case "linear":
      if(!finite(paint.x0,paint.y0,paint.x1,paint.y1))throw new RangeError("Gradient points must be finite");
      validateStops(paint.stops);return;
    case "radial":{
      if(!finite(paint.cx,paint.cy,paint.r)||paint.r<=0)
        throw new RangeError("A radial gradient needs a finite center and a positive radius");
      if((paint.fx===undefined)!==(paint.fy===undefined))throw new RangeError("A focal point needs both fx and fy");
      if(paint.fx!==undefined&&paint.fy!==undefined){
        if(!finite(paint.fx,paint.fy))throw new RangeError("The focal point must be finite");
        if(Math.hypot(paint.fx-paint.cx,paint.fy-paint.cy)>=paint.r)
          throw new RangeError("The focal point must lie strictly inside the gradient circle");
      }
      validateStops(paint.stops);return;
    }
    default:throw new RangeError("Unknown paint type: "+String((paint as {type:unknown}).type));
  }
}
/** Throws a RangeError when the engine would reject `stroke`. */
export function validateStroke(stroke:Stroke):void{
  validatePaint(stroke.paint);
  if(!Number.isFinite(stroke.width)||stroke.width<=0)throw new RangeError("Stroke width must be positive");
  if(!["miter","round","bevel"].includes(stroke.join))throw new RangeError("Unknown line join: "+stroke.join);
  if(!["butt","round","square"].includes(stroke.cap))throw new RangeError("Unknown line cap: "+stroke.cap);
  if(!Number.isFinite(stroke.miter_limit)||stroke.miter_limit<MITER_LIMIT_RANGE.min||stroke.miter_limit>MITER_LIMIT_RANGE.max)
    throw new RangeError("Miter limit must be in 1..1000");
  validateDash(stroke.dash);
  if(!Number.isFinite(stroke.dash_offset))throw new RangeError("Dash offset must be finite");
}
/** Throws a RangeError unless `dash` is empty or up to 64 non-negative lengths with a positive total. */
export function validateDash(dash:readonly number[]):void{
  if(dash.length>MAX_DASH_ENTRIES)throw new RangeError("A dash pattern has at most 64 entries");
  if(dash.some(d=>!Number.isFinite(d)||d<0))throw new RangeError("Dash lengths must be finite and not negative");
  if(dash.length>0&&dash.reduce((a,b)=>a+b,0)<=0)throw new RangeError("A dash pattern needs a positive total length");
}

/**
 * Availability of a command. Disabled commands carry the reason the UI shows,
 * so no control is silently dead.
 */
export type Availability=Readonly<{enabled:true}>|Readonly<{enabled:false;reason:string}>;
/** The shared enabled {@linkcode Availability}. */
export const AVAILABLE:Availability=Object.freeze({enabled:true});
/** A disabled {@linkcode Availability} with its reason. */
export function unavailable(reason:string):Availability{
  return {enabled:false,reason};
}
/** The reason of a disabled {@linkcode Availability}, or `undefined` when enabled. */
export function availabilityReason(a:Availability):string|undefined{
  return a.enabled?undefined:a.reason;
}

/** Keyboard nudge distance: 1 unit, or 10 with Shift. `undefined` for keys that do not nudge. */
export function nudgeDelta(key:string|undefined,shift:boolean):Point|undefined{
  const n=shift?10:1;
  switch(key){
    case "ArrowLeft":return {x:-n,y:0};
    case "ArrowRight":return {x:n,y:0};
    case "ArrowUp":return {x:0,y:-n};
    case "ArrowDown":return {x:0,y:n};
    default:return undefined;
  }
}
/** Rounds to 1/1000 so displayed and committed coordinates agree and float noise (and -0) stays out of the document. */
export function roundCoord(value:number):number{
  const r=Math.round(value*1000)/1000;
  return r===0?0:r;
}
