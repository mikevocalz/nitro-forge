/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/ColorPanel.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (the `Disc` picker's ring/disc
 * hit test, hue angle convention, unit-disc clamp and ring proportions, and
 * `HeldColor`'s rule that grays keep their hue).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Kotlin/Compose to
 * TypeScript, hue made linear in angle (ProCraft's core measures a non-linear
 * ring scale), a pixel threshold added for hue retention, the elliptical
 * square-to-disc map dropped (the disc here is hue/saturation, not
 * saturation/brightness), and a relative fine-precision ring drag added.
 */
import {assertHsv,wrapHue,type HsvColor} from "../color.ts";
import type {FieldPoint,FieldSize} from "./fieldGeometry.ts";

/** Inner over outer radius of the hue ring. ProCraft's ring runs 124 to 182 dp. */
export const RING_INNER_FRACTION=124/182;
/** Below this many layout units from the center, a disc point has no hue of its own. */
export const HUE_RETAIN_RADIUS=1;
/** Hue change per degree of pointer travel in the ring's fine zone (inside the hole). */
export const FINE_HUE_RATE=0.2;

/** A point's polar position around the center of a square or rectangular field. */
export interface PolarPoint {
  /** Degrees anticlockwise from the positive x axis (3 o'clock), 0..360. */
  readonly angle:number;
  /** Distance from the center in layout units. */
  readonly distance:number;
  /** Half the shorter side: the disc's radius. */
  readonly radius:number;
}

const assertSize=(size:FieldSize)=>{
  if(![size.width,size.height].every(Number.isFinite)||size.width<=0||size.height<=0)
    throw new RangeError("Color wheel dimensions must be positive and finite");
};

/** Polar position of `point`. Screen y grows downward, so angles run anticlockwise on screen. */
export function toPolar(point:FieldPoint,size:FieldSize):PolarPoint{
  assertSize(size);
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new RangeError("Color wheel coordinates must be finite");
  const dx=point.x-size.width/2,dy=point.y-size.height/2;
  return {angle:wrapHue(Math.atan2(-dy,dx)*180/Math.PI),distance:Math.hypot(dx,dy),radius:Math.min(size.width,size.height)/2};
}

/** The layout point at `angle` degrees and `distance` units from the center. */
export function fromPolar(angle:number,distance:number,size:FieldSize):FieldPoint{
  assertSize(size);
  const a=angle*Math.PI/180;
  return {x:size.width/2+Math.cos(a)*distance,y:size.height/2-Math.sin(a)*distance};
}

/**
 * Whether a touch at `distance` belongs to the hue ring rather than the inner
 * disc. As in ProCraft, the boundary is halfway between the disc's edge and the
 * ring's inner edge, so the gap between them still picks the nearer control.
 */
export function isOnRing(distance:number,radius:number,discFraction:number):boolean{
  return distance>radius*(discFraction+RING_INNER_FRACTION)/2;
}

/**
 * Hue/saturation disc: angle is hue, distance from the center is saturation.
 * Value and alpha come from `current`. Points outside the disc clamp to its
 * edge. Within {@linkcode HUE_RETAIN_RADIUS} of the center the color is gray and
 * keeps `current.h`, so dragging through the middle does not reset the hue.
 */
export function discPointToHsv(point:FieldPoint,size:FieldSize,current:HsvColor):HsvColor{
  assertHsv(current);
  const p=toPolar(point,size);
  const s=Math.min(1,p.distance/p.radius);
  const h=p.distance<HUE_RETAIN_RADIUS?wrapHue(current.h):p.angle;
  return {h,s,v:current.v,alpha:current.alpha};
}

/** Inverse of {@linkcode discPointToHsv}: where the disc thumb sits for `color`. */
export function hsvToDiscPoint(color:HsvColor,size:FieldSize):FieldPoint{
  assertHsv(color);
  assertSize(size);
  return fromPolar(color.h,color.s*Math.min(size.width,size.height)/2,size);
}

/** Where the ring thumb sits for `hue`: the middle of the ring's band. */
export function hueToRingPoint(hue:number,size:FieldSize):FieldPoint{
  const r=Math.min(size.width,size.height)/2;
  return fromPolar(wrapHue(hue),r*(1+RING_INNER_FRACTION)/2,size);
}

/** Signed shortest rotation from `from` to `to`, -180..180 degrees. */
export function angleDelta(from:number,to:number):number{
  const d=wrapHue(to-from);
  return d>180?d-360:d;
}

/** State of a ring drag; see {@linkcode createRingDrag}. */
export interface RingDragState {
  readonly hue:number;
  /** True while the pointer is inside the ring's hole, where hue moves at {@linkcode FINE_HUE_RATE}. */
  readonly fine:boolean;
}
/** Ring drag returned by {@linkcode createRingDrag}. */
export interface RingDrag {
  begin(point:FieldPoint,size:FieldSize,hue:number):RingDragState;
  move(point:FieldPoint,size:FieldSize):RingDragState;
}
/**
 * Hue ring drag with a precision zone. A touch on the ring jumps to the angle
 * under it. After that every move is relative: the hue turns by the pointer's
 * change in angle, at full rate over the ring and at {@linkcode FINE_HUE_RATE}
 * inside the hole. Sliding inward therefore slows the hue without a jump, and
 * sliding back out resumes 1:1 tracking from wherever the hue got to.
 */
export function createRingDrag():RingDrag{
  let hue=0,lastAngle=0;
  const fineAt=(p:PolarPoint)=>p.distance<p.radius*RING_INNER_FRACTION;
  return {
    begin(point,size,current){
      const p=toPolar(point,size);
      const fine=fineAt(p);
      hue=fine?wrapHue(current):p.angle;
      lastAngle=p.angle;
      return {hue,fine};
    },
    move(point,size){
      const p=toPolar(point,size);
      const fine=fineAt(p);
      // Within a pixel of the center the angle is noise; hold the hue.
      if(p.distance>=HUE_RETAIN_RADIUS){
        hue=wrapHue(hue+angleDelta(lastAngle,p.angle)*(fine?FINE_HUE_RATE:1));
        lastAngle=p.angle;
      }
      return {hue,fine};
    },
  };
}
