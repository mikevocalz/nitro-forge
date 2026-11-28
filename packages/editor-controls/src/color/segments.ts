import {assertRgba,hsvToRgb,rgbaToHex,type RgbaColor} from "../color.ts";

/*
 * Gradients drawn from solid views. The optional peers that draw real gradients
 * (expo-linear-gradient, Skia) are not required by these controls, and React
 * Native has no conic gradient for a hue ring, so tracks and wheels are built
 * from a fixed number of solid segments. Segment colors are color-model values,
 * not theme colors.
 */

/** Linear interpolation of two colors in 8-bit sRGB, alpha included. */
export function mixRgba(a:RgbaColor,b:RgbaColor,t:number):RgbaColor{
  assertRgba(a);
  assertRgba(b);
  const k=Math.max(0,Math.min(1,t));
  const ch=(x:number,y:number)=>Math.round(x+(y-x)*k);
  return {r:ch(a.r,b.r),g:ch(a.g,b.g),b:ch(a.b,b.b),alpha:a.alpha+(b.alpha-a.alpha)*k};
}

/**
 * `count` `#RRGGBBAA` colors sampled at segment centers along evenly spaced
 * `stops`, for a gradient track drawn as `count` equal views.
 */
export function trackSegments(stops:readonly RgbaColor[],count:number):string[]{
  if(stops.length<2)throw new RangeError("A track needs at least two stops");
  if(!Number.isSafeInteger(count)||count<1||count>512)throw new RangeError("Segment count must be 1..512");
  return Array.from({length:count},(_,i)=>{
    const t=(i+0.5)/count*(stops.length-1);
    const j=Math.min(stops.length-2,Math.floor(t));
    return rgbaToHex(mixRgba(stops[j]!,stops[j+1]!,t-j));
  });
}

/** Pure hues (full saturation and value) at the centers of `count` equal ring segments. */
export function hueSegments(count:number):{angle:number;color:string}[]{
  if(!Number.isSafeInteger(count)||count<3||count>720)throw new RangeError("Hue segment count must be 3..720");
  return Array.from({length:count},(_,i)=>{
    const angle=(i+0.5)*360/count;
    return {angle,color:rgbaToHex(hsvToRgb({h:angle,s:1,v:1,alpha:1}),false)};
  });
}

/**
 * Alphas for `layers` concentric white circles, largest first, that turn a
 * pie of pure hues into a hue/saturation disc. Ring `j` of `layers` (counted
 * from the center) should be white at `1 - (j - 0.5) / layers`, so saturation
 * grows linearly with radius; each circle's alpha is solved from the ones
 * drawn under it.
 */
export function saturationLayerAlphas(layers:number):number[]{
  if(!Number.isSafeInteger(layers)||layers<2||layers>64)throw new RangeError("Layer count must be 2..64");
  const white=(j:number)=>1-(j-0.5)/layers;
  const alphas:number[]=[];
  let below=0;
  for(let j=layers;j>=1;j--){
    const target=white(j);
    alphas.push(j===layers?target:1-(1-target)/(1-below));
    below=target;
  }
  return alphas;
}

/** Composite white fraction at ring `j` (1 = center) after drawing {@linkcode saturationLayerAlphas}. */
export function saturationAtRing(alphas:readonly number[],j:number):number{
  const layers=alphas.length;
  let clear=1;
  for(let i=0;i<=layers-j;i++)clear*=1-alphas[i]!;
  return 1-clear;
}

/** Checkerboard cell count across a track of `width`, for transparency previews. */
export function checkerColumns(width:number,cell=7):number{
  if(!Number.isFinite(width)||width<=0)return 0;
  return Math.ceil(width/cell);
}
