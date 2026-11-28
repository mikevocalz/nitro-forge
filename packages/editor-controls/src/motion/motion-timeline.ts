import {MOTION_MAX_TIME,MOTION_TIME_EPSILON,validateMotionCurve,moveMotionKeys,type MotionPropertyCurve,type MotionKeySelection} from './motion-curves.ts';
export function motionSelectionKey(value:MotionKeySelection):string{return JSON.stringify([value.propertyId,value.keyId]);}
export function validateMotionTimeline(curves:readonly MotionPropertyCurve[],selection:readonly MotionKeySelection[],duration:number):void {
 if(!Number.isFinite(duration)||duration<=0||duration>MOTION_MAX_TIME||curves.length>128||selection.length>100000)throw new RangeError('Invalid motion timeline budget or duration');const ids=new Set<string>(),keys=new Set<string>();let total=0;
 for(const curve of curves){validateMotionCurve(curve);if(ids.has(curve.id)||curve.keys.some(key=>key.time>duration))throw new TypeError('Timeline properties must be distinct and fit the composition');ids.add(curve.id);total+=curve.keys.length;if(total>100000)throw new RangeError('Timeline page exceeds 100,000 keys');for(const key of curve.keys)keys.add(motionSelectionKey({propertyId:curve.id,keyId:key.id}));}
 const seen=new Set<string>();for(const ref of selection){const id=motionSelectionKey(ref);if(!keys.has(id)||seen.has(id))throw new TypeError('Timeline selection contains duplicate or unavailable keys');seen.add(id);}
}
/** Common intersection of every selected key's allowed time translation. */
export function motionSelectionBounds(curves:readonly MotionPropertyCurve[],selection:readonly MotionKeySelection[],duration:number,gap=MOTION_TIME_EPSILON):readonly [number,number] {
 validateMotionTimeline(curves,selection,duration);if(!Number.isFinite(gap)||gap<MOTION_TIME_EPSILON)throw new RangeError('Timeline key separation must be positive');const selected=new Set(selection.map(motionSelectionKey));let minimum=-Infinity,maximum=Infinity;
 for(const curve of curves){let previous:number|undefined;for(const key of curve.keys){if(!selected.has(motionSelectionKey({propertyId:curve.id,keyId:key.id}))){previous=key.time;continue;}minimum=Math.max(minimum,(previous===undefined?0:previous+gap)-key.time);}
  let next:number|undefined;for(let i=curve.keys.length-1;i>=0;i--){const key=curve.keys[i]!;if(!selected.has(motionSelectionKey({propertyId:curve.id,keyId:key.id}))){next=key.time;continue;}maximum=Math.min(maximum,(next===undefined?duration:next-gap)-key.time);}
 }return selection.length?[minimum,maximum]:[0,0];
}
/** Cross-property drag is one atomic translation with one shared snapping anchor. */
export function moveMotionSelection(curves:readonly MotionPropertyCurve[],selection:readonly MotionKeySelection[],anchor:MotionKeySelection,delta:number,duration:number,snapStep=0):readonly MotionPropertyCurve[] {
 validateMotionTimeline(curves,selection,duration);if(!Number.isFinite(delta)||!Number.isFinite(snapStep)||snapStep<0||!selection.some(ref=>motionSelectionKey(ref)===motionSelectionKey(anchor)))throw new RangeError('Motion group move requires a selected anchor and finite delta');
 const source=curves.find(curve=>curve.id===anchor.propertyId)!.keys.find(key=>key.id===anchor.keyId)!,requested=snapStep>0?Math.round((source.time+delta)/snapStep)*snapStep-source.time:delta,[minimum,maximum]=motionSelectionBounds(curves,selection,duration,Math.max(MOTION_TIME_EPSILON,snapStep));if(minimum>maximum)return curves;const translation=Math.max(minimum,Math.min(maximum,requested));
 const chosen=new Map<string,string[]>();for(const ref of selection){const ids=chosen.get(ref.propertyId)??[];ids.push(ref.keyId);chosen.set(ref.propertyId,ids);}return curves.map(curve=>chosen.has(curve.id)?moveMotionKeys(curve,chosen.get(curve.id)!,translation,0,duration):curve);
}
