import type {FrameRate} from "../timebase.ts";
import {zoomLimits} from "./ruler.ts";

/**
 * The visible slice of a timeline: which frame is at the left edge and how many
 * pixels a frame takes. View state, not document state: the host keeps it in
 * its own store and the engine never sees it. Time always runs left to right,
 * in RTL layouts too, as in other media editors.
 */
export interface TimelineViewport {
  /** Frame at the left edge; fractional while scrolled between frames. */
  readonly startFrame:number;
  readonly pxPerFrame:number;
  /** Width of the lanes area in layout units. */
  readonly widthPx:number;
}
/** A frame range, `start` inclusive and `end` exclusive. */
export interface FrameRange {
  readonly start:number;
  readonly end:number;
}

const assertViewport=(v:TimelineViewport)=>{
  if(![v.startFrame,v.pxPerFrame,v.widthPx].every(Number.isFinite)||v.pxPerFrame<=0||v.widthPx<0)
    throw new RangeError("Timeline viewport needs a finite start, positive zoom and nonnegative width");
};

/** Layout x of `frame`. */
export function frameToX(v:TimelineViewport,frame:number):number{
  assertViewport(v);
  return (frame-v.startFrame)*v.pxPerFrame;
}
/** Fractional frame at layout x. */
export function xToFrame(v:TimelineViewport,x:number):number{
  assertViewport(v);
  return v.startFrame+x/v.pxPerFrame;
}
/** Frames visible across the viewport. */
export const visibleFrames=(v:TimelineViewport)=>v.widthPx/v.pxPerFrame;
/** The visible frame range, rounded outward to whole frames. */
export function visibleRange(v:TimelineViewport):FrameRange{
  assertViewport(v);
  return {start:Math.floor(v.startFrame),end:Math.ceil(v.startFrame+visibleFrames(v))};
}

/**
 * The viewport scrolled into `[0, duration]`. The right edge may overscroll by a
 * quarter of the view so the last clip can sit away from the edge; a timeline
 * shorter than the view pins to 0.
 */
export function clampViewport(v:TimelineViewport,durationFrames:number):TimelineViewport{
  assertViewport(v);
  const span=visibleFrames(v);
  const max=Math.max(0,durationFrames-span*0.75);
  return {...v,startFrame:Math.min(Math.max(0,v.startFrame),max)};
}

/**
 * Zoom by `factor` keeping the frame under `anchorX` fixed (the pointer, the
 * pinch center or the playhead), clamped to {@linkcode zoomLimits}.
 */
export function zoomAt(v:TimelineViewport,anchorX:number,factor:number,durationFrames:number,rate:FrameRate):TimelineViewport{
  assertViewport(v);
  if(!(factor>0)||!Number.isFinite(factor))throw new RangeError("Zoom factor must be positive");
  const limits=zoomLimits(Math.max(1,v.widthPx),durationFrames,rate);
  const pxPerFrame=Math.min(limits.max,Math.max(limits.min,v.pxPerFrame*factor));
  const anchor=xToFrame(v,anchorX);
  return clampViewport({...v,pxPerFrame,startFrame:anchor-anchorX/pxPerFrame},durationFrames);
}

/** Scroll by `dx` layout units (positive moves later in time). */
export function scrollBy(v:TimelineViewport,dx:number,durationFrames:number):TimelineViewport{
  assertViewport(v);
  return clampViewport({...v,startFrame:v.startFrame+dx/v.pxPerFrame},durationFrames);
}

/** Zoom and scroll so `range` fills the view with `paddingPx` on each side. */
export function fitRange(v:TimelineViewport,range:FrameRange,durationFrames:number,rate:FrameRate,paddingPx=24):TimelineViewport{
  assertViewport(v);
  const frames=Math.max(1,range.end-range.start);
  const usable=Math.max(1,v.widthPx-2*paddingPx);
  const limits=zoomLimits(Math.max(1,v.widthPx),durationFrames,rate);
  const pxPerFrame=Math.min(limits.max,Math.max(limits.min,usable/frames));
  const center=(range.start+range.end)/2;
  return clampViewport({...v,pxPerFrame,startFrame:center-v.widthPx/2/pxPerFrame},durationFrames);
}

/**
 * Keep the playhead visible during playback. `page` flips a full view when the
 * playhead passes the right edge (or jumps behind the left edge); `center` keeps
 * it in the middle. A viewport that already shows the playhead is returned as is.
 */
export function followPlayhead(v:TimelineViewport,frame:number,durationFrames:number,mode:"page"|"center"="page"):TimelineViewport{
  assertViewport(v);
  const span=visibleFrames(v);
  if(mode==="center")return clampViewport({...v,startFrame:frame-span/2},durationFrames);
  if(frame>=v.startFrame&&frame<v.startFrame+span)return v;
  return clampViewport({...v,startFrame:frame>=v.startFrame+span?frame:frame-span*0.1},durationFrames);
}

/** Where the viewport window sits on a mini-map `widthPx` wide showing the whole timeline. */
export function minimapWindow(v:TimelineViewport,durationFrames:number,widthPx:number):{left:number;width:number}{
  assertViewport(v);
  const total=Math.max(1,durationFrames,v.startFrame+visibleFrames(v));
  const width=Math.max(12,Math.min(widthPx,visibleFrames(v)/total*widthPx));
  const left=Math.min(widthPx-width,Math.max(0,v.startFrame/total*widthPx));
  return {left,width};
}

/** The viewport after dragging the mini-map window so its left edge is at `leftPx`. */
export function minimapScroll(v:TimelineViewport,leftPx:number,durationFrames:number,widthPx:number):TimelineViewport{
  assertViewport(v);
  const total=Math.max(1,durationFrames,v.startFrame+visibleFrames(v));
  return clampViewport({...v,startFrame:leftPx/Math.max(1,widthPx)*total},durationFrames);
}
