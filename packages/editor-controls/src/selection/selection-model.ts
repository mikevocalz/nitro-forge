/**
 * Engine-neutral pixel-selection contract for {@linkcode SelectionMarquee} and
 * {@linkcode MagicSelectionControls}. Shapes are in document pixels and map 1:1
 * onto the editor's `selectRegion`, `magicWand` and `modifySelection` operations;
 * the components never hold the selection itself.
 */

/** The marquee tools. `polygon` places points by click; `lasso` follows a drag. */
export type SelectionTool="rect"|"ellipse"|"polygon"|"lasso";
/** How a new region combines with the existing selection. */
export type SelectionMode="replace"|"add"|"subtract"|"intersect";

/** A rectangle in document pixels. */
export interface DocRect {
  readonly x:number;
  readonly y:number;
  readonly w:number;
  readonly h:number;
}
/** A point in document pixels, `[x, y]`. */
export type DocPoint=readonly [number,number];

/** A rectangle or the ellipse inscribed in it. */
export interface BoxShape extends DocRect {
  readonly kind:"rect"|"ellipse";
}
/** A closed polygon of at least three points. Lasso strokes are sent as polygons. */
export interface PolygonShape {
  readonly kind:"polygon";
  readonly points:readonly DocPoint[];
}
/** The region shape of a {@linkcode SelectRegionRequest}. */
export type SelectionShape=BoxShape|PolygonShape;

/**
 * One committed marquee gesture, sent through `SelectionMarqueeProps.onSelectRegion`.
 * Same fields as the engine's `selectRegion` op.
 */
export interface SelectRegionRequest {
  readonly shape:SelectionShape;
  readonly mode:SelectionMode;
  /** Edge softness in document pixels, 0..{@linkcode MAX_SELECTION_RADIUS}. Omitted when 0. */
  readonly feather?:number;
}

/** Tool labels in toolbar order. */
export const SELECTION_TOOLS=[
  {tool:"rect",label:"Rectangle"},
  {tool:"ellipse",label:"Ellipse"},
  {tool:"polygon",label:"Polygon"},
  {tool:"lasso",label:"Lasso"},
] as const satisfies readonly {tool:SelectionTool;label:string}[];
/** Mode labels in segmented-control order. */
export const SELECTION_MODES=[
  {mode:"replace",label:"New"},
  {mode:"add",label:"Add"},
  {mode:"subtract",label:"Subtract"},
  {mode:"intersect",label:"Intersect"},
] as const satisfies readonly {mode:SelectionMode;label:string}[];

/** Largest feather, grow, shrink or smooth radius the engine accepts, in document pixels. */
export const MAX_SELECTION_RADIUS=250;
/** Minimum edge of every interactive target, in points. */
export const SELECTION_TOUCH_TARGET=44;
/** View-space distance inside which a polygon click on the first point closes it. */
export const POLYGON_CLOSE_RADIUS=12;
/** Lasso points closer together than this (view units) are dropped while drawing. */
export const LASSO_MIN_SPACING=3;
/** Most points a lasso keeps; longer strokes are thinned evenly. */
export const LASSO_MAX_POINTS=2000;
/** Keyboard marquee step in document pixels; Page keys and Alt use ten times this. */
export const KEYBOARD_STEP=10;

/** Modifier keys held while a gesture starts. */
export interface SelectionModifiers {
  readonly shift?:boolean;
  readonly alt?:boolean;
}

/**
 * The mode a gesture uses: Shift adds, Alt subtracts, Shift+Alt intersects,
 * otherwise the toolbar's `base` mode.
 */
export function modeFromModifiers(base:SelectionMode,mods:SelectionModifiers):SelectionMode{
  if(mods.shift&&mods.alt)return "intersect";
  if(mods.shift)return "add";
  if(mods.alt)return "subtract";
  return base;
}

