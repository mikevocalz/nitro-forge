import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {View,Text,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
export interface LatencyCalibrationPanelProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 deviceLabel:string;sampleRate:number;bufferSizes:readonly number[];bufferSamples:number;offsetSamples:number;
 measurement:{roundTripSamples:number;driftPpm:number;confidence:number;measuredAt:string}|null;
 status:'idle'|'measuring'|'error';error?:string;unavailableReason?:string;
 onMeasure:(signal?:AbortSignal)=>unknown;onCancel:()=>void;
 onBufferCommit:(samples:number,signal?:AbortSignal)=>unknown;onOffsetCommit:(samples:number,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Displays host loopback measurements; calibration tones and device buffers stay native-owned. */
export function LatencyCalibrationPanel({scope='latency-calibration',revision=0,...props}:LatencyCalibrationPanelProps){
 const {deviceLabel,sampleRate,bufferSizes,bufferSamples,offsetSamples,measurement,status,error,unavailableReason,onMeasure:_measure,onCancel,onBufferCommit:_buffer,onOffsetCommit:_offset,unstyled=false,disabledReason,style,...rest}=props;
 if(!deviceLabel.trim()||deviceLabel.length>1024||!Number.isFinite(sampleRate)||sampleRate<1||sampleRate>768000||bufferSizes.length>64||bufferSizes.some(n=>!Number.isSafeInteger(n)||n<1||n>1048576)||new Set(bufferSizes).size!==bufferSizes.length||!Number.isSafeInteger(bufferSamples)||bufferSamples<1||!Number.isSafeInteger(offsetSamples)||Math.abs(offsetSamples)>sampleRate*10||!['idle','measuring','error'].includes(status)||measurement&&(!Number.isFinite(measurement.roundTripSamples)||measurement.roundTripSamples<0||!Number.isFinite(measurement.driftPpm)||!Number.isFinite(measurement.confidence)||measurement.confidence<0||measurement.confidence>1||!measurement.measuredAt.trim()||measurement.measuredAt.length>256))throw new RangeError('Invalid latency calibration');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),deviceLabel,sampleRate,bufferSizes,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined||status==='measuring'),off=guard.pending||disabledReason!==undefined||status==='measuring';
 return <View {...rest} accessibilityLabel="Latency calibration" style={[{gap:8},style]}>
  <Text {...{className:unstyled?undefined:'text-text'}}>{deviceLabel} · {sampleRate} Hz · current buffer {bufferSamples} samples</Text>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{bufferSizes.map(n=><Button key={n} title={n+' sample buffer'} accessibilityState={{selected:n===bufferSamples}} disabled={off} unstyled={unstyled} onPress={()=>guard.run('buffer',(h,s)=>h.bufferSizes.includes(n)?h.onBufferCommit(n,s):undefined)}/>)}</View>
  <PrecisionScrubber scope={owner+'offset'} label="Recording compensation offset" min={-sampleRate*10} max={sampleRate*10} step={1} value={offsetSamples} unit="samples" disabled={off} unstyled={unstyled} onCommit={n=>guard.run('offset',(h,s)=>h.onOffsetCommit(n,s))}/>
  <Button title="Measure round-trip latency" disabled={off||unavailableReason!==undefined} accessibilityHint={unavailableReason} unstyled={unstyled} onPress={()=>guard.run('measure',(h,s)=>h.unavailableReason===undefined?h.onMeasure(s):undefined)}/>
  {status==='measuring'||guard.pendingId==='measure'?<Button title="Cancel calibration" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancel();}}/>:null}
  <Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{measurement?`Measured ${(measurement.roundTripSamples/sampleRate*1000).toFixed(2)} ms round trip; ${measurement.driftPpm.toFixed(2)} ppm drift; ${(measurement.confidence*100).toFixed(0)}% confidence; ${measurement.measuredAt}`:'No loopback measurement supplied'}</Text>
  <ErrorMessage message={guard.error??error??disabledReason??unavailableReason} unstyled={unstyled}/>
 </View>;
}
