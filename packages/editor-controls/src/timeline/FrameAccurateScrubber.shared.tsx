import {useLayoutEffect,useRef,type ComponentType} from 'react';
import {View,Text} from 'react-native';
import type {NativeSeekBarProps} from '../NativeSeekBar.types.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {assertFrameRate,clampFrame,type FrameRate} from '../timebase.ts';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface FrameSeekRequest {frame:number;timeUs:number;exact:boolean;frameRate:FrameRate}
export interface FrameSeekResult {requestedFrame:number;presentedFrame:number;presentationTimeUs:number;timing:'presentation'|'seek-target'}
export interface FrameAccurateScrubberProps extends Omit<NativeSeekBarProps,'onCommit'|'onSeek'|'onPreview'> {
 /** Number of source frames; the last seekable frame is durationFrames - 1. */
 readonly durationFrames:number;
 onSeekFrame:(request:FrameSeekRequest,signal:AbortSignal)=>Promise<FrameSeekResult>;
 onPresented:(result:FrameSeekResult)=>void;disabledReason?:string;
}
/** Coalesces preview seeks to one in flight and one newest queued target. Final commit waits for an exact presentation acknowledgement. */
export function FrameAccurateScrubberBody({SeekBar,onSeekFrame,onPresented,disabledReason,...props}:FrameAccurateScrubberProps&{SeekBar:ComponentType<NativeSeekBarProps>}){
 if(!Number.isSafeInteger(props.durationFrames)||props.durationFrames<0)throw new RangeError('Invalid source frame count');
 assertFrameRate(props.frameRate);const {scope='frame-scrubber',revision=0,durationFrames,frameRate}=props,owner=JSON.stringify([...controlIdentity(scope,revision),durationFrames,frameRate,props.disabled,disabledReason]),guard=useScopedControl(owner,{onSeekFrame,onPresented,...props},!!props.disabled||disabledReason!==undefined||durationFrames===0),pipeline=useRef<{controller:AbortController|null;queued:number|null;epoch:number;host:typeof onSeekFrame|null}>({controller:null,queued:null,epoch:0,host:null});
 const cancel=()=>{const p=pipeline.current;p.epoch++;p.controller?.abort();p.controller=null;p.queued=null;p.host=null;};useLayoutEffect(()=>{cancel();return cancel;},[owner]);
 const request=(frame:number,exact:boolean):FrameSeekRequest=>{const f=clampFrame(frame,Math.max(0,durationFrames-1)),timeUs=Math.round(f*1000000*frameRate.denominator/frameRate.numerator);if(!Number.isSafeInteger(timeUs))throw new RangeError('Frame time exceeds supported integer precision');return {frame:f,timeUs,exact,frameRate};};
 const preview=(frame:number)=>{const h=guard.current();if(!h)return;const p=pipeline.current;p.queued=clampFrame(frame,Math.max(0,h.durationFrames-1));p.host=h.onSeekFrame;drain();};
 const drain=()=>{const p=pipeline.current;if(p.controller||p.queued===null||!p.host)return;const frame=p.queued;p.queued=null;const controller=new AbortController(),epoch=p.epoch,host=p.host;p.controller=controller;void Promise.resolve().then(()=>controller.signal.aborted?undefined:host(request(frame,false),controller.signal)).catch(()=>undefined).finally(()=>{if(p.epoch!==epoch)return;p.controller=null;drain();});};
 const commit=(frame:number)=>{cancel();return guard.run('exact-frame',async(h,signal)=>{const target=request(frame,true),result=await h.onSeekFrame(target,signal);if(signal.aborted)return;if(result.requestedFrame!==target.frame||result.presentedFrame!==target.frame||result.timing!=='presentation'||!Number.isSafeInteger(result.presentationTimeUs)||result.presentationTimeUs<0)throw new Error('The decoder did not acknowledge the exact requested frame');h.onPresented(result);});};
 return <View style={{gap:tokens.spacing.fixedElement}}><SeekBar {...props} durationFrames={Math.max(0,durationFrames-1)} frame={clampFrame(props.frame,Math.max(0,durationFrames-1))} scope={scope} revision={revision} disabled={!!props.disabled||disabledReason!==undefined||guard.pending||durationFrames===0} onPreview={preview} onCommit={commit}/><Text {...{className:props.unstyled?undefined:'text-text-muted'}}>Final position requires the decoder’s actual presentation timestamp; seek-target estimates are rejected.</Text><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:props.unstyled})}/></View>;
}
