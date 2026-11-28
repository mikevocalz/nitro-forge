import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
export interface LoopPunchConfiguration {loop:boolean;punch:boolean;startSample:number;endSample:number;preRollSamples:number;postRollSamples:number}
export interface LoopPunchRecordingProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 durationSamples:number;sampleRate:number;value:LoopPunchConfiguration;recording:boolean;passCount:number;
 onCommit:(value:LoopPunchConfiguration,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Sample-clock recording boundaries; the host owns rolling, looping and take allocation. */
export function LoopPunchRecording({scope='loop-punch',revision=0,...props}:LoopPunchRecordingProps){
 const {durationSamples,sampleRate,value,recording,passCount,onCommit:_commit,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(durationSamples)||durationSamples<1||!Number.isFinite(sampleRate)||sampleRate<1||sampleRate>768000||!Number.isSafeInteger(passCount)||passCount<0||![value.startSample,value.endSample,value.preRollSamples,value.postRollSamples].every(Number.isSafeInteger)||value.startSample<0||value.endSample<=value.startSample||value.endSample>durationSamples||value.preRollSamples<0||value.postRollSamples<0||value.preRollSamples>durationSamples||value.postRollSamples>durationSamples)throw new RangeError('Invalid loop recording range');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),durationSamples,sampleRate,recording,disabledReason])]),guard=useScopedControl(owner,props,recording||disabledReason!==undefined),off=recording||guard.pending||disabledReason!==undefined;
 const change=(patch:Partial<LoopPunchConfiguration>)=>guard.run('configuration',(host,signal)=>host.onCommit({...host.value,...patch},signal));
 return <View {...rest} accessibilityLabel="Loop and punch recording" style={[{gap:8},style]}>
  <Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{recording?'Recording':'Stopped'} · {passCount} completed passes</Text>
  {(['loop','punch'] as const).map(key=><Button key={key} title={`${key==='loop'?'Loop recording':'Punch recording'} ${value[key]?'on':'off'}`} accessibilityState={{checked:value[key]}} disabled={off} unstyled={unstyled} onPress={()=>change({[key]:!value[key]})}/>)}
  {([{key:'startSample',label:'Recording range start',min:0,max:value.endSample-1},{key:'endSample',label:'Recording range end',min:value.startSample+1,max:durationSamples},{key:'preRollSamples',label:'Pre-roll',min:0,max:durationSamples},{key:'postRollSamples',label:'Post-roll',min:0,max:durationSamples}] as const).map(f=>f.max>f.min?<PrecisionScrubber key={f.key} scope={owner+f.key} label={f.label} value={value[f.key]} min={f.min} max={f.max} step={1} unit="samples" disabled={off} unstyled={unstyled} onCommit={n=>change({[f.key]:n})}/>:null)}
  <Text {...{className:unstyled?undefined:'text-text'}}>Range {((value.endSample-value.startSample)/sampleRate).toFixed(3)} s; boundaries locked during recording.</Text>
  <ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/>
 </View>;
}
