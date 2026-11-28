import {validateGradient} from "../vector/gradient-handles-model.ts";
import type {GradientPaint,Rgba} from "../vector/vector-types.ts";
/** Explicit interpolation and interval-midpoint settings for GradientStopEditor. */
export interface GradientOptions {
 readonly interpolation:'srgb'|'linear-rgb';
 /** One relative midpoint per adjacent stop pair, strictly between zero and one. */
 readonly midpoints:readonly number[];
}
/** Checks the hint topology before a paint/options transaction. */
export function validateGradientOptions(paint:GradientPaint,options:GradientOptions):void{
 validateGradient(paint);if(!['srgb','linear-rgb'].includes(options.interpolation)||options.midpoints.length!==paint.stops.length-1||options.midpoints.some(n=>!Number.isFinite(n)||n<=0||n>=1))throw new RangeError('Gradient options require one interior midpoint per stop interval and a known interpolation space');
}
// sRGB transfer constants: https://www.w3.org/TR/css-color-4/#color-conversion-code
const linear=(n:number)=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
const encoded=(n:number)=>n<=.0031308?n*12.92:1.055*n**(1/2.4)-.055;
/** Samples straight-alpha display RGBA through premultiplied interpolation and the selected midpoint. */
export function sampleGradient(paint:GradientPaint,options:GradientOptions,offset:number):Rgba{
 validateGradientOptions(paint,options);if(!Number.isFinite(offset)||offset<0||offset>1)throw new RangeError('Gradient offset must be 0..1');
 const right=paint.stops.findIndex(s=>s.offset>offset);if(right===0)return paint.stops[0]!.color;if(right<0)return paint.stops.at(-1)!.color;
 const a=paint.stops[right-1]!,b=paint.stops[right]!,u=(offset-a.offset)/(b.offset-a.offset),mid=options.midpoints[right-1]!;
 // A piecewise linear color hint: the given position is exactly half-way in color.
 const t=u<=mid?.5*u/mid:.5+.5*(u-mid)/(1-mid),alpha=(a.color[3]*(1-t)+b.color[3]*t)/255;
 const channels=[0,1,2].map(index=>{
  if(alpha===0)return 0;const from=a.color[index]!/255,to=b.color[index]!/255;
  const value=((options.interpolation==='linear-rgb'?linear(from):from)*a.color[3]/255*(1-t)+(options.interpolation==='linear-rgb'?linear(to):to)*b.color[3]/255*t)/alpha;
  return Math.round(Math.max(0,Math.min(1,options.interpolation==='linear-rgb'?encoded(value):value))*255);
 });return [channels[0]!,channels[1]!,channels[2]!,Math.round(alpha*255)];
}
/** Changes linear/radial geometry around its existing origin, preserving every stop. */
export function changeGradientType(paint:GradientPaint,type:GradientPaint['type']):GradientPaint{
 validateGradient(paint);if(type===paint.type)return paint;
 if(type==='radial'&&paint.type==='linear')return {type:'radial',cx:paint.x0,cy:paint.y0,r:Math.max(.001,Math.hypot(paint.x1-paint.x0,paint.y1-paint.y0)),stops:paint.stops};
 if(type==='linear'&&paint.type==='radial')return {type:'linear',x0:paint.cx,y0:paint.cy,x1:paint.cx+paint.r,y1:paint.cy,stops:paint.stops};
 throw new TypeError('Unknown gradient type');
}
/** Rotates a linear gradient about its start, retaining length. Angle follows document coordinates. */
export function rotateGradient(paint:GradientPaint,degrees:number):GradientPaint{
 validateGradient(paint);if(paint.type!=='linear'||!Number.isFinite(degrees))throw new TypeError('Gradient angle requires a linear gradient and finite degrees');
 const radius=Math.max(.001,Math.hypot(paint.x1-paint.x0,paint.y1-paint.y0)),radians=degrees*Math.PI/180;
 return {...paint,x1:paint.x0+Math.cos(radians)*radius,y1:paint.y0+Math.sin(radians)*radius};
}
