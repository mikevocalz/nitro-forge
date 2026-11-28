/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * crates/engine/src/guide.rs
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`LengthUnit`: lengths kept in
 * canvas pixels and shown in a unit, `per_inch` for millimetres, centimetres
 * and inches, and the `to_pixels`/`from_pixels` conversion at a given dpi).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Rust to TypeScript,
 * points (72 to the inch) added, and the ruler tick spacing, labels, guide
 * placement and keyboard steps written new for CanvasRuler.
 */
import {docToScreen,screenToDoc,tidy,visibleDocRect,type CanvasViewport,type DocPoint} from "./canvas-viewport.ts";

/** Units a {@linkcode CanvasRuler} can count in. Lengths stay in document pixels underneath. */
export type RulerUnit="px"|"in"|"cm"|"mm"|"pt";
/** Every {@linkcode RulerUnit} with its spoken name, in menu order. */
export const RULER_UNITS=[
  {unit:"px",label:"Pixels"},{unit:"in",label:"Inches"},{unit:"cm",label:"Centimeters"},
  {unit:"mm",label:"Millimeters"},{unit:"pt",label:"Points"},
] as const satisfies readonly {unit:RulerUnit;label:string}[];
/** Document resolution used when the host gives none. At 72 dpi a point is a pixel. */
export const DEFAULT_DPI=72;
/** Least screen distance between two labeled ticks. */
export const RULER_MIN_LABEL_SPACING=56;
/** Least screen distance between two unlabeled ticks; closer subdivisions are dropped. */
export const RULER_MIN_TICK_SPACING=5;
/** Upper bound on ticks per ruler, so a huge overlay cannot allocate without limit. */
export const RULER_MAX_TICKS=1200;
/** Arrow-key guide step in document pixels; with Shift it is {@linkcode RULER_GUIDE_PAGE_STEP}. */
export const RULER_GUIDE_STEP=1;
export const RULER_GUIDE_PAGE_STEP=10;
/** Visible ruler thickness. The touch band is {@linkcode RULER_TOUCH_BAND}, reaching into the canvas. */
export const RULER_THICKNESS=24;
export const RULER_TOUCH_BAND=44;

/** How many of `unit` make an inch; `undefined` for pixels, which do not depend on dpi. */
export function unitsPerInch(unit:RulerUnit):number|undefined{
  switch(unit){
    case "px":return undefined;
    case "in":return 1;
    case "cm":return 2.54;
    case "mm":return 25.4;
    case "pt":return 72;
  }
}
const checkDpi=(dpi:number)=>{if(!Number.isFinite(dpi)||dpi<=0)throw new RangeError(`Document dpi must be positive, got ${dpi}`);};
const checkUnit=(unit:string)=>{if(!RULER_UNITS.some(u=>u.unit===unit))throw new RangeError(`Unknown ruler unit ${unit}`);};
/** `value` of `unit` in document pixels at `dpi`. */
export function toPixels(value:number,unit:RulerUnit,dpi=DEFAULT_DPI):number{
  checkUnit(unit);checkDpi(dpi);
  const k=unitsPerInch(unit);
  return k===undefined?value:value/k*dpi;
}
/** `px` document pixels in `unit` at `dpi`. */
export function fromPixels(px:number,unit:RulerUnit,dpi=DEFAULT_DPI):number{
  checkUnit(unit);checkDpi(dpi);
  const k=unitsPerInch(unit);
  return k===undefined?px:px/dpi*k;
}
/** A number as a ruler label: up to three decimals, no trailing zeros, no "-0". */
export function formatRulerNumber(value:number):string{
  const r=tidy(value,3);
  return String(r);
}
/** A document length in `unit`, e.g. "12.7 mm" or "36 px". */
export function formatLength(px:number,unit:RulerUnit,dpi=DEFAULT_DPI):string{
  return `${formatRulerNumber(fromPixels(px,unit,dpi))} ${unit}`;
}