/** Scale between a view and the document it shows. */
export interface ViewMapping {
  /** View size in layout units. */
  readonly viewWidth:number;
  readonly viewHeight:number;
  /** Document size in pixels. */
  readonly docWidth:number;
  readonly docHeight:number;
}
/** Throws unless every size in `m` is a positive finite number. */
export function validateMapping(m:ViewMapping):void{
  if(![m.viewWidth,m.viewHeight,m.docWidth,m.docHeight].every(n=>Number.isFinite(n)&&n>0))
    throw new RangeError("Selection view and document sizes must be positive numbers");
}
const clamp=(v:number,lo:number,hi:number)=>Math.min(Math.max(v,lo),hi);
/** View point to document pixels, clamped to the document. */
export function viewToDoc(m:ViewMapping,x:number,y:number):DocPoint{
  validateMapping(m);if(![x,y].every(Number.isFinite))throw new RangeError("Selection coordinates must be finite");
  return [clamp(x/m.viewWidth,0,1)*m.docWidth,clamp(y/m.viewHeight,0,1)*m.docHeight];
}
/** Document point to view units. */
export function docToView(m:ViewMapping,p:DocPoint):DocPoint{
  return [p[0]*m.viewWidth/m.docWidth,p[1]*m.viewHeight/m.docHeight];
}
/** Document rectangle to view units. */
export function docRectToView(m:ViewMapping,r:DocRect):DocRect{
  const sx=m.viewWidth/m.docWidth,sy=m.viewHeight/m.docHeight;
  return {x:r.x*sx,y:r.y*sy,w:r.w*sx,h:r.h*sy};
}

/**
 * The box spanned by two corners, normalised to a positive size. With
 * `constrain` (Shift held after the drag starts) it is a square / circle.
 */
export function boxFromCorners(a:DocPoint,b:DocPoint,constrain=false):DocRect{
  let dx=b[0]-a[0],dy=b[1]-a[1];
  if(constrain){
    const side=Math.max(Math.abs(dx),Math.abs(dy));
    dx=Math.sign(dx||1)*side;dy=Math.sign(dy||1)*side;
  }
  return {x:Math.min(a[0],a[0]+dx),y:Math.min(a[1],a[1]+dy),w:Math.abs(dx),h:Math.abs(dy)};
}

/** Bounding box of a point list. Throws for an empty list. */
export function pointsBounds(points:readonly DocPoint[]):DocRect{
  if(points.length===0)throw new RangeError("Bounds need at least one point");
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const [x,y] of points){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}
/** Bounds of any {@linkcode SelectionShape}. */
export function shapeBounds(shape:SelectionShape):DocRect{
  return shape.kind==="polygon"?pointsBounds(shape.points):{x:shape.x,y:shape.y,w:shape.w,h:shape.h};
}

/** Appends a lasso point unless it is within {@linkcode LASSO_MIN_SPACING} of the last one. */
export function appendLassoPoint(points:readonly DocPoint[],p:DocPoint,minSpacing=LASSO_MIN_SPACING):readonly DocPoint[]{
  if(!p.every(Number.isFinite)||!Number.isFinite(minSpacing)||minSpacing<0)throw new RangeError("Invalid lasso point or spacing");
  const last=points[points.length-1];
  if(last&&Math.hypot(p[0]-last[0],p[1]-last[1])<minSpacing)return points;
  return [...(points.length>=LASSO_MAX_POINTS?thinPoints(points,Math.ceil(LASSO_MAX_POINTS/2)):points),p];
}
/** Thins a stroke evenly to at most `max` points, keeping the first and last. */
export function thinPoints(points:readonly DocPoint[],max=LASSO_MAX_POINTS):readonly DocPoint[]{
  if(!Number.isSafeInteger(max)||max<2||max>LASSO_MAX_POINTS)throw new RangeError("Invalid selection point budget");
  if(points.length<=max)return points;
  const out:DocPoint[]=[];
  for(let i=0;i<max;i++)out.push(points[Math.round(i*(points.length-1)/(max-1))]!);
  return out;
}
/** Whether a polygon click at `p` (view units) lands on the first point and should close it. */
export function closesPolygon(points:readonly DocPoint[],p:DocPoint,radius=POLYGON_CLOSE_RADIUS):boolean{
  const first=points[0];
  return points.length>=3&&!!first&&Math.hypot(p[0]-first[0],p[1]-first[1])<=radius;
}

/** Why a shape cannot be committed, or `undefined` when it can. */
export function shapeProblem(shape:SelectionShape):string|undefined{
  if(shape.kind==="polygon"){
    if(shape.points.length<3)return "A polygon needs at least three points";
    if(shape.points.length>50000)return "Polygon point budget exceeded";
    if(!shape.points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)))return "Polygon points must be numbers";
    const b=pointsBounds(shape.points);
    return b.w<1||b.h<1?"The selection is too small":undefined;
  }
  if(!["rect","ellipse"].includes(shape.kind))return "Unknown selection shape";
  if(![shape.x,shape.y,shape.w,shape.h,shape.x+shape.w,shape.y+shape.h].every(Number.isFinite))return "Selection edges must be numbers";
  return shape.w<1||shape.h<1?"The selection is too small":undefined;
}

