/**
 * Pure rules for `PresenterInkOverlay` and `PresenterInkStrip` (J-14): tools,
 * keyboard shortcuts, normalized stroke geometry, eraser hit tests and the
 * laser trail. Points are fractions 0..1 of the slide rectangle, so a stroke
 * drawn on the presenter's screen lands in the same place on the audience view
 * whatever size each one renders the slide.
 *
 * `laser` is a separate union from `InkTool`: adding it there would break
 * hosts with exhaustive `Record<InkTool, ...>` maps, and `L` already selects
 * the lasso in `resolveInkShortcut`.
 */
import {INK_SIZE_POINTS,INK_SIZES,type InkSize} from "../ink/ink-model.ts";
import type {KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";

/** A presenter tool. `laser` draws nothing that lasts. */
export type PresenterInkTool="laser"|"pen"|"highlighter"|"eraser";
/** The overlay's mode: a tool, or `off` to let pointer input through to the slide. */
export type PresenterInkMode=PresenterInkTool|"off";
/** Tools whose strokes are kept in the host's `strokes`. */
export type PresenterStrokeTool="pen"|"highlighter";

/** Strip order. */
export const PRESENTER_INK_TOOLS=["laser","pen","highlighter","eraser"] as const satisfies readonly PresenterInkTool[];

/** Visible names. */
export const PRESENTER_INK_TOOL_LABELS={
  laser:"Laser",pen:"Pen",highlighter:"Highlighter",eraser:"Eraser",
} as const satisfies Record<PresenterInkTool,string>;

/** Shortcut letters, shown in hints. */
export const PRESENTER_INK_SHORTCUTS={
  laser:"L",pen:"P",highlighter:"H",eraser:"E",
} as const satisfies Record<PresenterInkTool,string>;

/** A point in slide space: x and y are fractions 0..1 of the slide's width and height. */
export interface PresenterInkPoint {
  readonly x:number;
  readonly y:number;
  /** Pen or touch force 0..1, only when the hardware reported one. */
  readonly pressure?:number;
}

/** One pen or highlighter stroke. The host stores these; the overlay draws them. */
export interface PresenterInkStroke {
  /** Made by the overlay when the stroke begins; stable for the stroke's life. */
  readonly id:string;
  readonly tool:PresenterStrokeTool;
  /** Any React Native color string. */
  readonly color:string;
  /** Width step; drawn at `INK_SIZE_POINTS[size]` on a slide 960 units wide, scaled to the rendered width. */
  readonly size:InkSize;
  readonly points:readonly PresenterInkPoint[];
}

/** Slide width the stroke sizes are defined at. A 1920-wide view draws strokes twice as wide. */
export const PRESENTER_REFERENCE_WIDTH=960;
/** The laser trail fades over this many milliseconds. */
export const LASER_TRAIL_MS=600;
/** At most this many trail points are kept and drawn. */
export const LASER_TRAIL_MAX=24;
/** Eraser reach around the pointer, in rendered points. */
export const ERASER_RADIUS=12;
/** Points closer than this to the previous one, in rendered points, are dropped. */
export const MIN_POINT_SPACING=1.5;
/** Highlighter strokes are drawn this much wider than the pen, as on the Forge board. */
export const HIGHLIGHTER_WIDTH_FACTOR=4.5;
/** Highlighter stroke opacity, applied to the whole stroke so overlapping segments do not darken. */
export const HIGHLIGHTER_OPACITY=0.4;

/** A size in rendered points. */
export interface InkViewSize {
  readonly width:number;
  readonly height:number;
}

/** What a key press asks the presenter overlay to do. */
export type PresenterInkCommand=
  |Readonly<{type:"tool";tool:PresenterInkTool}>
  |Readonly<{type:"exit"}>
  |Readonly<{type:"remove-last"}>;

/** Keyboard event fields {@linkcode resolvePresenterInkKey} reads. */
export interface PresenterInkKeyEvent extends KeyEventLike {
  readonly metaKey?:boolean;
  readonly ctrlKey?:boolean;
  readonly shiftKey?:boolean;
  readonly altKey?:boolean;
}

const TOOL_KEYS={l:"laser",p:"pen",h:"highlighter",e:"eraser"} as const satisfies Record<string,PresenterInkTool>;

/**
 * L laser, P pen, H highlighter, E eraser, Escape exits drawing, Cmd/Ctrl+Z
 * removes the last stroke. Letters with a modifier held are ignored so app
 * menu shortcuts still work; Shift+Cmd/Ctrl+Z (redo) is not handled.
 */
export function resolvePresenterInkKey(event:PresenterInkKeyEvent):PresenterInkCommand|undefined{
  const raw=event.key??event.nativeEvent?.key;
  if(typeof raw!=="string")return undefined;
  const key=raw.length===1?raw.toLowerCase():raw;
  const command=event.metaKey===true||event.ctrlKey===true;
  if(command){
    return key==="z"&&event.shiftKey!==true&&event.altKey!==true?{type:"remove-last"}:undefined;
  }
  if(event.altKey===true)return undefined;
  if(key==="Escape")return {type:"exit"};
  if(Object.hasOwn(TOOL_KEYS,key))return {type:"tool",tool:TOOL_KEYS[key as keyof typeof TOOL_KEYS]};
  return undefined;
}

/** Spoken and visible status for a mode. */
export function presenterModeStatus(mode:PresenterInkMode):string{
  switch(mode){
    case "off":return "Drawing off";
    case "laser":return "Laser pointer on";
    case "pen":return "Pen on";
    case "highlighter":return "Highlighter on";
    case "eraser":return "Eraser on. Touch a stroke to remove it";
  }
}

/** A rendered point as slide space, clamped to 0..1. Throws while the view has no size. */
export function normalizePoint(x:number,y:number,view:InkViewSize,pressure?:number):PresenterInkPoint{
  if(!(view.width>0)||!(view.height>0))throw new RangeError("The ink view has no size yet");
  const clamp=(n:number)=>Math.min(1,Math.max(0,n));
  const p={x:clamp(x/view.width),y:clamp(y/view.height)};
  return pressure!==undefined&&Number.isFinite(pressure)&&pressure>=0?{...p,pressure:clamp(pressure)}:p;
}

/** `points` plus `next`, unless `next` is within {@linkcode MIN_POINT_SPACING} of the last point. */
export function appendPoint(points:readonly PresenterInkPoint[],next:PresenterInkPoint,view:InkViewSize):readonly PresenterInkPoint[]{
  const last=points[points.length-1];
  if(last&&Math.hypot((next.x-last.x)*view.width,(next.y-last.y)*view.height)<MIN_POINT_SPACING)return points;
  return [...points,next];
}

/** Rendered stroke width for `size`, `tool` and a view `width` points wide. */
export function strokeWidth(size:InkSize,tool:PresenterStrokeTool,viewWidth:number):number{
  if(!INK_SIZES.includes(size))throw new RangeError("Unknown ink size: "+String(size));
  const base=INK_SIZE_POINTS[size]*(tool==="highlighter"?HIGHLIGHTER_WIDTH_FACTOR:1);
  return Math.max(1,base*(viewWidth>0?viewWidth/PRESENTER_REFERENCE_WIDTH:1));
}

/** Width multiplier for a pressure reading: 0.5 at the lightest touch, 1.5 at full force, 1 when unknown. */
export function pressureScale(pressure:number|undefined):number{
  return pressure===undefined?1:0.5+Math.min(1,Math.max(0,pressure));
}

/**
 * One drawn piece of a stroke: a capsule from one point to the next, laid out
 * as an absolutely positioned box rotated by `angle` degrees about its center.
 */
export interface StrokeSegment {
  readonly left:number;
  readonly top:number;
  readonly length:number;
  readonly thickness:number;
  readonly angle:number;
}

/**
 * Capsules for a stroke in a view of `view` size. A one-point stroke is a dot.
 * Each capsule is extended by its thickness so the round ends join.
 */
export function strokeSegments(stroke:Pick<PresenterInkStroke,"points"|"size"|"tool">,view:InkViewSize):StrokeSegment[]{
  const base=strokeWidth(stroke.size,stroke.tool,view.width);
  const at=(p:PresenterInkPoint)=>({x:p.x*view.width,y:p.y*view.height,w:base*pressureScale(p.pressure)});
  const pts=stroke.points.map(at);
  if(pts.length===0)return [];
  if(pts.length===1){
    const p=pts[0]!;
    return [{left:p.x-p.w/2,top:p.y-p.w/2,length:p.w,thickness:p.w,angle:0}];
  }
  const out:StrokeSegment[]=[];
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1]!,b=pts[i]!;
    const thickness=(a.w+b.w)/2;
    const length=Math.hypot(b.x-a.x,b.y-a.y)+thickness;
    const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
    out.push({left:cx-length/2,top:cy-thickness/2,length,thickness,angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI});
  }
  return out;
}

