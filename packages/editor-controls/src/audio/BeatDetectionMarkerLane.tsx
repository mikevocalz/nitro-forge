import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {View,Text,type ViewProps} from 'react-native';
import {TimelineMarkers,type TimelineMarkersProps} from '../timeline/TimelineMarkers.tsx';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface BeatDetectionMarkerLaneProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 lane:Omit<TimelineMarkersProps,'scope'|'revision'|'disabled'|'disabledReason'|'unstyled'>;
 sensitivity:number;detectedBpm:number|null;status:'idle'|'detecting'|'ready'|'error';progress?:number;error?:string;unavailableReason?:string;
 onSensitivityCommit:(value:number,signal?:AbortSignal)=>unknown;onDetect:(signal?:AbortSignal)=>unknown;onCancel:()=>void;unstyled?:boolean;
}
/** Actual host beat detection, sharing timeline marker movement, naming, adding and removal. */
export function BeatDetectionMarkerLane({scope='beat-markers',revision=0,...props}:BeatDetectionMarkerLaneProps){
 const {lane,sensitivity,detectedBpm,status,progress,error,unavailableReason,onSensitivityCommit:_sensitivity,onDetect:_detect,onCancel,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isFinite(sensitivity)||sensitivity<0||sensitivity>1||detectedBpm!==null&&(!Number.isFinite(detectedBpm)||detectedBpm<=0||detectedBpm>1000)||!['idle','detecting','ready','error'].includes(status)||progress!==undefined&&(!Number.isFinite(progress)||progress<0||progress>1))throw new RangeError('Invalid beat detection');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined||status==='detecting'),off=guard.pending||disabledReason!==undefined||status==='detecting';
 return <View {...rest} accessibilityLabel="Beat detection markers" style={[{gap:8},style]}>
  <PrecisionScrubber scope={owner} label="Beat detection sensitivity" min={0} max={1} step={.01} value={sensitivity} disabled={off} unstyled={unstyled} onCommit={n=>guard.run('sensitivity',(h,s)=>h.onSensitivityCommit(n,s))}/>
  <Button title="Detect clip beats" disabled={off||unavailableReason!==undefined} accessibilityHint={unavailableReason} unstyled={unstyled} onPress={()=>guard.run('detect',(h,s)=>h.unavailableReason===undefined?h.onDetect(s):undefined)}/>
  {status==='detecting'||guard.pendingId==='detect'?<Button title="Cancel beat detection" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancel();}}/>:null}
  <Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>Detection: {status}{progress===undefined?'':`; ${(progress*100).toFixed(0)}%`} · tempo: {detectedBpm===null?'Not reported':detectedBpm.toFixed(2)+' BPM'}</Text>
  <TimelineMarkers {...lane} scope={scope} revision={revision} disabled={off} unstyled={unstyled} onSelect={id=>guard.current()?.lane.onSelect(id)} onSeek={f=>guard.current()?.lane.onSeek(f)} onAdd={at=>guard.run('add',h=>h.lane.onAdd(at))} onUpdate={(id,u)=>guard.run('edit',h=>h.lane.onUpdate(id,u))} onRemove={id=>guard.run('remove',h=>h.lane.onRemove(id))}/>
  <ErrorMessage message={guard.error??error??disabledReason??unavailableReason} unstyled={unstyled}/>
 </View>;
}
