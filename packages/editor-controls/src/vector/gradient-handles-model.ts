/**
 * Geometry for {@linkcode GradientOnCanvasHandles} (B-24): where each handle
 * and stop sits, and the gradient that results from moving one. All points
 * are content coordinates; the component maps them to the view.
 */
import {
  AVAILABLE,MAX_GRADIENT_STOPS,MIN_GRADIENT_STOPS,roundCoord,unavailable,validatePaint,
  type Availability,type GradientPaint,type GradientStop,type Point,type Rgba,
} from "./vector-types.ts";

/** A draggable gradient handle. Linear has start and end; radial has center, radius and an optional focal point. */
export type GradientHandle="start"|"end"|"center"|"radius"|"focal";
/** Focal points stay this fraction of the radius inside the circle, since the engine wants them strictly inside. */
export const FOCAL_LIMIT=0.98;
/** Shortest radius the handles produce, in content units. */
export const MIN_RADIUS=0.5;
/** Offset change per arrow press on a stop (Shift: ten times). */
export const STOP_KEY_STEP=0.01;

/** Throws a RangeError unless `paint` is a valid linear or radial gradient. */
export function validateGradient(paint:GradientPaint):void{
  if(paint.type!=="linear"&&paint.type!=="radial")throw new RangeError("Gradient handles need a linear or radial paint");
  validatePaint(paint);
}
/** Each handle the paint shows, with its content point. */
export function gradientHandles(paint:GradientPaint):{handle:GradientHandle;point:Point}[]{
  if(paint.type==="linear")return [{handle:"start",point:{x:paint.x0,y:paint.y0}},{handle:"end",point:{x:paint.x1,y:paint.y1}}];
  const out:{handle:GradientHandle;point:Point}[]=[
    {handle:"center",point:{x:paint.cx,y:paint.cy}},{handle:"radius",point:{x:paint.cx+paint.r,y:paint.cy}},
  ];
  if(paint.fx!==undefined&&paint.fy!==undefined)out.push({handle:"focal",point:{x:paint.fx,y:paint.fy}});
  return out;
}
/** The line stops sit on: start to end, or center to the radius handle. */
export function gradientAxis(paint:GradientPaint):{from:Point;to:Point}{
  return paint.type==="linear"?{from:{x:paint.x0,y:paint.y0},to:{x:paint.x1,y:paint.y1}}
    :{from:{x:paint.cx,y:paint.cy},to:{x:paint.cx+paint.r,y:paint.cy}};
}
/** Content point of a stop at `offset` on the axis. */
export function stopPoint(paint:GradientPaint,offset:number):Point{
  const {from,to}=gradientAxis(paint);
  return {x:from.x+(to.x-from.x)*offset,y:from.y+(to.y-from.y)*offset};
}
/** Offset 0..1 of the point on the axis nearest `p`, plus its distance from the axis. */
export function projectOnAxis(paint:GradientPaint,p:Point):{offset:number;distance:number}{
  const {from,to}=gradientAxis(paint);
  const dx=to.x-from.x,dy=to.y-from.y,len2=dx*dx+dy*dy;
  const t=len2===0?0:Math.min(1,Math.max(0,((p.x-from.x)*dx+(p.y-from.y)*dy)/len2));
  return {offset:t,distance:Math.hypot(p.x-(from.x+dx*t),p.y-(from.y+dy*t))};
}

const r3=roundCoord;
/** Snaps the direction from `origin` to `p` to the nearest 15 degrees, keeping the length. */
export function snapAngle(origin:Point,p:Point):Point{
  const dx=p.x-origin.x,dy=p.y-origin.y,len=Math.hypot(dx,dy);
  const step=Math.PI/12,a=Math.round(Math.atan2(dy,dx)/step)*step;
  return {x:origin.x+Math.cos(a)*len,y:origin.y+Math.sin(a)*len};
}
/**
 * `paint` with `handle` at content point `p`. Moving the center carries the
 * focal point with it. The radius never shrinks onto the focal point, and the
 * focal point is kept {@linkcode FOCAL_LIMIT} inside the circle. `snap`
 * (Shift) turns the end, radius or focal handle in 15 degree steps.
 */