const segmentDistance=(px:number,py:number,ax:number,ay:number,bx:number,by:number)=>{
  const dx=bx-ax,dy=by-ay;
  const len=dx*dx+dy*dy;
  const t=len===0?0:Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
};

/** Whether the eraser at `point` touches `stroke`, measured in rendered points. */
export function strokeHit(stroke:PresenterInkStroke,point:PresenterInkPoint,view:InkViewSize,radius=ERASER_RADIUS):boolean{
  const reach=radius+strokeWidth(stroke.size,stroke.tool,view.width)/2;
  const px=point.x*view.width,py=point.y*view.height;
  const pts=stroke.points;
  if(pts.length===1)return Math.hypot(pts[0]!.x*view.width-px,pts[0]!.y*view.height-py)<=reach;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1]!,b=pts[i]!;
    if(segmentDistance(px,py,a.x*view.width,a.y*view.height,b.x*view.width,b.y*view.height)<=reach)return true;
  }
  return false;
}

/** Ids of strokes under the eraser, topmost (last drawn) first, skipping ids in `already`. */
export function strokesUnderEraser(strokes:readonly PresenterInkStroke[],point:PresenterInkPoint,view:InkViewSize,
  already:ReadonlySet<string>=new Set()):string[]{
  const hits:string[]=[];
  for(let i=strokes.length-1;i>=0;i--){
    const s=strokes[i]!;
    if(!already.has(s.id)&&strokeHit(s,point,view))hits.push(s.id);
  }
  return hits;
}

