import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface VideoStabilizationSettings {strength:number;smoothingFrames:number;quality:'fast'|'balanced'|'high'}
export interface VideoStabilizationInspectorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:VideoStabilizationSettings;qualities:readonly VideoStabilizationSettings['quality'][];
 onChange:(value:VideoStabilizationSettings,signal?:AbortSignal)=>void|Promise<unknown>;
 analysis:{status:'idle'|'running'|'ready'|'error';progress?:number;error?:string;cropFraction?:number};
 onAnalyze:(signal?:AbortSignal)=>void|Promise<unknown>;onCancel:()=>void;preview:ReactNode;unstyled?:boolean;
}
export function VideoStabilizationInspector({scope='video-stabilization',revision=0,...props}:VideoStabilizationInspectorProps){
 const {value,qualities,onChange:_change,analysis,onAnalyze:_analyze,onCancel,preview,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isFinite(value.strength)||value.strength<0||value.strength>1||!Number.isInteger(value.smoothingFrames)||value.smoothingFrames<1||value.smoothingFrames>240||!['fast','balanced','high'].includes(value.quality)||qualities.length>3||new Set(qualities).size!==qualities.length||qualities.some(q=>!['fast','balanced','high'].includes(q))||!['idle','running','ready','error'].includes(analysis.status)||![analysis.progress,analysis.cropFraction].every(n=>n===undefined||Number.isFinite(n)&&n>=0&&n<=1))throw new RangeError('Invalid video stabilization');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason]),props,disabledReason!==undefined||analysis.status==='running'),off=guard.pending||disabledReason!==undefined||analysis.status==='running';
 const set=(patch:Partial<VideoStabilizationSettings>)=>guard.run('settings',(host,signal)=>host.onChange({...host.value,...patch},signal));
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Video stabilization">
  <PrecisionScrubber scope={scope} revision={revision} label="Stabilization strength" value={value.strength} min={0} max={1} step={.01} disabled={off} unstyled={unstyled} onCommit={strength=>set({strength})}/>
  <PrecisionScrubber scope={scope} revision={revision} label="Smoothing frames" value={value.smoothingFrames} min={1} max={240} step={1} disabled={off} unstyled={unstyled} onCommit={smoothingFrames=>set({smoothingFrames:Math.round(smoothingFrames)})}/>
  <SegmentedControl aria-label="Stabilization quality" value={value.quality} options={(['fast','balanced','high'] as const).map(quality=>({value:quality,label:quality,disabled:!qualities.includes(quality)}))} disabled={off} unstyled={unstyled} onChange={quality=>set({quality})}/>
  {preview}
  <Text {...{className:unstyled?undefined:'text-text'}}>Measured crop retained: {analysis.cropFraction===undefined?'Not reported':(analysis.cropFraction*100).toFixed(1)+'%'}</Text>
  <Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{analysis.status}{analysis.progress===undefined?'':`; ${(analysis.progress*100).toFixed(0)}%`}</Text>
  <Button title="Analyze stabilization" disabled={off||!qualities.includes(value.quality)} unstyled={unstyled} onPress={()=>guard.run('analyze',(host,signal)=>host.onAnalyze(signal))}/>
  {guard.pendingId==='analyze'||analysis.status==='running'?<Button title="Cancel stabilization analysis" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancel();}}/>:null}
  <ErrorMessage {...exact({message:guard.error??analysis.error??undefined,unstyled:unstyled})}/>
 </View>;
}
