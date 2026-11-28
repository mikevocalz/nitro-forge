import {createValueGesture} from '@nyc-tron/ui/components/gestures/value-gesture';
export interface FrameScrubOwnerInputs {disabled?:boolean;preview?:(frame:number)=>void;restore():void;commit(frame:number):void}
/** Ownership around the existing value gesture; contains no coordinate math. */
export function createFrameScrubOwner(show:(frame:number|undefined)=>void){
 let boundary:string|undefined,epoch=0,blocked=false;
 let session:{boundary:string;inputs:FrameScrubOwnerInputs}|undefined;
 const valid=(s:typeof session)=>s!==undefined&&s.boundary===boundary&&!blocked&&!s.inputs.disabled;
 const gesture=createValueGesture<number>({
  disabled:()=>!valid(session),equals:(a,b)=>a===b,
  preview:frame=>{const s=session;if(!valid(s))return;show(frame);if(session===s&&valid(s))s!.inputs.preview?.(frame);},
  commit:frame=>{const previous=session,request=epoch;session=undefined;show(undefined);if(request===epoch&&valid(previous))previous!.inputs.commit(frame);},
 });
 const cancel=()=>{const previous=session;session=undefined;gesture.cancel();show(undefined);previous?.inputs.restore();};
 return {
  admit(next:string,disabled=false){if(boundary===next&&blocked===disabled)return;boundary=next;blocked=disabled;epoch++;cancel();},
  invalidate(){boundary=undefined;epoch++;cancel();},
  begin(expected:string,frame:number,inputs:FrameScrubOwnerInputs){if(boundary!==expected||blocked||inputs.disabled)return false;const request=++epoch;cancel();if(request!==epoch||boundary!==expected||blocked||inputs.disabled)return false;session={boundary:expected,inputs};gesture.begin(frame);return true;},
  move(expected:string,frame:number){if(boundary===expected)gesture.update(frame);},
  release(expected:string){if(boundary!==expected)return;const previous=session;gesture.release();if(session===previous){session=undefined;show(undefined);}},
  cancel(expected:string){if(boundary!==expected)return;epoch++;cancel();},
  admitted(expected:string){return boundary===expected&&!blocked;},
  current(expected:string){return boundary===expected&&valid(session);},
 };
}