/** A laser trail sample with its capture time in milliseconds. */
export interface LaserSample extends PresenterInkPoint {
  readonly t:number;
}

/** Samples younger than `duration` at `now`, newest last, at most `max` of them. */
export function trimLaserTrail(samples:readonly LaserSample[],now:number,duration=LASER_TRAIL_MS,max=LASER_TRAIL_MAX):LaserSample[]{
  const fresh=samples.filter(s=>now-s.t<duration);
  return fresh.length>max?fresh.slice(fresh.length-max):fresh;
}

/** Opacity of a trail sample of `age` ms: 0.6 when new, 0 at `duration`. */
export function laserTrailOpacity(age:number,duration=LASER_TRAIL_MS):number{
  if(!(duration>0))throw new RangeError("Trail duration must be positive");
  return Math.max(0,Math.min(1,1-age/duration))*0.6;
}

/** "ink-<time>-<n>": unique within a session; the host may keep its own ids alongside. */
export function createStrokeIdFactory(now:()=>number=Date.now):()=>string{
  let n=0;
  return ()=>"ink-"+now().toString(36)+"-"+(n++).toString(36);
}

/** Why Clear cannot run, or `undefined` when it can. */
export function clearDisabledReason(strokes:readonly PresenterInkStroke[]):string|undefined{
  return strokes.length===0?"No ink on this slide to clear":undefined;
}

/**
 * Throws a RangeError for strokes the overlay cannot draw honestly: duplicate
 * or empty ids, unknown tools or sizes, no points, or points outside 0..1.
 */
export function validatePresenterStrokes(strokes:readonly PresenterInkStroke[]):void{
  const ids=new Set<string>();
  for(const s of strokes){
    if(!s.id||ids.has(s.id))throw new RangeError("Duplicate or empty stroke id: "+s.id);
    ids.add(s.id);
    if(s.tool!=="pen"&&s.tool!=="highlighter")throw new RangeError("Unknown stroke tool: "+String(s.tool));
    if(!INK_SIZES.includes(s.size))throw new RangeError("Unknown ink size: "+String(s.size));
    if(s.points.length===0)throw new RangeError("Stroke has no points: "+s.id);
    for(const p of s.points){
      if(!(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1))throw new RangeError("Stroke point outside the slide: "+s.id);
      if(p.pressure!==undefined&&!(p.pressure>=0&&p.pressure<=1))throw new RangeError("Pressure must be 0..1: "+s.id);
    }
  }
}
