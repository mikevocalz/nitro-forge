import type {HsvColor} from "../color.ts";
import {pointToHsv,type FieldPoint,type FieldSize} from "./fieldGeometry.ts";

/** Accessors the field gesture reads on every event; see {@linkcode createFieldGesture}. */
export interface FieldGestureOptions {
 readonly getSize:()=>FieldSize;
 readonly getValue:()=>HsvColor;
 readonly getDisabled:()=>boolean;
 readonly onChange:(next:HsvColor)=>void;
}
/** Responder callbacks returned by {@linkcode createFieldGesture}. */
export interface FieldGesture {
 shouldStart():boolean;
 grant(point:FieldPoint):void;
 move(point:FieldPoint):void;
 release():void;
 terminate():void;
 terminationRequest():boolean;
}
/**
 * Responder logic for the saturation/value field, free of React Native so it
 * can be unit tested.
 *
 * - Input is ignored until layout reports a positive size, so a touch before
 *   `onLayout` does nothing instead of throwing inside a responder callback.
 * - During a drag the field refuses termination requests, so a parent
 *   ScrollView cannot take over a vertical brightness drag.
 * - A forced platform cancel (`terminate` during a drag) restores the color
 *   from the start of the drag, matching UIKit and Android touch-cancel
 *   behavior. A normal release keeps the last color; the host's Cancel action
 *   discards a previewed color.
 */
export function createFieldGesture(options:FieldGestureOptions):FieldGesture{
 let active=false;
 let start:HsvColor|null=null;
 const measured=()=>{
  const {width,height}=options.getSize();
  return Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0;
 };
 const apply=(point:FieldPoint)=>{
  if(!active||!measured())return;
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
  const current=options.getValue();
  const next=pointToHsv(point,options.getSize(),current);
  // Moves inside one point of the field repeat the same color; skip them so
  // the host does not re-render the picker for nothing.
  if(next.s===current.s&&next.v===current.v&&next.h===current.h)return;
  options.onChange(next);
 };
 return {
  shouldStart:()=>!options.getDisabled()&&measured(),
  grant(point){
   if(options.getDisabled()||!measured())return;
   active=true;
   start=options.getValue();
   apply(point);
  },
  move:apply,
  release(){active=false;start=null;},
  terminate(){
   if(active&&start)options.onChange(start);
   active=false;
   start=null;
  },
  terminationRequest:()=>!active,
 };
}