/** The labeled interval and how many parts it is split into. */
export interface RulerSpacing {
  /** Distance between labeled ticks, in ruler units. */
  readonly majorUnits:number;
  /** Ticks per labeled interval (1 means no subdivision). */
  readonly divisions:number;
}
const DECIMAL_DIVISIONS:Record<number,readonly number[]>={1:[10,5,2],2:[4,2],5:[5]};
/**
 * Picks the smallest 1-2-5 step (halves down to sixteenths for inches) whose
 * labels sit at least `minLabelPx` apart on screen, then the finest
 * subdivision whose ticks sit at least {@linkcode RULER_MIN_TICK_SPACING} apart.
 */
export function rulerSpacing(zoom:number,unit:RulerUnit,dpi=DEFAULT_DPI,minLabelPx=RULER_MIN_LABEL_SPACING):RulerSpacing{
  if(!Number.isFinite(zoom)||zoom<=0)throw new RangeError(`Canvas zoom must be a positive number, got ${zoom}`);
  const screenPerUnit=toPixels(1,unit,dpi)*zoom;
  const fits=(units:number)=>units*screenPerUnit>=minLabelPx;
  let major:number|undefined;
  if(unit==="in")for(const f of [1/16,1/8,1/4,1/2])if(fits(f)){major=f;break;}
  let mantissa=1;
  if(major===undefined){
    let exp=Math.floor(Math.log10(minLabelPx/screenPerUnit));
    if(unit==="in"&&exp<0)exp=0;
    for(;;exp++){
      const found=[1,2,5].find(m=>fits(m*10**exp));
      if(found!==undefined){mantissa=found;major=found*10**exp;break;}
    }
  }
  const majorScreen=major*screenPerUnit;
  const choices=unit==="in"&&major<=1?[8,4,2]:DECIMAL_DIVISIONS[mantissa]??[2];
  const divisions=choices.find(d=>majorScreen/d>=RULER_MIN_TICK_SPACING)??1;
  return {majorUnits:tidy(major,9),divisions};
}

/** One tick on a ruler. */
export interface RulerTick {
  /** Screen distance from the overlay's top (vertical ruler) or left (horizontal ruler) edge. */
  readonly offset:number;
  /** `major` ticks carry a label; `half` marks the middle of an even subdivision. */
  readonly level:"major"|"half"|"minor";
  readonly label?:string;
}
/** Input for {@linkcode rulerTicks}. */
export interface RulerTickInput {
  readonly viewport:CanvasViewport;
  /** `horizontal` is the top ruler (counts x); `vertical` is the side ruler (counts y). */
  readonly orientation:"horizontal"|"vertical";
  readonly unit:RulerUnit;
  /** @default 72 */
  readonly dpi?:number;
  /** Document point where both rulers read zero. @default {x:0,y:0} */
  readonly origin?:DocPoint;
  /** @default {@linkcode RULER_MIN_LABEL_SPACING} */
  readonly minLabelPx?:number;
}
/**
 * The ticks one ruler draws across the overlay, from offset 0 to the
 * overlay's width (or height), with labels counted from `origin` in `unit`.
 * The count is bounded by {@linkcode RULER_MAX_TICKS}.
 */
export function rulerTicks({viewport,orientation,unit,dpi=DEFAULT_DPI,origin={x:0,y:0},minLabelPx}:RulerTickInput):RulerTick[]{
  const axis=orientation==="horizontal"?"x":"y";
  const length=orientation==="horizontal"?viewport.width:viewport.height;
  if(length<=0)return [];
  const {majorUnits,divisions}=rulerSpacing(viewport.zoom,unit,dpi,minLabelPx);
  const zero=axis==="x"?origin.x:origin.y;
  const unitAt=(screen:number)=>fromPixels(screenToDoc(viewport,axis,screen)-zero,unit,dpi);
  const screenAt=(units:number)=>docToScreen(viewport,axis,zero+toPixels(units,unit,dpi));
  const first=Math.floor(unitAt(0)/majorUnits);
  const last=Math.ceil(unitAt(length)/majorUnits);
  const ticks:RulerTick[]=[];
  for(let k=first;k<=last&&ticks.length<RULER_MAX_TICKS;k++){
    for(let i=0;i<divisions;i++){
      const units=(k+i/divisions)*majorUnits;
      const offset=screenAt(units);
      if(offset<0||offset>length)continue;
      if(i===0)ticks.push({offset,level:"major",label:formatRulerNumber(units)});
      else ticks.push({offset,level:divisions%2===0&&i===divisions/2?"half":"minor"});
    }
  }
  return ticks;
}

