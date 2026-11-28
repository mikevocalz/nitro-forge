/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * crates/engine/src/transform.rs
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`snap_offset` and
 * `lines_under`: a moved box snaps by the nearest of its left, middle and right
 * (top, middle, bottom) onto the nearest line within reach, each axis on its
 * own, and the lines a box sits on are reported back for drawing).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Rust to TypeScript;
 * the line set widened from the canvas and other layers to a configurable
 * grid, ruler guides and artboard edges and centres; reach given in screen
 * units and a magnetism strength added; point snapping and grid line layout
 * written new for SnapGridOverlay.
 */
import {docToScreen,tidy,validateDocRect,validateViewport,visibleDocRect,type CanvasAxis,type CanvasViewport,type DocPoint,type DocRect} from "./canvas-viewport.ts";
import {validateGuides,type CanvasGuide} from "./ruler-model.ts";

/** A square grid laid over the document. */
export interface GridSettings {
  /** Distance between major lines, in document pixels. */
  readonly spacing:number;
  /** Parts each major cell is split into; 1 draws major lines only. Whole number 1..16. */
  readonly subdivisions:number;
  readonly visible:boolean;
  /** Document point a major line passes through on both axes. @default {x:0,y:0} */
  readonly origin?:DocPoint;
}
/** What drags are pulled onto, and how hard. */
export interface SnapSettings {
  /** Master switch. Off, nothing snaps and no feedback is drawn. */
  readonly enabled:boolean;
  readonly toGrid:boolean;
  readonly toGuides:boolean;
  readonly toArtboards:boolean;
  /** How close, in screen units, a line must be to pull. Kept in screen units so reach feels the same at every zoom. */
  readonly thresholdPx:number;
  /**
   * 0..1. At 1 anything within reach lands exactly on the line. Lower values
   * pull only part of the way, more the closer it gets, so the pull fades out
   * at the edge of reach instead of jumping.
   */
  readonly strength:number;
}
/** An artboard as the engine's `describe.artboards` lists it. */
export interface ArtboardBounds extends DocRect {
  readonly id:string;
  readonly name?:string;
}
/** Grid spacing bounds, document pixels. */
export const GRID_MIN_SPACING=1;
export const GRID_MAX_SPACING=4096;
export const GRID_MAX_SUBDIVISIONS=16;
/** Snap reach bounds, screen units. */
export const SNAP_MIN_THRESHOLD=1;
export const SNAP_MAX_THRESHOLD=64;
/** Grid lines closer than this on screen are not drawn, and are not snapped to. */
export const GRID_MIN_SCREEN_SPACING=6;
/** Upper bound on drawn grid lines per axis. */
export const GRID_MAX_LINES=400;
/** A sensible starting grid and snap configuration. */
export const DEFAULT_GRID={spacing:32,subdivisions:4,visible:true} as const satisfies GridSettings;
export const DEFAULT_SNAP={enabled:true,toGrid:true,toGuides:true,toArtboards:true,thresholdPx:8,strength:1} as const satisfies SnapSettings;

/** Throws a `RangeError` naming the bad grid field. */
export function validateGrid(grid:GridSettings):void{
  if(typeof grid.visible!=="boolean")throw new RangeError("Grid visibility must be boolean");
  if(!Number.isFinite(grid.spacing)||grid.spacing<GRID_MIN_SPACING||grid.spacing>GRID_MAX_SPACING)
    throw new RangeError(`Grid spacing must be ${GRID_MIN_SPACING}..${GRID_MAX_SPACING} document pixels, got ${grid.spacing}`);
  if(!Number.isInteger(grid.subdivisions)||grid.subdivisions<1||grid.subdivisions>GRID_MAX_SUBDIVISIONS)
    throw new RangeError(`Grid subdivisions must be a whole number 1..${GRID_MAX_SUBDIVISIONS}, got ${grid.subdivisions}`);
  if(grid.origin&&![grid.origin.x,grid.origin.y].every(Number.isFinite))throw new RangeError("Grid origin must be finite");
}
/** Throws a `RangeError` naming the bad snap field. */
export function validateSnap(snap:SnapSettings):void{
  if([snap.enabled,snap.toGrid,snap.toGuides,snap.toArtboards].some(v=>typeof v!=="boolean"))throw new RangeError("Snap targets must be boolean");
  if(!Number.isFinite(snap.thresholdPx)||snap.thresholdPx<SNAP_MIN_THRESHOLD||snap.thresholdPx>SNAP_MAX_THRESHOLD)
    throw new RangeError(`Snap threshold must be ${SNAP_MIN_THRESHOLD}..${SNAP_MAX_THRESHOLD} screen units, got ${snap.thresholdPx}`);
  if(!Number.isFinite(snap.strength)||snap.strength<0||snap.strength>1)
    throw new RangeError(`Snap strength must be 0..1, got ${snap.strength}`);
}

/**
 * The grid step that is drawn and snapped to at `zoom`: the subdivision when
 * it is at least {@linkcode GRID_MIN_SCREEN_SPACING} apart on screen, else the
 * major spacing, or `undefined` when even major lines would be a smear.
 */
