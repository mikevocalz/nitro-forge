/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * crates/engine/src/transform.rs
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`MAGNETIC_STEP`, the 15°
 * step a turn keeps to with magnetics on, and rounding the box's resulting
 * angle, not the turn, to that step).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Rust to TypeScript in
 * degrees, magnetics bound to the Shift key, and the pivot (transform origin)
 * maths, 9-point anchors and keyboard steps written new for
 * TransformOriginHandle against Prism's layer transform.
 */
import {tidy,type DocPoint} from "./canvas-viewport.ts";

/**
 * A layer transform as Prism reports it: translation, scale, rotation in
 * degrees clockwise on screen, and the origin (pivot) in content coordinates.
 * Prism maps a content point p to the document as `A·(p − o) + o + t`, with
 * `A = R(rotation)·S(sx, sy)`, so the pivot sits at document `o + t`.
 */
export interface LayerTransform {
  readonly tx:number;
  readonly ty:number;
  readonly sx:number;
  readonly sy:number;
  readonly rotation:number;
  readonly ox:number;
  readonly oy:number;
}
/** The four document corners of a layer's transformed bounds, as `layerBounds` reports `corners`: top-left, top-right, bottom-right, bottom-left of the content. */
export type BoundsCorners=readonly [readonly [number,number],readonly [number,number],readonly [number,number],readonly [number,number]];
/** The nine pivot anchors: corners, edge midpoints and centre. */
export type OriginAnchor="top-left"|"top"|"top-right"|"left"|"center"|"right"|"bottom-left"|"bottom"|"bottom-right";
/** Anchors in reading order, the order keys 1..9 (numeric keypad layout) and screen-reader cycling use. */
export const ORIGIN_ANCHORS=["top-left","top","top-right","left","center","right","bottom-left","bottom","bottom-right"] as const satisfies readonly OriginAnchor[];
const ANCHOR_UV:Record<OriginAnchor,readonly [number,number]>={
  "top-left":[0,0],top:[0.5,0],"top-right":[1,0],left:[0,0.5],center:[0.5,0.5],right:[1,0.5],
  "bottom-left":[0,1],bottom:[0.5,1],"bottom-right":[1,1],
};
/** Spoken anchor names. */
export const ORIGIN_ANCHOR_LABELS:Record<OriginAnchor,string>={
  "top-left":"top left corner",top:"top edge","top-right":"top right corner",left:"left edge",center:"center",
  right:"right edge","bottom-left":"bottom left corner",bottom:"bottom edge","bottom-right":"bottom right corner",
};
/** Rotation step with Shift held. ProCraft's magnetic step is π/12. */
export const ROTATION_SNAP_STEP=15;
/** A dragged pivot within this many screen units of an anchor lands on it. */
export const ANCHOR_SNAP_RADIUS=12;
/** Arrow-key pivot step in document pixels; Shift uses the page step. */
export const ORIGIN_STEP=1;
export const ORIGIN_PAGE_STEP=10;

/** Throws a `RangeError` when a transform cannot be inverted or has a non-finite field. */
export function validateTransform(t:LayerTransform):void{
  if(![t.tx,t.ty,t.sx,t.sy,t.rotation,t.ox,t.oy].every(Number.isFinite))throw new RangeError("Layer transform must be finite");
  if(Math.abs(t.sx)<1e-9||Math.abs(t.sy)<1e-9)throw new RangeError("Layer transform has a zero scale; its pivot cannot be placed");
}
const linear=(t:LayerTransform)=>{
  const r=t.rotation*Math.PI/180,s=Math.sin(r),c=Math.cos(r);
  return {a:c*t.sx,b:s*t.sx,c:-s*t.sy,d:c*t.sy};
};
/** Document position of a content point. */
export function contentToDoc(t:LayerTransform,p:DocPoint):DocPoint{
  const {a,b,c,d}=linear(t);
  const x=p.x-t.ox,y=p.y-t.oy;
  return {x:tidy(a*x+c*y+t.ox+t.tx),y:tidy(b*x+d*y+t.oy+t.ty)};
}
/** Content point under a document position: the inverse of {@linkcode contentToDoc}. */
export function docToContent(t:LayerTransform,q:DocPoint):DocPoint{
  validateTransform(t);
  const {a,b,c,d}=linear(t);
  const det=a*d-b*c;
  const x=q.x-t.ox-t.tx,y=q.y-t.oy-t.ty;
  return {x:tidy((d*x-c*y)/det+t.ox),y:tidy((-b*x+a*y)/det+t.oy)};
}
/** Where the pivot is drawn: document `o + t`. */
export const pivotInDoc=(t:LayerTransform):DocPoint=>({x:tidy(t.ox+t.tx),y:tidy(t.oy+t.ty)});
/** Document position of an anchor on the transformed bounds (bilinear over the four corners). */
export function anchorPoint(corners:BoundsCorners,anchor:OriginAnchor):DocPoint{
  const [u,v]=ANCHOR_UV[anchor];
  const [p0,p1,p2,p3]=corners;
  const top={x:p0[0]+(p1[0]-p0[0])*u,y:p0[1]+(p1[1]-p0[1])*u};
  const bottom={x:p3[0]+(p2[0]-p3[0])*u,y:p3[1]+(p2[1]-p3[1])*u};
  return {x:tidy(top.x+(bottom.x-top.x)*v),y:tidy(top.y+(bottom.y-top.y)*v)};
}
/** Corners of an axis-aligned rectangle, for layers reported without `corners`. */
export function rectCorners(r:{readonly x:number;readonly y:number;readonly w:number;readonly h:number}):BoundsCorners{
  return [[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]];
}
/** The anchor within `radius` document pixels of `point`, nearest first, if any. */
export function nearestAnchor(corners:BoundsCorners,point:DocPoint,radius:number):OriginAnchor|undefined{
  let best:{anchor:OriginAnchor;d:number}|undefined;
  for(const anchor of ORIGIN_ANCHORS){
    const p=anchorPoint(corners,anchor);
    const d=Math.hypot(p.x-point.x,p.y-point.y);
    if(d<=radius&&(!best||d<best.d))best={anchor,d};
  }
  return best?.anchor;
}
/** The anchor the pivot sits on now, if it sits on one. */
export const currentAnchor=(corners:BoundsCorners,t:LayerTransform)=>nearestAnchor(corners,pivotInDoc(t),0.5);
/**
 * The `setTransformOrigin` payload for a pivot dropped at a document point:
 * content coordinates. Prism compensates `tx`/`ty`, so nothing moves.
 */
