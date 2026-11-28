/**
 * Document-independent sRGB display color math from Nitro Forge color-ui
 * PRs #26 and #34. ICC, CMYK, HDR, L*a*b* and spot colors stay in the
 * owning Forge engine; these helpers only drive display controls.
 */

/** 8-bit RGB plus floating alpha, edited by {@linkcode ColorChannels}. */
export interface RgbaColor {
 /** Integer red channel 0..255. */
 readonly r:number;
 /** Integer green channel 0..255. */
 readonly g:number;
 /** Integer blue channel 0..255. */
 readonly b:number;
 /** Alpha 0..1. */
 readonly alpha:number;
}
/** Hue/saturation/value plus alpha, edited by `HsvPicker`. */
export interface HsvColor {
 /** Hue in degrees. Any finite angle is accepted and wrapped to 0..360. */
 readonly h:number;
 /** Saturation 0..1. */
 readonly s:number;
 /** Value (brightness) 0..1. */
 readonly v:number;
 /** Alpha 0..1. */
 readonly alpha:number;
}
export function assertRgba(c:RgbaColor):void{
 if([c.r,c.g,c.b].some(n=>!Number.isInteger(n)||n<0||n>255))
  throw new RangeError("RGB channels must be integers 0..255");
 if(!Number.isFinite(c.alpha)||c.alpha<0||c.alpha>1)
  throw new RangeError("Alpha must be 0..1");
}
export function assertHsv(c:HsvColor):void{
 if(![c.h,c.s,c.v,c.alpha].every(Number.isFinite)||
   c.s<0||c.s>1||c.v<0||c.v>1||c.alpha<0||c.alpha>1)
  throw new RangeError("Expected finite hue, saturation 0..1, value 0..1 and alpha 0..1");
}
/** Wraps any finite angle into 0..360 (360 itself becomes 0). */
export function wrapHue(h:number):number{
 if(!Number.isFinite(h))throw new RangeError("Hue must be finite");
 // In-range hues return unchanged: (h%360+360)%360 adds float error (217.4 -> 217.39999999999998).
 if(h>=0&&h<360)return h+0; // +0 turns -0 (from atan2) into 0
 return ((h%360)+360)%360;
}
export function rgbaToHex(c:RgbaColor,includeAlpha=true):string{
 assertRgba(c);
 const hex=(n:number)=>Math.round(n).toString(16).padStart(2,"0").toUpperCase();
 const rgb=`#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
 return includeAlpha?rgb+hex(c.alpha*255):rgb;
}
/**
 * Whole opacity percent for a stored alpha. `#RRGGBBAA` keeps alpha as one
 * byte, and the byte step (about 0.39%) is finer than 1%, so every whole
 * percent 0..100 survives a hex round trip under this rounding.
 */
export function alphaPercent(alpha:number):number{
 if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new RangeError("Invalid alpha");
 return Math.round(alpha*100);
}
/** Parses `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`; the `#` is optional. */
export function parseHexColor(value:string):RgbaColor{
 const candidate=value.trim().replace(/^#/,"");
 if(!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(candidate))
  throw new RangeError("Expected #RGB, #RGBA, #RRGGBB or #RRGGBBAA");
 const hex=candidate.length<=4?[...candidate].map(c=>c+c).join(""):candidate;
 return {
  r:parseInt(hex.slice(0,2),16),
  g:parseInt(hex.slice(2,4),16),
  b:parseInt(hex.slice(4,6),16),
  alpha:hex.length===8?parseInt(hex.slice(6,8),16)/255:1,
 };
}
/**
 * Converts RGB to HSV. Gray has no hue, so `retainedHue` is returned for
 * zero-saturation input; pass the picker's current hue to keep it when the
 * user drags RGB channels through gray.
 */
export function rgbToHsv(c:RgbaColor,retainedHue=0):HsvColor{
 assertRgba(c);
 const r=c.r/255,g=c.g/255,b=c.b/255;
 const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
 let h=wrapHue(retainedHue);
 if(delta>0){
  if(max===r)h=60*(((g-b)/delta)%6);
  else if(max===g)h=60*((b-r)/delta+2);
  else h=60*((r-g)/delta+4);
  h=wrapHue(h);
 }
 return {h,s:max===0?0:delta/max,v:max,alpha:c.alpha};
}
/** Converts HSV to 8-bit RGB, rounding each channel. */
export function hsvToRgb(c:HsvColor):RgbaColor{
 assertHsv(c);
 const hue=wrapHue(c.h);
 const chroma=c.v*c.s;
 const x=chroma*(1-Math.abs((hue/60)%2-1));
 const m=c.v-chroma;
 const [r,g,b]=hue<60?[chroma,x,0]:hue<120?[x,chroma,0]:hue<180?[0,chroma,x]
  :hue<240?[0,x,chroma]:hue<300?[x,0,chroma]:[chroma,0,x];
 const byte=(n:number)=>Math.round((n+m)*255);
 return {r:byte(r),g:byte(g),b:byte(b),alpha:c.alpha};
}
/**
 * HSV for an RGBA edit made from `current`. When only alpha changed, `current`
 * keeps its exact h/s/v; re-deriving them from 8-bit RGB would drift all three
 * (and drop saturation at zero brightness). Otherwise converts with
 * {@linkcode rgbToHsv}, retaining `current.h` through gray.
 */
export function rgbaEditToHsv(next:RgbaColor,current:HsvColor):HsvColor{
 const rgb=hsvToRgb(current);
 assertRgba(next);
 if(next.r===rgb.r&&next.g===rgb.g&&next.b===rgb.b)return {...current,alpha:next.alpha};
 return rgbToHsv(next,current.h);
}
