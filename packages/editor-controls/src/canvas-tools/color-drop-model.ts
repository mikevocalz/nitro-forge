/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/ColorDropUi.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`dropSource`, `DropDot` and
 * `DropBandUi`: a touch that stays inside the touch slop is a tap and one that
 * leaves it is a drag; the dragged colour follows the finger as a 55.5 dp dot;
 * a release outside the canvas puts the colour back instead of filling; the
 * band reads the threshold as a whole percentage).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Kotlin/Compose to
 * TypeScript as pure functions; the view-model state moved to the host; the
 * hold-still threshold slide and "Continue filling" band were left out; the
 * release point is mapped to document pixels for the engine's `floodFill`; a
 * keyboard and screen-reader path (focus the chip, Enter, arrows, Enter) added.
 */

/** Movement, in layout units, after which a press on the chip is a drag. Android's touch slop is 8 dp. */
export const DROP_SLOP=8;
/** Diameter of the colour dot that follows the pointer. ProCraft draws 55.5 dp. */
export const DROP_DOT_SIZE=56;
/** Largest fill tolerance; the engine compares channel differences 0..255. */
export const MAX_FILL_TOLERANCE=255;
/** Keyboard crosshair step in layout units; Alt moves ten times as far. */
export const DROP_KEY_STEP=8;

/** A point or rectangle origin in window/page coordinates. */
export interface DropPoint {
  readonly x:number;
  readonly y:number;
}
/** A measured rectangle in the same coordinates as {@linkcode DropPoint}. */
export interface DropRect extends DropPoint {
  readonly width:number;
  readonly height:number;
}

/** One committed drop. Same fields as the engine's `floodFill` minus the layer id the host adds. */
export interface FillRequest {
  /** Document pixel, whole numbers. */
  readonly x:number;
  readonly y:number;
  /** The chip's colour as the host passed it. */
  readonly color:string;
  readonly tolerance:number;
  readonly contiguous:boolean;
}

/** What a press on the chip turned out to be. */
export type DropPress="tap"|"drag";
/** A press that has moved `dx`, `dy` from where it began. */
export function classifyPress(dx:number,dy:number,slop=DROP_SLOP):DropPress{
  return Math.hypot(dx,dy)>slop?"drag":"tap";
}

/** Whether `p` is inside `r` (edges included). */
export function isInside(p:DropPoint,r:DropRect):boolean{
  return p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.width&&p.y<=r.y+r.height;
}

/**
 * Document pixel under window point `p` over the target `r` showing a
 * `docWidth` x `docHeight` document, or `undefined` outside the target.
 */
export function dropToDocument(p:DropPoint,r:DropRect,docWidth:number,docHeight:number):DropPoint|undefined{
  if(![p.x,p.y,r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height,docWidth,docHeight].every(Number.isFinite)||docWidth<1||docHeight<1||!isInside(p,r)||r.width<=0||r.height<=0)return undefined;
  const x=Math.min(docWidth-1,Math.max(0,Math.floor(((p.x-r.x)/r.width)*docWidth)));
  const y=Math.min(docHeight-1,Math.max(0,Math.floor(((p.y-r.y)/r.height)*docHeight)));
  return {x,y};
}

/** Throws for settings the engine would reject. */
export function validateDrop(p:{color:string;tolerance:number;width:number;height:number;documentWidth:number;documentHeight:number}):void{
  if(p.color.trim()===""||p.color.length>4096)throw new RangeError("Drop colour must not be blank");
  if(!Number.isInteger(p.tolerance)||p.tolerance<0||p.tolerance>MAX_FILL_TOLERANCE)
    throw new RangeError(`Fill tolerance must be a whole number 0..${MAX_FILL_TOLERANCE}`);
  if(![p.width,p.height,p.documentWidth,p.documentHeight].every(n=>Number.isFinite(n)&&n>0)||p.documentWidth<1||p.documentHeight<1)
    throw new RangeError("Drop target and document sizes must be positive numbers");
}

/** The request for a drop on document pixel `at`. */
export function buildFill(at:DropPoint,color:string,tolerance:number,contiguous:boolean):FillRequest{
  return {x:Math.round(at.x),y:Math.round(at.y),color,tolerance,contiguous};
}

/** ProCraft's band text: "Threshold 13%" for tolerance 32. */
export function thresholdLabel(tolerance:number):string{
  return `Threshold ${Math.round(tolerance/MAX_FILL_TOLERANCE*100)}%`;
}

/** Keyboard crosshair move for a key, in layout units, or `undefined` for other keys. */
export function dropKeyMove(key:string|undefined,alt=false):DropPoint|undefined{
  const s=DROP_KEY_STEP*(alt?10:1);
  switch(key){
    case "ArrowLeft":return {x:-s,y:0};
    case "ArrowRight":return {x:s,y:0};
    case "ArrowUp":return {x:0,y:-s};
    case "ArrowDown":return {x:0,y:s};
    default:return undefined;
  }
}
/** Keeps a crosshair (target-local layout units) inside a `width` x `height` target. */
export function clampToTarget(p:DropPoint,width:number,height:number):DropPoint{
  return {x:Math.min(Math.max(p.x,0),width),y:Math.min(Math.max(p.y,0),height)};
}

/** Spoken target readout, e.g. "Fill at 120, 48 with Coral, Threshold 13%". */
export function describeDropTarget(at:DropPoint|undefined,colorLabel:string,tolerance:number):string{
  return at?`Fill at ${at.x}, ${at.y} with ${colorLabel}, ${thresholdLabel(tolerance)}`
    :`Release over the canvas to fill with ${colorLabel}`;
}