export function moveGradientHandle(paint:GradientPaint,handle:GradientHandle,p:Point,snap=false):GradientPaint{
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new RangeError("Invalid handle point");
  if(paint.type==="linear"){
    if(handle==="start"){
      const q=snap?snapAngle({x:paint.x1,y:paint.y1},p):p;
      return {...paint,x0:r3(q.x),y0:r3(q.y)};
    }
    if(handle==="end"){
      const q=snap?snapAngle({x:paint.x0,y:paint.y0},p):p;
      return {...paint,x1:r3(q.x),y1:r3(q.y)};
    }
    throw new RangeError("A linear gradient has no "+handle+" handle");
  }
  const center={x:paint.cx,y:paint.cy};
  const focalDistance=paint.fx!==undefined&&paint.fy!==undefined?Math.hypot(paint.fx-paint.cx,paint.fy-paint.cy):0;
  switch(handle){
    case "center":{
      const dx=p.x-paint.cx,dy=p.y-paint.cy;
      const moved={...paint,cx:r3(p.x),cy:r3(p.y)};
      return paint.fx!==undefined&&paint.fy!==undefined?{...moved,fx:r3(paint.fx+dx),fy:r3(paint.fy+dy)}:moved;
    }
    case "radius":{
      const floor=Math.max(MIN_RADIUS,focalDistance/FOCAL_LIMIT+0.001);
      return {...paint,r:r3(Math.max(floor,Math.hypot(p.x-center.x,p.y-center.y)))};
    }
    case "focal":return {...paint,...clampFocal(paint,snap?snapAngle(center,p):p)};
    default:throw new RangeError("A radial gradient has no "+handle+" handle");
  }
}
/** A focal point kept strictly inside the circle of `paint`. */
export function clampFocal(paint:Extract<GradientPaint,{type:"radial"}>,p:Point):{fx:number;fy:number}{
  const dx=p.x-paint.cx,dy=p.y-paint.cy,d=Math.hypot(dx,dy),max=paint.r*FOCAL_LIMIT;
  const k=d>max?max/d:1;
  const fx=r3(paint.cx+dx*k),fy=r3(paint.cy+dy*k);
  // Rounding can push a point on the limit back out; pull it in one step if so.
  return Math.hypot(fx-paint.cx,fy-paint.cy)<paint.r?{fx,fy}:{fx:r3(paint.cx+dx*k*0.99),fy:r3(paint.cy+dy*k*0.99)};
}
/** Radial paint with a focal point added halfway to the radius handle, or removed. */
export function toggleFocal(paint:Extract<GradientPaint,{type:"radial"}>):GradientPaint{
  if(paint.fx!==undefined){
    const {fx:_fx,fy:_fy,...rest}=paint;
    return rest;
  }
  return {...paint,fx:r3(paint.cx+paint.r/2),fy:r3(paint.cy)};
}

const mix=(a:number,b:number,t:number)=>Math.round(a+(b-a)*t);
/** Color of the gradient at `offset`, interpolated between the surrounding stops. */
export function colorAt(stops:readonly GradientStop[],offset:number):Rgba{
  const first=stops[0],last=stops[stops.length-1];
  if(!first||!last)throw new RangeError("No stops");
  if(offset<=first.offset)return first.color;
  if(offset>=last.offset)return last.color;
  for(let i=1;i<stops.length;i++){
    const a=stops[i-1]!,b=stops[i]!;
    if(offset<=b.offset){
      const t=b.offset===a.offset?0:(offset-a.offset)/(b.offset-a.offset);
      return [mix(a.color[0],b.color[0],t),mix(a.color[1],b.color[1],t),mix(a.color[2],b.color[2],t),mix(a.color[3],b.color[3],t)];
    }
  }
  return last.color;
}
/** Whether a stop can be added. */
export function addStopAvailability(paint:GradientPaint):Availability{
  return paint.stops.length<MAX_GRADIENT_STOPS?AVAILABLE:unavailable("A gradient has at most 256 stops");
}
/** Whether stop `index` can be removed. */
export function removeStopAvailability(paint:GradientPaint,index:number|undefined):Availability{
  if(index===undefined||!paint.stops[index])return unavailable("Select a stop first");
  return paint.stops.length>MIN_GRADIENT_STOPS?AVAILABLE:unavailable("A gradient keeps at least two stops");
}
/** Adds a stop at `offset` with the color the gradient already has there. Returns the new paint and the stop's index. */
export function addStop(paint:GradientPaint,offset:number):{paint:GradientPaint;index:number}{
  if(!addStopAvailability(paint).enabled)throw new RangeError("A gradient has at most 256 stops");
  const at=Math.round(Math.min(1,Math.max(0,offset))*1000)/1000;
  const index=paint.stops.findIndex(s=>s.offset>at);
  const insertAt=index<0?paint.stops.length:index;
  const stop={offset:at,color:colorAt(paint.stops,at)};
  const stops=[...paint.stops.slice(0,insertAt),stop,...paint.stops.slice(insertAt)];
  return {paint:{...paint,stops},index:insertAt};
}
/** Stop `index` moved to `offset`, clamped between its neighbours so offsets never decrease. */
export function moveStop(paint:GradientPaint,index:number,offset:number):GradientPaint{
  const stop=paint.stops[index];
  if(!stop)throw new RangeError("No stop "+index);
  if(!Number.isFinite(offset))throw new RangeError("Invalid stop offset");
  const lo=paint.stops[index-1]?.offset??0,hi=paint.stops[index+1]?.offset??1;
  const at=Math.round(Math.min(hi,Math.max(lo,offset))*1000)/1000;
  return {...paint,stops:paint.stops.map((s,i)=>i===index?{...s,offset:at}:s)};
}
/** `paint` without stop `index`. @throws RangeError when only two stops remain. */
export function removeStop(paint:GradientPaint,index:number):GradientPaint{
  const a=removeStopAvailability(paint,index);
  if(!a.enabled)throw new RangeError(a.reason);
  return {...paint,stops:paint.stops.filter((_,i)=>i!==index)};
}

const HANDLE_LABELS={start:"Gradient start",end:"Gradient end",center:"Gradient center",radius:"Gradient radius",focal:"Focal point"} as const satisfies Record<GradientHandle,string>;
/** Spoken name of a handle. */
export function handleLabel(handle:GradientHandle):string{
  return HANDLE_LABELS[handle];
}
/** Spoken value of a handle: its coordinates, or the radius length. */
export function handleValueText(paint:GradientPaint,handle:GradientHandle):string{
  const n=(v:number)=>String(Math.round(v*10)/10);
  if(paint.type==="radial"&&handle==="radius")return "radius "+n(paint.r);
  const p=gradientHandles(paint).find(h=>h.handle===handle)?.point;
  if(!p)throw new RangeError("No "+handle+" handle");
  return `x ${n(p.x)}, y ${n(p.y)}`;
}
