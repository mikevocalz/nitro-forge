/**
 * Engine-neutral before/after comparison for `CanvasCompareView` (B-27). The
 * host supplies two images, typically a snapshot `flatten` and the current one
 * (or a reference picture), as decoded pixels or a URI. Split position and
 * overlay opacity are host state; this file holds the geometry and key maps.
 */
import {fitContain,rasterToImage,validateRaster,type RasterPixels} from "./layer-thumbnail-model.ts";

/** How the two images are shown. */
export type CompareMode="side-by-side"|"split"|"overlay"|"reference";

/** Every {@linkcode CompareMode} with its switcher label, in switcher order. */
export const COMPARE_MODES=[
  {value:"side-by-side",label:"Side by side"},
  {value:"split",label:"Split"},
  {value:"overlay",label:"Overlay"},
  {value:"reference",label:"Reference"},
] as const satisfies readonly {value:CompareMode;label:string}[];

/** One image to compare: decoded RGBA pixels, or anything an `Image` can load with its pixel size. */
export type CompareSource=
  |{readonly kind:"pixels";readonly raster:RasterPixels}
  |{readonly kind:"uri";readonly uri:string;readonly width:number;readonly height:number};

/** A source resolved to something an `Image` draws. */
export interface CompareImage {readonly uri:string;readonly width:number;readonly height:number}

/** Split step for an arrow key, and with Shift held. */
export const SPLIT_STEP=0.01;
export const SPLIT_STEP_LARGE=0.1;
/** The reference picture-in-picture takes this share of the frame's width. */
export const REFERENCE_SCALE=0.32;
/** Below this width the side-by-side panes stack vertically. */
export const SIDE_BY_SIDE_MIN_WIDTH=560;

/** Resolves a source for drawing. @throws RangeError on an invalid raster, empty URI or non-positive size. */
export function resolveCompareSource(source:CompareSource):CompareImage{
  if(source.kind==="pixels"){
    validateRaster(source.raster);
    const image=rasterToImage(source.raster);
    return {uri:image.uri,width:image.width,height:image.height};
  }
  if(source.kind!=="uri"||!source.uri.trim()||source.uri.length>8*1024*1024)throw new RangeError("Compare image URI is empty");
  if(![source.width,source.height].every(Number.isFinite)||!(source.width>0)||!(source.height>0))throw new RangeError("Compare image size must be positive");
  return {uri:source.uri,width:source.width,height:source.height};
}

/** Clamp to 0..1 and round to 0.1% so previews and commits agree. */
export function normalizeFraction(value:number):number{
  if(!Number.isFinite(value))throw new RangeError("Fraction must be finite");
  return Math.round(Math.min(1,Math.max(0,value))*1000)/1000;
}

/**
 * Split after a key press. Canvas geometry stays left-to-right in RTL layouts
 * (the before image is always on the left), so ArrowLeft always moves the
 * divider left. Returns `null` for keys it does not handle.
 */
export function splitFromKey(value:number,key:string|undefined,shift=false):number|null{
  const step=shift?SPLIT_STEP_LARGE:SPLIT_STEP;
  switch(key){
    case "ArrowLeft":case "ArrowDown":return normalizeFraction(value-step);
    case "ArrowRight":case "ArrowUp":return normalizeFraction(value+step);
    case "PageDown":return normalizeFraction(value-SPLIT_STEP_LARGE);
    case "PageUp":return normalizeFraction(value+SPLIT_STEP_LARGE);
    case "Home":return 0;
    case "End":return 1;
    default:return null;
  }
}

/** Split under a horizontal drag of `dx` points across a frame `frameWidth` wide. */
export function splitFromDrag(start:number,dx:number,frameWidth:number):number{
  if(!Number.isFinite(dx)||!Number.isFinite(frameWidth))throw new RangeError("Invalid split drag");
  return normalizeFraction(start+dx/Math.max(1,frameWidth));
}

/** The rectangle the compared images share inside a box: the primary image fitted (contain). */
export function compareFrame(primary:{width:number;height:number},boxWidth:number,boxHeight:number){
  return fitContain(primary.width,primary.height,Math.max(1,boxWidth),Math.max(1,boxHeight));
}

/** Side-by-side direction for a box: panes in a row when it is wide enough, else stacked. */
export function sideBySideDirection(boxWidth:number,boxHeight:number):"row"|"column"{
  return boxWidth>=SIDE_BY_SIDE_MIN_WIDTH||boxWidth>boxHeight*1.4?"row":"column";
}

/** Spoken value of the split divider, e.g. "40% before, 60% after". */
export function splitValueText(split:number,beforeLabel:string,afterLabel:string):string{
  const b=Math.round(normalizeFraction(split)*100);
  return `${b}% ${beforeLabel.toLowerCase()}, ${100-b}% ${afterLabel.toLowerCase()}`;
}

/** Why a comparing mode cannot show, or `undefined` when both images are present. */
export function compareReason(before:unknown,after:unknown,beforeLabel:string,afterLabel:string):string|undefined{
  if(before&&after)return undefined;
  if(!before&&!after)return `No ${beforeLabel.toLowerCase()} or ${afterLabel.toLowerCase()} image yet`;
  return `No ${(before?afterLabel:beforeLabel).toLowerCase()} image yet`;
}
