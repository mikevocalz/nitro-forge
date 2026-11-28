/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/ReferenceUi.kt and
 * crates/core/src/reference_view.rs
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`ReferenceWindow`: a
 * floating window over the canvas whose title bar drags it, whose close button
 * removes it and whose bottom corner handle sizes it; `ReferenceSizes::scale` and
 * `reference_picture_rect`: the picture fitted whole into the window and centred).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Kotlin/Rust to
 * TypeScript as pure functions; one window became a list of host-owned
 * references; a crop (cover) fit, opacity, lock, pin and side/overlay placements
 * were added; the pinch zoom, eyedropper and canvas/face modes were left out.
 */

/** Where a reference shows: a movable window, a docked side column, or a tracing overlay on the canvas. */
export type ReferencePlacement="float"|"side"|"overlay";
/** `fit` shows the whole picture (letterboxed); `crop` fills the frame and trims the overflow. */
export type ReferenceFit="fit"|"crop";

/**
 * One reference image. Reference images are workspace state, not document
 * state: the host keeps them beside the document, and nothing here is undone
 * with the artwork.
 */
export interface ReferenceImage {
  /** Stable, unique id. */
  readonly id:string;
  /** Name shown in the title bar and read by screen readers. */
  readonly label:string;
  /** Pixel size of the picture, for fitting. */
  readonly imageWidth:number;
  readonly imageHeight:number;
  /** Floating window frame in board layout units (also the remembered spot for side and overlay). */
  readonly x:number;
  readonly y:number;
  readonly width:number;
  readonly height:number;
  readonly fit:ReferenceFit;
  /** 0.1..1. */
  readonly opacity:number;
  /** Locked references refuse every change, including removal, until unlocked. */
  readonly locked:boolean;
  /** Pinned windows stay where they are: no moving or resizing until unpinned. */
  readonly pinned:boolean;
  readonly placement:ReferencePlacement;
}
/** The fields a single commit changes. */
export type ReferencePatch=Partial<Pick<ReferenceImage,"x"|"y"|"width"|"height"|"fit"|"opacity"|"locked"|"pinned"|"placement">>;

/** Title bar height of a floating window, in layout units (a 44pt drag target). */
export const REFERENCE_BAR_HEIGHT=44;
/** Smallest floating window frame. */
export const REFERENCE_MIN_WIDTH=140;
export const REFERENCE_MIN_HEIGHT=100;
/** Opacity bounds and step. */
export const REFERENCE_MIN_OPACITY=0.1;
export const REFERENCE_OPACITY_STEP=0.1;
/** Keyboard move/resize step; Alt moves ten times as far. */
export const REFERENCE_KEY_STEP=8;

/** A rectangle in board layout units. */
export interface BoardRect {
  readonly x:number;
  readonly y:number;
  readonly width:number;
  readonly height:number;
}

/**
 * Where the picture is drawn inside a `frameW` x `frameH` frame: scaled to fit
 * whole (`fit`) or to cover the frame (`crop`), centred either way.
 */
export function pictureRect(fit:ReferenceFit,frameW:number,frameH:number,imageW:number,imageH:number):BoardRect{
  const sx=frameW/imageW,sy=frameH/imageH;
  const s=fit==="fit"?Math.min(sx,sy):Math.max(sx,sy);
  if(!Number.isFinite(s)||s<=0)return {x:0,y:0,width:0,height:0};
  const width=imageW*s,height=imageH*s;
  return {x:(frameW-width)/2,y:(frameH-height)/2,width,height};
}

const clamp=(v:number,lo:number,hi:number)=>Math.min(Math.max(v,lo),Math.max(lo,hi));
/** Keeps a window frame fully on a `boardW` x `boardH` board, shrinking it first if it is larger. */
export function clampFrame(r:BoardRect,boardW:number,boardH:number):BoardRect{
  const width=clamp(r.width,Math.min(REFERENCE_MIN_WIDTH,boardW),boardW);
  const height=clamp(r.height,Math.min(REFERENCE_MIN_HEIGHT,boardH),boardH);
  return {x:clamp(r.x,0,boardW-width),y:clamp(r.y,0,boardH-height),width,height};
}
/** A frame moved by `dx`, `dy` and kept on the board. */
export function moveFrame(r:BoardRect,dx:number,dy:number,boardW:number,boardH:number):BoardRect{
  return clampFrame({...r,x:r.x+dx,y:r.y+dy},boardW,boardH);
}
/** A frame resized from its bottom-right corner, at least the minimum size and on the board. */
export function resizeFrame(r:BoardRect,dw:number,dh:number,boardW:number,boardH:number):BoardRect{
  const width=clamp(r.width+dw,Math.min(REFERENCE_MIN_WIDTH,boardW),boardW-r.x);
  const height=clamp(r.height+dh,Math.min(REFERENCE_MIN_HEIGHT,boardH),boardH-r.y);
  return {...r,width,height};
}
/** Opacity stepped by one {@linkcode REFERENCE_OPACITY_STEP} and clamped. */
export function stepReferenceOpacity(opacity:number,direction:-1|1):number{
  return Math.round(clamp(opacity+direction*REFERENCE_OPACITY_STEP,REFERENCE_MIN_OPACITY,1)*100)/100;
}
/** "60%" for 0.6. */
export function formatReferenceOpacity(opacity:number):string{
  return Math.round(opacity*100)+"%";
}