export function gridStep(grid:GridSettings,zoom:number):number|undefined{
  const minor=grid.spacing/grid.subdivisions;
  if(minor*zoom>=GRID_MIN_SCREEN_SPACING)return minor;
  if(grid.spacing*zoom>=GRID_MIN_SCREEN_SPACING)return grid.spacing;
  return undefined;
}

/** Where a snap line came from, for drawing and announcing it. */
export type SnapSource=
  |{readonly kind:"grid"}
  |{readonly kind:"guide";readonly id:string}
  |{readonly kind:"artboard";readonly id:string;readonly edge:"start"|"center"|"end"};
/** A line a value can snap to on one axis: x = value (vertical line) or y = value (horizontal line). */
export interface SnapLine {
  readonly axis:CanvasAxis;
  readonly value:number;
  readonly source:SnapSource;
}
/** Everything a drag can snap to. Grid lines are found near each value rather than listed. */
export interface SnapContext {
  readonly zoom:number;
  readonly snap:SnapSettings;
  readonly grid?:GridSettings;
  readonly guides?:readonly CanvasGuide[];
  readonly artboards?:readonly ArtboardBounds[];
}
/** The fixed (non-grid) lines on one axis: guides and artboard edges and centres. */
export function snapLines(ctx:SnapContext,axis:CanvasAxis):SnapLine[]{
  const lines:SnapLine[]=[];
  if(ctx.snap.toGuides)for(const g of ctx.guides??[]){
    if((axis==="y")===(g.orientation==="horizontal"))lines.push({axis,value:g.position,source:{kind:"guide",id:g.id}});
  }
  if(ctx.snap.toArtboards)for(const a of ctx.artboards??[]){
    validateDocRect(a,`Artboard ${a.id}`);
    const start=axis==="x"?a.x:a.y,size=axis==="x"?a.w:a.h;
    lines.push({axis,value:start,source:{kind:"artboard",id:a.id,edge:"start"}},
      {axis,value:start+size/2,source:{kind:"artboard",id:a.id,edge:"center"}},
      {axis,value:start+size,source:{kind:"artboard",id:a.id,edge:"end"}});
  }
  return lines;
}
/** Grid lines on either side of `value`, when grid snapping is on and the grid is drawn at this zoom. */
function gridLinesNear(ctx:SnapContext,axis:CanvasAxis,value:number):SnapLine[]{
  const grid=ctx.grid;
  if(!grid||!ctx.snap.toGrid)return [];
  const step=gridStep(grid,ctx.zoom);
  if(step===undefined)return [];
  const o=axis==="x"?grid.origin?.x??0:grid.origin?.y??0;
  const k=Math.floor((value-o)/step);
  return [k,k+1].map(i=>({axis,value:tidy(o+i*step),source:{kind:"grid" as const}}));
}
/** Reach in document pixels: the screen threshold divided by zoom. */
export const snapReach=(ctx:SnapContext)=>ctx.snap.thresholdPx/ctx.zoom;
/**
 * The pull applied to a feature `d` away from a line within `reach`: all of
 * `d` at strength 1, fading to nothing at the edge of reach as strength drops.
 */
export function magneticPull(d:number,reach:number,strength:number):number{
  if(reach<=0||Math.abs(d)>reach)return 0;
  const near=1-Math.abs(d)/reach;
  return d*Math.min(1,strength+(1-strength)*near);
}
/** A line a feature landed on. */
export interface SnapHit {
  readonly line:SnapLine;
  /** Which part of the moved thing touched it. A point only has `center`. */
  readonly feature:"start"|"center"|"end";
}
interface AxisSnap {readonly offset:number;readonly hit?:SnapHit}
const FEATURES=["start","center","end"] as const;
/** Closest pairing of `features` (by offset) to the candidate lines, within reach. */
function snapAxis(ctx:SnapContext,axis:CanvasAxis,features:readonly {feature:SnapHit["feature"];value:number}[]):AxisSnap{
  if(!ctx.snap.enabled)return {offset:0};
  const reach=snapReach(ctx);
  const fixed=snapLines(ctx,axis);
  let best:{d:number;hit:SnapHit}|undefined;
  for(const f of features){
    for(const line of [...fixed,...gridLinesNear(ctx,axis,f.value)]){
      const d=line.value-f.value;
      if(Math.abs(d)<=reach&&(!best||Math.abs(d)<Math.abs(best.d)))best={d,hit:{line,feature:f.feature}};
    }
  }
  if(!best)return {offset:0};
  const offset=magneticPull(best.d,reach,ctx.snap.strength);
  // A feature counts as snapped only once it sits on the line (within half a document pixel).
  return Math.abs(best.d-offset)<0.5?{offset,hit:best.hit}:{offset};
}
const checkContext=(ctx:SnapContext)=>{
  if(!Number.isFinite(ctx.zoom)||ctx.zoom<=0)throw new RangeError(`Canvas zoom must be a positive number, got ${ctx.zoom}`);
  validateSnap(ctx.snap);
  if(ctx.grid)validateGrid(ctx.grid);
  if(ctx.guides)validateGuides(ctx.guides);
  if((ctx.artboards?.length??0)>10000)throw new RangeError('At most 10000 snap artboards are supported');
  const ids=new Set<string>();for(const board of ctx.artboards??[]){if(!board.id.trim()||board.id.length>512||ids.has(board.id))throw new RangeError('Snap artboards need unique bounded IDs');ids.add(board.id);validateDocRect(board);}

};
/** Result of {@linkcode snapPoint}. */
export interface PointSnap {
  readonly point:DocPoint;
  readonly x?:SnapHit;
  readonly y?:SnapHit;
}
/**
 * Pulls a point onto the nearest grid line, guide or artboard edge on each
 * axis. Snapping both axes at once lands it on intersections: grid crossings,
 * artboard corners, or where a guide meets an edge.
 */
