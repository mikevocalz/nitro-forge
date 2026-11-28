import {useEffect} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {useStore} from 'zustand';
import {WaveformLane} from '../WaveformLane.tsx';
import {assertWaveformRange,type WaveformPeak,type WaveformRange} from '../waveform.ts';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {createWaveformCache,sharedWaveformCache,mediaProviderId} from './waveform-cache.ts';
import {exact} from '../exact-optional.ts';
export interface AudioClipWaveformProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 sourceId:string;sourceRevision:number;range:WaveformRange;columns?:number;height?:number;position?:number;
 /** Real decoded min/max peaks for the requested source interval. */
 loadPeaks:(range:WaveformRange,columns:number,signal:AbortSignal)=>Promise<readonly WaveformPeak[]>;
 onSeek?:(sourcePosition:number,signal?:AbortSignal)=>void|Promise<unknown>;
 cache?:ReturnType<typeof createWaveformCache>;unstyled?:boolean;
}
export function AudioClipWaveform({scope='clip-waveform',revision=0,...props}:AudioClipWaveformProps){
 const {sourceId,sourceRevision,range,columns=512,height=64,position,loadPeaks,onSeek,cache=sharedWaveformCache,unstyled=false,disabledReason,style,...rest}=props;
 assertWaveformRange(range);
 if(!sourceId.trim()||sourceId.length>512||!Number.isSafeInteger(sourceRevision)||sourceRevision<0||!Number.isInteger(columns)||columns<1||columns>4096||!Number.isFinite(height)||height<44||height>8192||position!==undefined&&(!Number.isFinite(position)||position<0||position>1))throw new RangeError('Invalid audio waveform');
 const identity=JSON.stringify([...controlIdentity(scope,revision),sourceId,sourceRevision]),key=JSON.stringify([identity,range,columns,mediaProviderId(loadPeaks)]);
 const version=useStore(cache.store,s=>s.version),state=cache.get(key),guard=useScopedControl(key,props,disabledReason!==undefined);
 useEffect(()=>cache.retain(key),[cache,key]);
 useEffect(()=>{cache.request(key,signal=>loadPeaks(range,columns,signal));},[cache,key,version]);
 return <View {...rest} style={[{minWidth:0,gap:4},style]} accessibilityLabel="Audio clip waveform">
  {state.kind==='ready'&&state.peaks.length?<WaveformLane key={key} peaks={state.peaks} columns={columns} height={height} unstyled={unstyled}
   {...(position===undefined?{}:{position:Math.min(1,Math.max(0,(position-range.start)/(range.end-range.start)))})}
   {...(onSeek&&disabledReason===undefined?{onSeekNormalized:(value:number)=>guard.run('seek',(host,signal)=>host.onSeek?.(host.range.start+value*(host.range.end-host.range.start),signal))}:{})}/>
   :<Text accessibilityRole={state.kind==='error'?'alert':undefined} {...{className:unstyled?undefined:'text-text'}}>{state.kind==='error'?state.message:state.kind==='ready'?'No decoded audio samples':'Loading source waveform'}</Text>}
  {state.kind==='error'?<Button title="Retry waveform" variant="secondary" unstyled={unstyled} onPress={()=>cache.request(key,signal=>loadPeaks(range,columns,signal),true)}/>:null}
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