/** Clamps a radius to 0..{@linkcode MAX_SELECTION_RADIUS} and whole pixels. */
export function clampRadius(r:number):number{
  if(!Number.isFinite(r))throw new RangeError("Radius must be a number");
  return Math.round(clamp(r,0,MAX_SELECTION_RADIUS));
}

/**
 * Builds the request for one gesture, or `undefined` when the shape is too
 * small to mean anything (a click without a drag), so nothing is committed.
 */
export function buildSelectRegion(shape:SelectionShape,mode:SelectionMode,feather:number):SelectRegionRequest|undefined{
  if(!SELECTION_MODES.some(item=>item.mode===mode))throw new RangeError("Unknown selection mode");
  if(shapeProblem(shape)!==undefined)return undefined;
  const r=clampRadius(feather);
  const rounded:SelectionShape=shape.kind==="polygon"
    ?{kind:"polygon",points:thinPoints(shape.points).map(([x,y])=>[round2(x),round2(y)] as const)}
    :{kind:shape.kind,x:round2(shape.x),y:round2(shape.y),w:round2(shape.w),h:round2(shape.h)};
  return r>0?{shape:rounded,mode,feather:r}:{shape:rounded,mode};
}
const round2=(n:number)=>Math.round(n*100)/100;

/** Keyboard input the marquee and wand surfaces understand. */
export interface SelectionKey {
  readonly key?:string;
  readonly shiftKey?:boolean;
  readonly altKey?:boolean;
  readonly ctrlKey?:boolean;
  readonly metaKey?:boolean;
}
/** A command resolved from a key press on the selection surface. */
export type SelectionKeyCommand=
  |{readonly type:"selectAll"}|{readonly type:"deselect"}|{readonly type:"invert"}
  |{readonly type:"start"}|{readonly type:"commit"}|{readonly type:"cancel"}|{readonly type:"undoPoint"}
  |{readonly type:"move";readonly dx:number;readonly dy:number}
  |{readonly type:"resize";readonly dw:number;readonly dh:number};

/**
 * Maps a key press to a selection command. Ctrl/Cmd+A selects all, Ctrl/Cmd+D
 * deselects, Ctrl/Cmd+Shift+I inverts. Enter starts and commits the keyboard
 * marquee, Escape cancels, Backspace removes the last polygon point. Arrows move
 * the marquee by {@linkcode KEYBOARD_STEP} (Alt: ten times), Shift+arrows resize it.
 * Arrows stay in canvas (left-to-right) space in RTL layouts.
 */
export function resolveSelectionKey(e:SelectionKey):SelectionKeyCommand|undefined{
  const mod=!!(e.ctrlKey||e.metaKey);
  const k=e.key;
  if(mod){
    if(k==="a"||k==="A")return {type:"selectAll"};
    if(k==="d"||k==="D")return {type:"deselect"};
    if((k==="i"||k==="I")&&e.shiftKey)return {type:"invert"};
    return undefined;
  }
  if(k==="Enter")return {type:"commit"};
  if(k==="Escape")return {type:"cancel"};
  if(k==="Backspace")return {type:"undoPoint"};
  const step=KEYBOARD_STEP*(e.altKey?10:1);
  const d=k==="ArrowLeft"?[-step,0]:k==="ArrowRight"?[step,0]:k==="ArrowUp"?[0,-step]:k==="ArrowDown"?[0,step]:undefined;
  if(!d)return undefined;
  return e.shiftKey?{type:"resize",dw:d[0]!,dh:d[1]!}:{type:"move",dx:d[0]!,dy:d[1]!};
}

