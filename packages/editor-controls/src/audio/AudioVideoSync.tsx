import {Text,View,type ViewProps} from 'react-native';
import type {ReactNode} from 'react';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {assertFrameRate,type FrameRate} from '../timebase.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface AudioVideoSyncProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 surface:ReactNode;aspectRatio:number;sampleRate:number;audioSample:number;presentedFrame:number|null;
 rate:FrameRate;pictureOffsetSamples:number;toleranceSamples:number;playing:boolean;
 lockStatus:'unlocked'|'locking'|'locked'|'error';error?:string;onLock:(signal?:AbortSignal)=>unknown;onUnlock:()=>void;unstyled?:boolean;
}
/** Actual presentation telemetry against the audio master clock, without a second UI timer. */
export function AudioVideoSync({scope='audio-video-sync',revision=0,...props}:AudioVideoSyncProps){
 const {surface,aspectRatio,sampleRate,audioSample,presentedFrame,rate,pictureOffsetSamples,toleranceSamples,playing,lockStatus,error,onLock:_lock,onUnlock,unstyled=false,disabledReason,style,...rest}=props;assertFrameRate(rate);
 if(!Number.isFinite(sampleRate)||sampleRate<1||sampleRate>768000||!Number.isSafeInteger(audioSample)||audioSample<0||presentedFrame!==null&&(!Number.isSafeInteger(presentedFrame)||presentedFrame<0)||!Number.isSafeInteger(pictureOffsetSamples)||!Number.isSafeInteger(toleranceSamples)||toleranceSamples<0||!Number.isFinite(aspectRatio)||aspectRatio<=0||aspectRatio>10||!['unlocked','locking','locked','error'].includes(lockStatus))throw new RangeError('Invalid AV clock telemetry');
 const owner=JSON.stringify([...controlIdentity(scope,revision),sampleRate,rate,pictureOffsetSamples,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const frameSamples=presentedFrame===null?null:presentedFrame*rate.denominator/rate.numerator*sampleRate,drift=frameSamples===null?null:frameSamples+pictureOffsetSamples-audioSample;
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement},style]} accessibilityLabel="Audio picture synchronization"><View style={{aspectRatio,minHeight:controlTokens.extent.fieldWide,overflow:'hidden'}}>{surface}</View>
  <Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{lockStatus} · {playing?'Playing':'Stopped'} · audio master {audioSample} samples</Text>
  <Text {...{className:unstyled?undefined:'text-text'}}>{drift===null?'No presented-frame measurement supplied':`Picture ${drift>=0?'ahead':'behind'} by ${Math.abs(drift/sampleRate*1000).toFixed(2)} ms · ${Math.abs(drift)<=toleranceSamples?'within tolerance':'outside tolerance'}`}</Text>
  <Button title="Lock picture to audio clock" disabled={off||lockStatus==='locked'||lockStatus==='locking'} unstyled={unstyled} onPress={()=>guard.run('lock',(h,s)=>h.onLock(s))}/>
  {lockStatus==='locked'||lockStatus==='locking'||guard.pendingId==='lock'?<Button title="Release picture clock lock" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onUnlock();}}/>:null}
  <ErrorMessage {...exact({message:guard.error??error??disabledReason,unstyled:unstyled})}/>
 </View>;
}