export function snapPoint(point:DocPoint,ctx:SnapContext):PointSnap{
  checkContext(ctx);
  if(![point.x,point.y].every(Number.isFinite))throw new RangeError("Snap point must be finite");
  const x=snapAxis(ctx,"x",[{feature:"center",value:point.x}]);
  const y=snapAxis(ctx,"y",[{feature:"center",value:point.y}]);
  return {point:{x:tidy(point.x+x.offset),y:tidy(point.y+y.offset)},...(x.hit?{x:x.hit}:{}),...(y.hit?{y:y.hit}:{})};
}
/** Result of {@linkcode snapRect}. */
export interface RectSnap {
  readonly rect:DocRect;
  readonly dx:number;
  readonly dy:number;
  readonly x?:SnapHit;
  readonly y?:SnapHit;
}
/**
 * Moves a rectangle (never resizes it) so that whichever of its left, centre
 * or right edge (top, middle, bottom) is nearest a line lands on it.
 */
export function snapRect(rect:DocRect,ctx:SnapContext):RectSnap{
  checkContext(ctx);
  validateDocRect(rect,"Snapped rectangle");
  const along=(start:number,size:number)=>FEATURES.map((feature,i)=>({feature,value:start+size*i/2}));
  const x=snapAxis(ctx,"x",along(rect.x,rect.w));
  const y=snapAxis(ctx,"y",along(rect.y,rect.h));
  const dx=tidy(x.offset),dy=tidy(y.offset);
  return {rect:{...rect,x:tidy(rect.x+dx),y:tidy(rect.y+dy)},dx,dy,...(x.hit?{x:x.hit}:{}),...(y.hit?{y:y.hit}:{})};
}

/** One drawn grid line, at a screen offset from the overlay's left (vertical) or top (horizontal) edge. */
export interface GridLine {
  readonly offset:number;
  readonly major:boolean;
}
/** The grid lines an overlay draws at this viewport, bounded by {@linkcode GRID_MAX_LINES} per axis. */
export function gridLines(grid:GridSettings,viewport:CanvasViewport):{vertical:GridLine[];horizontal:GridLine[]}{
  validateGrid(grid);validateViewport(viewport);
  const step=gridStep(grid,viewport.zoom);
  if(!grid.visible||step===undefined)return {vertical:[],horizontal:[]};
  const r=visibleDocRect(viewport);
  const axis=(a:CanvasAxis,start:number,size:number,o:number):GridLine[]=>{
    const first=Math.ceil((start-o)/step),last=Math.floor((start+size-o)/step);
    const out:GridLine[]=[];
    for(let k=first;k<=last&&out.length<GRID_MAX_LINES;k++){
      const value=o+k*step;
      const ratio=(value-o)/grid.spacing;
      out.push({offset:docToScreen(viewport,a,value),major:Math.abs(ratio-Math.round(ratio))<1e-6});
    }
    return out;
  };
  return {vertical:axis("x",r.x,r.w,grid.origin?.x??0),horizontal:axis("y",r.y,r.h,grid.origin?.y??0)};
}
/** Spoken summary of a snap, e.g. "Snapped to guide and grid", or `undefined` when nothing snapped. */
export function snapSummary(snap:{readonly x?:SnapHit;readonly y?:SnapHit}):string|undefined{
  const name=(h:SnapHit)=>h.line.source.kind==="artboard"?"artboard "+(h.line.source.edge==="center"?"center":"edge"):h.line.source.kind;
  const parts=[snap.x,snap.y].filter((h):h is SnapHit=>h!==undefined).map(name);
  if(!parts.length)return undefined;
  return "Snapped to "+[...new Set(parts)].join(" and ");
}

/** Reject invalid externally supplied snap feedback before projecting it into native views. */
export function validateSnapHit(hit:SnapHit,axis:CanvasAxis):void{
 const line=hit.line,source=line.source;
 if(line.axis!==axis||!Number.isFinite(line.value)||!FEATURES.includes(hit.feature)||!['grid','guide','artboard'].includes(source.kind))throw new RangeError('Invalid snap feedback');
 if(source.kind!=='grid'&&(!source.id.trim()||source.id.length>512))throw new RangeError('Invalid snap source identity');
 if(source.kind==='artboard'&&!FEATURES.includes(source.edge))throw new RangeError('Invalid snap artboard feature');
}