/** The kinds of change {@linkcode referenceEditProblem} checks. */
export type ReferenceEdit="move"|"resize"|"opacity"|"fit"|"placement"|"remove"|"pin";
/** Why `edit` is refused for `ref`, or `undefined` when it is allowed. Unlocking is always allowed. */
export function referenceEditProblem(ref:ReferenceImage,edit:ReferenceEdit):string|undefined{
  if(ref.locked)return `${ref.label} is locked. Unlock it to change it.`;
  if((edit==="move"||edit==="resize")&&ref.placement!=="float")return `${ref.label} is not floating. Switch it to Float to move it.`;
  if((edit==="move"||edit==="resize")&&ref.pinned)return `${ref.label} is pinned. Unpin it to move it.`;
  return undefined;
}

/** Throws for a reference list the board cannot draw honestly. */
export function validateReferences(refs:readonly ReferenceImage[],selectedId?:string):void{
  if(refs.length>256)throw new RangeError("Reference board supports at most 256 images");
  const ids=new Set<string>();
  for(const r of refs){
    if(!r.id.trim()||r.id.length>512||r.label.length>1024)throw new RangeError("Invalid reference identity");
    if(ids.has(r.id))throw new RangeError(`Duplicate reference id "${r.id}"`);
    ids.add(r.id);
    if(r.label.trim()==="")throw new RangeError(`Reference "${r.id}" needs a label`);
    if(![r.imageWidth,r.imageHeight,r.width,r.height].every(n=>Number.isFinite(n)&&n>0))
      throw new RangeError(`Reference "${r.id}" needs positive sizes`);
    if(![r.x,r.y,r.x+r.width,r.y+r.height].every(Number.isFinite))throw new RangeError(`Reference "${r.id}" needs a numeric position`);
    if(!(r.opacity>=REFERENCE_MIN_OPACITY&&r.opacity<=1))throw new RangeError(`Reference "${r.id}" opacity must be 0.1..1`);
    if(!["float","side","overlay"].includes(r.placement))throw new RangeError(`Unknown placement "${r.placement}"`);
    if(r.fit!=="fit"&&r.fit!=="crop")throw new RangeError(`Unknown fit "${r.fit}"`);
  }
  if(selectedId!==undefined&&!ids.has(selectedId))throw new RangeError(`Selected reference "${selectedId}" is not on the board`);
}

/** Keyboard command on a focused reference window. */
export type ReferenceKeyCommand=
  |{readonly type:"move";readonly dx:number;readonly dy:number}
  |{readonly type:"resize";readonly dw:number;readonly dh:number}
  |{readonly type:"remove"}|{readonly type:"cancel"};
/**
 * Arrows move a floating window by {@linkcode REFERENCE_KEY_STEP} (Alt: ten
 * times), Shift+arrows resize it, Delete or Backspace removes it, Escape cancels
 * a drag. Board geometry stays left-to-right in RTL layouts.
 */
export function resolveReferenceKey(e:{key?:string;shiftKey?:boolean;altKey?:boolean}):ReferenceKeyCommand|undefined{
  if(e.key==="Delete"||e.key==="Backspace")return {type:"remove"};
  if(e.key==="Escape")return {type:"cancel"};
  const s=REFERENCE_KEY_STEP*(e.altKey?10:1);
  const d=e.key==="ArrowLeft"?[-s,0]:e.key==="ArrowRight"?[s,0]:e.key==="ArrowUp"?[0,-s]:e.key==="ArrowDown"?[0,s]:undefined;
  if(!d)return undefined;
  return e.shiftKey?{type:"resize",dw:d[0]!,dh:d[1]!}:{type:"move",dx:d[0]!,dy:d[1]!};
}

const PLACEMENT_LABEL={float:"floating",side:"in the side column",overlay:"overlaid on the canvas"} as const;
/** Spoken description, e.g. "Skyline reference, floating, fit, 60% opacity, pinned". */
export function referenceA11yLabel(r:ReferenceImage):string{
  const flags=[r.pinned&&"pinned",r.locked&&"locked"].filter(Boolean).join(", ");
  return `${r.label} reference, ${PLACEMENT_LABEL[r.placement]}, ${r.fit==="fit"?"whole picture":"cropped to fill"}, ${formatReferenceOpacity(r.opacity)} opacity${flags?", "+flags:""}`;
}
/** Placement choices in segmented-control order. */
export const REFERENCE_PLACEMENTS=[
  {value:"float",label:"Float"},{value:"side",label:"Side"},{value:"overlay",label:"Overlay"},
] as const satisfies readonly {value:ReferencePlacement;label:string}[];
/** Fit choices in segmented-control order. */
export const REFERENCE_FITS=[
  {value:"fit",label:"Fit"},{value:"crop",label:"Crop"},
] as const satisfies readonly {value:ReferenceFit;label:string}[];