/** The rectangle a keyboard marquee starts with: the middle half of the document. */
export function initialKeyboardRect(docWidth:number,docHeight:number):DocRect{
  return {x:Math.round(docWidth/4),y:Math.round(docHeight/4),w:Math.max(1,Math.round(docWidth/2)),h:Math.max(1,Math.round(docHeight/2))};
}
/** Moves a keyboard marquee, keeping it inside the document. */
export function moveKeyboardRect(r:DocRect,dx:number,dy:number,docWidth:number,docHeight:number):DocRect{
  return {...r,x:clamp(r.x+dx,0,Math.max(0,docWidth-r.w)),y:clamp(r.y+dy,0,Math.max(0,docHeight-r.h))};
}
/** Resizes a keyboard marquee from its bottom-right corner, at least 1 px and inside the document. */
export function resizeKeyboardRect(r:DocRect,dw:number,dh:number,docWidth:number,docHeight:number):DocRect{
  return {...r,w:clamp(r.w+dw,1,docWidth-r.x),h:clamp(r.h+dh,1,docHeight-r.y)};
}

const px=(n:number)=>Math.round(n)+" px";
/** Spoken description of a region, e.g. "Rectangle 200 by 120 px at 40, 30". */
export function describeShape(shape:SelectionShape):string{
  const b=shapeBounds(shape);
  const name=shape.kind==="polygon"?`Polygon of ${shape.points.length} points,`:shape.kind==="rect"?"Rectangle":"Ellipse";
  return `${name} ${Math.round(b.w)} by ${px(b.h)} at ${Math.round(b.x)}, ${Math.round(b.y)}`;
}
/** Spoken description of the committed selection bounds, or "Nothing selected". */
export function describeSelection(bounds:DocRect|undefined):string{
  return bounds?`Selection ${Math.round(bounds.w)} by ${px(bounds.h)} at ${Math.round(bounds.x)}, ${Math.round(bounds.y)}`:"Nothing selected";
}
/** Label of a mode, e.g. "Subtract". */
export function modeLabel(mode:SelectionMode):string{
  return SELECTION_MODES.find(m=>m.mode===mode)!.label;
}
/** Label of a tool, e.g. "Lasso". */
export function toolLabel(tool:SelectionTool):string{
  return SELECTION_TOOLS.find(t=>t.tool===tool)!.label;
}
/** Short instruction for the tool, shown under the canvas and read as the surface hint. */
export function toolHint(tool:SelectionTool):string{
  switch(tool){
    case "rect":return "Drag to select a rectangle. Shift adds, Alt subtracts, both intersect.";
    case "ellipse":return "Drag to select an ellipse. Shift adds, Alt subtracts, both intersect.";
    case "polygon":return "Click to place points. Click the first point or press Enter to close.";
    case "lasso":return "Drag around the area to select. Release to close the shape.";
  }
}
/** Throws for a tool or mode the marquee cannot draw. */
export function validateSelectionProps(p:{tool:string;mode:string;feather:number;bounds?:DocRect|undefined}):void{
  if(!SELECTION_TOOLS.some(t=>t.tool===p.tool))throw new RangeError(`Unknown selection tool "${p.tool}"`);
  if(!SELECTION_MODES.some(m=>m.mode===p.mode))throw new RangeError(`Unknown selection mode "${p.mode}"`);
  if(!Number.isFinite(p.feather)||p.feather<0||p.feather>MAX_SELECTION_RADIUS)
    throw new RangeError(`Feather must be 0..${MAX_SELECTION_RADIUS}`);
  if(p.bounds&&(![p.bounds.x,p.bounds.y,p.bounds.w,p.bounds.h,p.bounds.x+p.bounds.w,p.bounds.y+p.bounds.h].every(Number.isFinite)||p.bounds.w<0||p.bounds.h<0))
    throw new RangeError("Selection bounds must be numbers");
}

/** SVG-free polyline segments for drawing a point path with Views: start, length and angle (degrees). */
export interface Segment {
  readonly x:number;
  readonly y:number;
  readonly length:number;
  readonly angle:number;
}
/** The segments joining `points` (view units), closing back to the first when `closed`. */
export function pathSegments(points:readonly DocPoint[],closed:boolean):readonly Segment[]{
  const out:Segment[]=[];
  const n=points.length;
  for(let i=0;i<(closed?n:n-1);i++){
    const a=points[i]!,b=points[(i+1)%n]!;
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const length=Math.hypot(dx,dy);
    if(length<0.5)continue;
    out.push({x:a[0],y:a[1],length,angle:Math.atan2(dy,dx)*180/Math.PI});
  }
  return out;
}
/** Most segments drawn for an in-progress path; denser paths are thinned for drawing only. */
export const MAX_DRAWN_SEGMENTS=400;
