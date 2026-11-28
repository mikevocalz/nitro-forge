import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export type AudioTransportAction='play'|'pause'|'stop'|'record'|'punch-in'|'punch-out'|'request-permission';
export interface NativeAudioTransportProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 playing:boolean;recording:boolean;punching:boolean;supportsPunch:boolean;canRecord:boolean;
 permission:'unknown'|'granted'|'denied';positionSamples:number;durationSamples:number;sampleRate:number;latencyMs?:number;
 onAction:(action:AudioTransportAction,signal?:AbortSignal)=>void|Promise<unknown>;
 onSeek?:(sample:number,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Requests the host's existing native audio session; no second audio graph or UI clock. */
export function NativeAudioTransport({scope='audio-transport',revision=0,...props}:NativeAudioTransportProps){
 const {playing,recording,punching,supportsPunch,canRecord,permission,positionSamples,durationSamples,sampleRate,latencyMs,onAction:_action,onSeek,unstyled=false,disabledReason,style,...rest}=props;
 if(![positionSamples,durationSamples].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isSafeInteger(sampleRate)||sampleRate<1||sampleRate>768000||!['unknown','granted','denied'].includes(permission)||latencyMs!==undefined&&(!Number.isFinite(latencyMs)||latencyMs<0))throw new RangeError('Invalid audio transport state');
 const identity=JSON.stringify(controlIdentity(scope,revision)),guard=useScopedControl(JSON.stringify([identity,disabledReason]),props,disabledReason!==undefined),stopGuard=useScopedControl(identity,props),off=guard.pending||disabledReason!==undefined;
 const action=(name:AudioTransportAction)=>guard.run(name,(host,signal)=>host.onAction(name,signal));
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Native audio transport">
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
   <Button title={playing?'Pause audio':'Play audio'} disabled={off||recording} unstyled={unstyled} onPress={()=>guard.run('play',(host,signal)=>!host.recording?host.onAction(host.playing?'pause':'play',signal):undefined)}/>
   <Button title={recording?'Recording':'Record audio'} disabled={off||recording||!canRecord||permission!=='granted'} unstyled={unstyled} onPress={()=>guard.run('record',(host,signal)=>host.canRecord&&host.permission==='granted'?host.onAction('record',signal):undefined)}/>
   <Button title="Stop audio and save recording" disabled={stopGuard.pending||!playing&&!recording&&!guard.pending} unstyled={unstyled} onPress={()=>{guard.cancel();return stopGuard.run('stop',(host,signal)=>host.onAction('stop',signal));}}/>
   {supportsPunch?<Button title={punching?'Punch out':'Punch in'} disabled={off||!playing||!canRecord||permission!=='granted'} unstyled={unstyled} onPress={()=>guard.run('punch',(host,signal)=>host.playing&&host.supportsPunch&&host.canRecord&&host.permission==='granted'?host.onAction(host.punching?'punch-out':'punch-in',signal):undefined)}/>:null}
  </View>
  {permission!=='granted'?<Button title={permission==='denied'?'Review microphone permission':'Allow microphone access'} variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>action('request-permission')}/>:null}
  <Text {...{className:unstyled?undefined:'text-text'}}>Sample {positionSamples} at {sampleRate} Hz; {(positionSamples/sampleRate).toFixed(3)} s</Text>
  <Text {...{className:unstyled?undefined:'text-text'}}>Measured latency: {latencyMs===undefined?'Not reported':latencyMs.toFixed(2)+' ms'}</Text>
  {onSeek?<PrecisionScrubber scope={scope} revision={revision} label="Audio position samples" value={Math.min(positionSamples,durationSamples)} min={0} max={Math.max(1,durationSamples)} step={1} disabled={off||recording||durationSamples===0} unstyled={unstyled} onCommit={sample=>guard.run('seek',(host,signal)=>!host.recording?host.onSeek?.(Math.min(host.durationSamples,Math.max(0,Math.round(sample))),signal):undefined)}/>:null}
  {disabledReason?<Text {...{className:unstyled?undefined:'text-text'}}>{disabledReason}</Text>:null}<ErrorMessage {...exact({message:guard.error??stopGuard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
