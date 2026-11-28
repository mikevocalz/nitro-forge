import {createStore} from 'zustand/vanilla';
import {rangePosition,scrollRange,type WaveformRange} from './waveform.ts';
/** A gesture owns the coordinates/range captured at grant; cancellation consumes release. */
export function createWaveformGesture(){
 let gesture:{boundary:string;width:number;range:WaveformRange;preview:WaveformRange|null}|null=null;
 return {
  begin(boundary:string,width:number,range:WaveformRange){gesture=Number.isFinite(width)&&width>0?{boundary,width,range:{...range},preview:null}:null;},
  cancel(){const scrolling=gesture?.preview!=null;gesture=null;return scrolling;},
  move(boundary:string,dx:number,canScroll:boolean){
   if(!gesture||gesture.boundary!==boundary||!canScroll||!Number.isFinite(dx)||gesture.preview===null&&Math.abs(dx)<6)return null;
   const next=scrollRange(gesture.range,dx,gesture.width);
   if(gesture.preview&&gesture.preview.start===next.start&&gesture.preview.end===next.end)return null;
   gesture.preview=next;return next;
  },
  release(boundary:string,x:number){
   const previous=gesture;gesture=null;
   if(!previous||previous.boundary!==boundary||!Number.isFinite(x))return null;
   return previous.preview?{kind:'range' as const,range:previous.preview,changed:previous.preview.start!==previous.range.start}:{kind:'seek' as const,position:rangePosition(previous.range,x,previous.width)};
  },
 };
}
/** Read synchronously during render; no post-render reset can expose another source's caret. */
export function waveformPosition(position:number|undefined,source:string,last:{source:string;value:number}){
 return position!==undefined&&Number.isFinite(position)?Math.min(1,Math.max(0,position)):last.source===source?last.value:0;
}

export function createWaveformLaneStore(range:WaveformRange,source:string){
 return createStore(()=>({active:false,range,fallback:{source,value:0}}));
}
export function writeWaveformPosition(store:ReturnType<typeof createWaveformLaneStore>,source:string,next:number){
 const value=Math.min(1,Math.max(0,next));store.setState({fallback:{source,value}});return value;
}
/** Reads and writes the actual store synchronously, including between React renders. */
export function stepWaveformPosition(store:ReturnType<typeof createWaveformLaneStore>,authority:{source:string;position?:number},delta:number){
 return writeWaveformPosition(store,authority.source,waveformPosition(authority.position,authority.source,store.getState().fallback)+delta);
}
