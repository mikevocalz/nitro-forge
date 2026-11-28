import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface AudioProcessParameter {id:string;label:string;value:number;min:number;max:number;step:number;unit?:string}
export interface AudioProcessingPanelProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 label:string;parameters:readonly AudioProcessParameter[];
 job:{status:'idle'|'processing'|'ready'|'error';progress?:number;error?:string};
 /** Native host admission, including platform, source, rights and model availability. */
 capability:{available:boolean;reason?:string};audition:'original'|'processed';canApply:boolean;canRevert:boolean;
 onParameter:(id:string,value:number,signal?:AbortSignal)=>unknown;
 onProcess:(signal?:AbortSignal)=>unknown;onCancel:()=>void;
 onAudition:(source:'original'|'processed',signal?:AbortSignal)=>unknown;
 onApply:(signal?:AbortSignal)=>unknown;onRevert:(signal?:AbortSignal)=>unknown;
 measurements?:readonly {label:string;value:string}[];preview?:ReactNode;unstyled?:boolean;
}
/** Shared controlled processing lifecycle. No model, DSP, audio session or native handle is created here. */
export function AudioProcessingPanel({scope='audio-processing',revision=0,...props}:AudioProcessingPanelProps){
 const {label,parameters,job,capability,audition,canApply,canRevert,onParameter:_parameter,onProcess:_process,onCancel,onAudition:_audition,onApply:_apply,onRevert:_revert,measurements=[],preview,unstyled=false,disabledReason,style,...rest}=props;
 if(!label.trim()||label.length>1024||parameters.length>64||new Set(parameters.map(p=>p.id)).size!==parameters.length||parameters.some(p=>!p.id.trim()||p.id.length>512||!p.label.trim()||p.label.length>1024||![p.value,p.min,p.max,p.step].every(Number.isFinite)||p.min>=p.max||p.step<=0||p.value<p.min||p.value>p.max)||!['idle','processing','ready','error'].includes(job.status)||job.progress!==undefined&&(!Number.isFinite(job.progress)||job.progress<0||job.progress>1)||!['original','processed'].includes(audition)||measurements.length>64||measurements.some(m=>!m.label.trim()||m.label.length>1024||m.value.length>2048))throw new RangeError('Invalid audio processing panel');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),label,disabledReason,capability,parameters.map(p=>[p.id,p.min,p.max,p.step])])]),guard=useScopedControl(owner,props,disabledReason!==undefined||!capability.available||job.status==='processing'),off=guard.pending||disabledReason!==undefined||!capability.available||job.status==='processing';
 return <View {...rest} accessibilityLabel={label} style={[{gap:8,minWidth:0},style]}>
  <Text accessibilityRole="header" {...{className:unstyled?undefined:'text-text'}}>{label}</Text>
  {parameters.map(p=><PrecisionScrubber key={p.id} scope={owner+p.id} label={p.label} min={p.min} max={p.max} step={p.step} value={p.value} {...(p.unit===undefined?{}:{unit:p.unit})} disabled={off} unstyled={unstyled} onCommit={value=>guard.run('parameter',(h,s)=>{const current=h.parameters.find(v=>v.id===p.id);return current&&value>=current.min&&value<=current.max?h.onParameter(p.id,value,s):undefined;})}/>)}
  <Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>Processing: {job.status}{job.progress===undefined?'':`; ${(job.progress*100).toFixed(0)}%`}</Text>
  {preview}{measurements.map((m,i)=><Text key={i} {...{className:unstyled?undefined:'text-text'}}>{m.label}: {m.value}</Text>)}
  <Button title="Process preview" disabled={off} unstyled={unstyled} onPress={()=>guard.run('process',(h,s)=>h.capability.available?h.onProcess(s):undefined)}/>
  {guard.pendingId==='process'||job.status==='processing'?<Button title="Cancel audio processing" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancel();}}/>:null}
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{(['original','processed'] as const).map(source=><Button key={source} title={`Audition ${source}`} accessibilityState={{selected:audition===source}} disabled={off||source==='processed'&&job.status!=='ready'} unstyled={unstyled} onPress={()=>guard.run('audition',(h,s)=>source==='original'||h.job.status==='ready'?h.onAudition(source,s):undefined)}/>)}</View>
  <Button title="Apply processed audio" disabled={off||!canApply||job.status!=='ready'} unstyled={unstyled} onPress={()=>guard.run('apply',(h,s)=>h.canApply&&h.job.status==='ready'?h.onApply(s):undefined)}/>
  <Button title="Revert processing" variant="secondary" disabled={off||!canRevert} unstyled={unstyled} onPress={()=>guard.run('revert',(h,s)=>h.canRevert?h.onRevert(s):undefined)}/>
  <ErrorMessage {...exact({message:guard.error??job.error??disabledReason??(!capability.available?(capability.reason??'Processing unavailable'):undefined),unstyled:unstyled})}/>
 </View>;
}
