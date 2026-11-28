import {assertHsv,hsvToRgb,rgbToHsv,wrapHue,type HsvColor,type RgbaColor} from "../color.ts";

/** Hue/saturation/lightness plus alpha, edited by `ColorChannelFields`. */
export interface HslColor {
  /** Hue in degrees, wrapped to 0..360. */
  readonly h:number;
  /** Saturation 0..1. */
  readonly s:number;
  /** Lightness 0..1. */
  readonly l:number;
  /** Alpha 0..1. */
  readonly alpha:number;
}

export function assertHsl(c:HslColor):void{
  if(![c.h,c.s,c.l,c.alpha].every(Number.isFinite)||
    c.s<0||c.s>1||c.l<0||c.l>1||c.alpha<0||c.alpha>1)
    throw new RangeError("Expected finite hue, saturation 0..1, lightness 0..1 and alpha 0..1");
}

/**
 * HSV to HSL without passing through 8-bit RGB, so hue and the float channels
 * survive exactly. Saturation is 0 at black and white, where HSL has none.
 */
export function hsvToHsl(c:HsvColor):HslColor{
  assertHsv(c);
  const l=c.v*(1-c.s/2);
  const s=l===0||l===1?0:(c.v-l)/Math.min(l,1-l);
  return {h:wrapHue(c.h),s:Math.max(0,Math.min(1,s)),l,alpha:c.alpha};
}

/**
 * Inverse of {@linkcode hsvToHsl}. HSV saturation is 0 at black (`l` 0), and the
 * hue passes through unchanged.
 */
export function hslToHsv(c:HslColor):HsvColor{
  assertHsl(c);
  const v=c.l+c.s*Math.min(c.l,1-c.l);
  const s=v===0?0:2*(1-c.l/v);
  return {h:wrapHue(c.h),s:Math.max(0,Math.min(1,s)),v:Math.max(0,Math.min(1,v)),alpha:c.alpha};
}

/** 8-bit RGB to HSL. Gray returns `retainedHue`, as {@linkcode rgbToHsv} does. */
export function rgbToHsl(c:RgbaColor,retainedHue=0):HslColor{
  return hsvToHsl(rgbToHsv(c,retainedHue));
}

/** HSL to 8-bit RGB, rounding each channel. */
export function hslToRgb(c:HslColor):RgbaColor{
  return hsvToRgb(hslToHsv(c));
}
