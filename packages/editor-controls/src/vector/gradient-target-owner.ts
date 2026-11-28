import {gradientHandles,type GradientHandle} from './gradient-handles-model.ts';
import type {GradientPaint} from './vector-types.ts';
export type GradientTarget={kind:'handle';handle:GradientHandle}|{kind:'stop';index:number};
/** Admit queued input before indexing or doing geometry in the current source. */
export function gradientTargetCurrent(expected:string,current:string,blocked:boolean,paint:GradientPaint,target:GradientTarget){
 if(blocked||expected!==current)return false;
 return target.kind==='handle'?gradientHandles(paint).some(value=>value.handle===target.handle):Number.isInteger(target.index)&&target.index>=0&&target.index<paint.stops.length;
}
