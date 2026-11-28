import {assertHsv,wrapHue,type HsvColor} from "../color.ts";

/** A point inside the saturation/value field, in layout units. */
export interface FieldPoint {
 readonly x:number;
 readonly y:number;
}
/** Measured size of the saturation/value field, in layout units. */
export interface FieldSize {
 readonly width:number;
 readonly height:number;
}
const assertSize=(size:FieldSize)=>{
 if(![size.width,size.height].every(Number.isFinite)||size.width<=0||size.height<=0)
  throw new RangeError("Color field dimensions must be positive and finite");
};
/**
 * Maps a point to saturation (X, left to right) and value (Y, bottom to top),
 * clamped to the field. Hue and alpha come from `current`. Preview and commit
 * use this same mapping.
 */
export function pointToHsv(point:FieldPoint,size:FieldSize,current:HsvColor):HsvColor{
 assertHsv(current);
 assertSize(size);
 if(!Number.isFinite(point.x)||!Number.isFinite(point.y))
  throw new RangeError("Color field coordinates must be finite");
 return {
  h:wrapHue(current.h),
  s:Math.max(0,Math.min(1,point.x/size.width)),
  v:Math.max(0,Math.min(1,1-point.y/size.height)),
  alpha:current.alpha,
 };
}
/** Inverse of {@linkcode pointToHsv}: where the thumb sits for `color`. */
export function hsvToPoint(color:HsvColor,size:FieldSize):FieldPoint{
 assertHsv(color);
 assertSize(size);
 return {x:size.width*color.s,y:size.height*(1-color.v)};
}