/**
 * A guide line. A `horizontal` guide is a line across the canvas at document
 * y = `position`, dragged out of the top ruler; a `vertical` guide sits at
 * document x = `position` and comes from the side ruler.
 */
export interface CanvasGuide {
  readonly id:string;
  readonly orientation:"horizontal"|"vertical";
  /** Document pixels. */
  readonly position:number;
}
/** A guide that does not exist yet: the payload of `onAddGuide`. */
export type NewCanvasGuide=Omit<CanvasGuide,"id">;
/** Throws a `RangeError` for a duplicate id, an unknown orientation or a non-finite position. */
export function validateGuides(guides:readonly CanvasGuide[]):void{
  if(guides.length>10000)throw new RangeError("At most 10000 guides are supported");
  const ids=new Set<string>();
  for(const g of guides){
    if(!g.id.trim()||g.id.length>512)throw new RangeError("Every guide needs an id");
    if(ids.has(g.id))throw new RangeError(`Duplicate guide id ${g.id}`);
    ids.add(g.id);
    if(g.orientation!=="horizontal"&&g.orientation!=="vertical")throw new RangeError(`Guide ${g.id} has an unknown orientation`);
    if(!Number.isFinite(g.position))throw new RangeError(`Guide ${g.id} needs a finite position`);
  }
}
/** The document axis a guide's position is measured on. */
export const guideAxis=(orientation:CanvasGuide["orientation"])=>orientation==="horizontal"?"y" as const:"x" as const;
/** Guides land on whole document pixels so the edges they mark stay crisp. */
export function guidePositionAt(viewport:CanvasViewport,orientation:CanvasGuide["orientation"],point:DocPoint):number{
  const axis=guideAxis(orientation);
  return tidy(Math.round(screenToDoc(viewport,axis,axis==="x"?point.x:point.y)));
}
/**
 * Whether a guide dragged to `point` (overlay coordinates) is back over the
 * ruler it belongs to, which removes it on release.
 */
export function isOverOwnRuler(orientation:CanvasGuide["orientation"],point:DocPoint,thickness=RULER_THICKNESS):boolean{
  return orientation==="horizontal"?point.y<thickness:point.x<thickness;
}
/** Where a guide added from the keyboard goes: the middle of what is visible, on a whole pixel. */
export function centerGuidePosition(viewport:CanvasViewport,orientation:CanvasGuide["orientation"]):number{
  const r=visibleDocRect(viewport);
  return tidy(Math.round(orientation==="horizontal"?r.y+r.h/2:r.x+r.w/2));
}
/** What a key press on a focused guide asks for. */
export type GuideKeyCommand={readonly kind:"move";readonly delta:number}|{readonly kind:"remove"};
/**
 * Keyboard for a focused guide. Horizontal guides take Up/Down, vertical guides
 * Left/Right, one document pixel per press or ten with Shift. Right always
 * means +x: canvas geometry is not mirrored in RTL. Delete or Backspace removes.
 */
export function guideKeyCommand(orientation:CanvasGuide["orientation"],key:string|undefined,shift=false):GuideKeyCommand|undefined{
  const step=shift?RULER_GUIDE_PAGE_STEP:RULER_GUIDE_STEP;
  if(key==="Delete"||key==="Backspace")return {kind:"remove"};
  if(orientation==="horizontal"){
    if(key==="ArrowUp")return {kind:"move",delta:-step};
    if(key==="ArrowDown")return {kind:"move",delta:step};
  }else{
    if(key==="ArrowLeft")return {kind:"move",delta:-step};
    if(key==="ArrowRight")return {kind:"move",delta:step};
  }
  return undefined;
}
/** Spoken name of a guide, e.g. "Horizontal guide at 12.7 mm". */
export function guideAccessibilityLabel(guide:CanvasGuide,unit:RulerUnit,dpi=DEFAULT_DPI,origin:DocPoint={x:0,y:0}):string{
  const zero=guide.orientation==="horizontal"?origin.y:origin.x;
  return `${guide.orientation==="horizontal"?"Horizontal":"Vertical"} guide at ${formatLength(guide.position-zero,unit,dpi)}`;
}