export function originPayload(t:LayerTransform,docPoint:DocPoint):{ox:number;oy:number}{
  const c=docToContent(t,docPoint);
  return {ox:c.x,oy:c.y};
}
/**
 * Rotation for a drag around the pivot: the starting rotation plus the angle
 * swept from `from` to `to`, both document points. With `snap` (Shift held)
 * the resulting angle, not the turn, keeps to {@linkcode ROTATION_SNAP_STEP}.
 * Result is normalized to (-180, 180].
 */
export function rotationFromDrag(pivot:DocPoint,from:DocPoint,to:DocPoint,startRotation:number,snap=false):number{
  const angle=(p:DocPoint)=>Math.atan2(p.y-pivot.y,p.x-pivot.x)*180/Math.PI;
  return snapRotation(startRotation+angle(to)-angle(from),snap);
}
/** An angle in degrees, rounded to {@linkcode ROTATION_SNAP_STEP} when `snap` is set, normalized to (-180, 180]. */
export function snapRotation(degrees:number,snap=false,step=ROTATION_SNAP_STEP):number{
  if(!Number.isFinite(degrees))throw new RangeError("Rotation must be finite");
  if(!(step>0))throw new RangeError("Rotation step must be positive");
  const v=snap?Math.round(degrees/step)*step:degrees;
  let n=((v%360)+360)%360;
  if(n>180)n-=360;
  return tidy(n);
}
/** What a key press on the focused pivot asks for. */
export type OriginKeyCommand={readonly kind:"move";readonly dx:number;readonly dy:number}|{readonly kind:"anchor";readonly anchor:OriginAnchor};
/**
 * Arrows move the pivot one document pixel (ten with Shift); Right is always
 * +x because canvas geometry is not mirrored in RTL. Keys 1..9 jump to the
 * anchors in numeric-keypad layout (7 top left, 5 centre, 3 bottom right).
 */
export function originKeyCommand(key:string|undefined,shift=false):OriginKeyCommand|undefined{
  const s=shift?ORIGIN_PAGE_STEP:ORIGIN_STEP;
  switch(key){
    case "ArrowLeft":return {kind:"move",dx:-s,dy:0};
    case "ArrowRight":return {kind:"move",dx:s,dy:0};
    case "ArrowUp":return {kind:"move",dx:0,dy:-s};
    case "ArrowDown":return {kind:"move",dx:0,dy:s};
  }
  const pad:Record<string,OriginAnchor>={"7":"top-left","8":"top","9":"top-right","4":"left","5":"center","6":"right","1":"bottom-left","2":"bottom","3":"bottom-right"};
  const anchor=key!==undefined?pad[key]:undefined;
  return anchor?{kind:"anchor",anchor}:undefined;
}
/** Next or previous anchor in {@linkcode ORIGIN_ANCHORS} order, wrapping; from no anchor, the centre. */
export function cycleAnchor(current:OriginAnchor|undefined,direction:1|-1):OriginAnchor{
  if(current===undefined)return "center";
  const i=ORIGIN_ANCHORS.indexOf(current);
  return ORIGIN_ANCHORS[(i+direction+ORIGIN_ANCHORS.length)%ORIGIN_ANCHORS.length]!;
}
/** Spoken pivot description, e.g. "Pivot at center" or "Pivot at 120, 48". */
export function originAccessibilityValue(corners:BoundsCorners,t:LayerTransform):string{
  const anchor=currentAnchor(corners,t);
  const p=pivotInDoc(t);
  return anchor?`Pivot at ${ORIGIN_ANCHOR_LABELS[anchor]}`:`Pivot at ${Math.round(p.x)}, ${Math.round(p.y)}`;
}
