import {useId,useMemo} from 'react';
import {FlatList,ScrollView,Text,View,type ViewProps} from 'react-native';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {useLocalStore} from '@nyc-tron/ui/components/useLocalStore';
import {Select} from '@nyc-tron/ui/components/Select';
import {TextField} from '@nyc-tron/ui/components/TextField';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {moveQueuedRenderJob,validateRenderChoices,validateMotionRenderSettings,validateMotionRenderJobs,type MotionRenderSettings,type MotionRenderJob,type MotionRenderFormat,type MotionRenderProfile} from './motion-render.ts';
import { tokens } from '../tokens.ts';
export type {MotionRenderSettings,MotionRenderJob,MotionRenderFormat,MotionRenderProfile} from './motion-render.ts';
export interface RenderQueuePanelProps extends Omit<ViewProps,'children'> {
 /** Project identity; progress updates alone should not change this scope. */
 readonly scope:string;readonly value:MotionRenderSettings;readonly jobs:readonly MotionRenderJob[];
 readonly compositions:readonly {readonly id:string;readonly label:string}[];readonly formats:readonly MotionRenderFormat[];readonly profiles:readonly MotionRenderProfile[];readonly destinations:readonly {readonly id:string;readonly label:string}[];
 readonly onChange:(value:MotionRenderSettings)=>void;readonly onEnqueue:(settings:MotionRenderSettings,signal:AbortSignal)=>void|Promise<void>;
 readonly onCancelJob:(id:string,signal:AbortSignal)=>void|Promise<void>;readonly onRemoveJob:(id:string,signal:AbortSignal)=>void|Promise<void>;readonly onReorder:(ids:readonly string[],signal:AbortSignal)=>void|Promise<void>;
 readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Encoder-neutral queue controls; no UI timer invents render progress or completion. */
export function RenderQueuePanel({scope,value,jobs,compositions,formats,profiles,destinations,onChange,onEnqueue,onCancelJob,onRemoveJob,onReorder,height=320,disabled=false,unstyled=false,...props}:RenderQueuePanelProps){
 validateMotionRenderSettings(value,true);useMemo(()=>validateMotionRenderJobs(jobs),[jobs]);for(const [name,choices] of [['composition',compositions],['format',formats],['profile',profiles],['destination',destinations]] as const)validateRenderChoices(choices,name);
 for(const format of formats)if(!['video','image-sequence'].includes(format.kind)||typeof format.supportsAlpha!=='boolean')throw new TypeError('Invalid render encoder capabilities');
 if(!scope.trim()||!Number.isFinite(height)||height<100||height>4000)throw new RangeError('Invalid render queue scope or viewport');
 const fieldId=useId();
 const [local,store]=useLocalStore(()=>({section:'settings' as 'settings'|'queue'}));
 const action=useOwnedAction(scope),locked=disabled||action.pending!==null;
 const format=formats.find(format=>format.id===value.formatId),available=!!format&&compositions.some(v=>v.id===value.compositionId)&&profiles.some(v=>v.id===value.profileId)&&destinations.some(v=>v.id===value.destinationId),compatible=!!format&&(format.supportsAlpha||value.alpha==='none');
 const set=(change:Partial<MotionRenderSettings>)=>{if(locked)return;const next={...value,...change};validateMotionRenderSettings(next,true);onChange(next);};
 const options=(choices:readonly {id:string;label:string}[],current:string)=>choices.some(c=>c.id===current)?choices.map(c=>({value:c.id,label:c.label})): [...choices.map(c=>({value:c.id,label:c.label})),{value:current,label:`Unavailable: ${current}`,disabled:true}];
 const queued=jobs.filter(job=>job.status==='queued').map(job=>job.id);
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <SegmentedControl aria-label="Render queue view" value={local.section} options={[{value:'settings',label:'Render settings'},{value:'queue',label:'Queued renders'}]} disabled={locked} unstyled={unstyled} onChange={section=>store.set({section})}/>
  {local.section==='settings'?<ScrollView style={{height}} contentContainerStyle={{gap:tokens.spacing.fixedElement}} keyboardShouldPersistTaps="handled">
  <Select label="Render composition" value={value.compositionId} options={options(compositions,value.compositionId)} disabled={locked} unstyled={unstyled} onValueChange={compositionId=>set({compositionId})}/>
  <Select label="Render encoder format" value={value.formatId} options={options(formats,value.formatId)} disabled={locked} unstyled={unstyled} onValueChange={formatId=>{const next=formats.find(format=>format.id===formatId);set({formatId,...(next&&!next.supportsAlpha?{alpha:'none' as const}:{})});}}/>
  <Select label="Render output profile" value={value.profileId} options={options(profiles,value.profileId)} disabled={locked} unstyled={unstyled} onValueChange={profileId=>set({profileId})}/>
  <Select label="Render destination" value={value.destinationId} options={options(destinations,value.destinationId)} disabled={locked} unstyled={unstyled} onValueChange={destinationId=>set({destinationId})}/>
  <TextField id={fieldId} label="Render output name" value={value.outputName} maxLength={200} editable={!locked} aria-disabled={locked} {...(!validName(value)?{errorText:"Enter an output file stem without a path"}:{})} unstyled={unstyled} onChangeText={outputName=>{if(locked)return;onChange({...value,outputName});}}/>
  <UnitInput scope={scope} label="Render start frame" value={value.startFrame} min={0} max={value.endFrame} precision={0} step={1} disabled={locked} unstyled={unstyled} onCommit={number=>set({startFrame:Math.round(number)})}/>
  <UnitInput scope={scope} label="Render end frame" value={value.endFrame} min={value.startFrame} max={value.startFrame+10000000} precision={0} step={1} disabled={locked} unstyled={unstyled} onCommit={number=>set({endFrame:Math.round(number)})}/>
  <UnitInput scope={scope} label="Render frame rate numerator" value={value.frameRate.numerator} min={1} max={120000} precision={0} step={1} disabled={locked} unstyled={unstyled} onCommit={number=>set({frameRate:{...value.frameRate,numerator:Math.round(number)}})}/>
  <UnitInput scope={scope} label="Render frame rate denominator" value={value.frameRate.denominator} min={1} max={100000} precision={0} step={1} disabled={locked} unstyled={unstyled} onCommit={number=>set({frameRate:{...value.frameRate,denominator:Math.round(number)}})}/>
  <Select label="Render alpha mode" value={value.alpha} options={[{value:'none',label:'Opaque'},{value:'straight',label:'Straight alpha',disabled:!format?.supportsAlpha},{value:'premultiplied',label:'Premultiplied alpha',disabled:!format?.supportsAlpha}]} disabled={locked} unstyled={unstyled} onValueChange={alpha=>set({alpha:alpha as MotionRenderSettings['alpha']})}/>
  <UnitInput scope={scope} label="Sequence frame padding" value={value.framePadding} min={1} max={12} precision={0} step={1} disabled={locked||format?.kind!=='image-sequence'} unstyled={unstyled} onCommit={number=>set({framePadding:Math.round(number)})}/>
  </ScrollView>:null}
  <Button title="Add composition to render queue" disabled={locked||!available||!compatible||!validName(value)} unstyled={unstyled} onPress={()=>{if(locked||!available||!compatible||!validName(value))return;void action.run('enqueue',signal=>onEnqueue({...value,frameRate:{...value.frameRate}},signal),()=>store.set({section:'queue'}));}}/>
  {local.section==='queue'?<FlatList data={jobs} keyExtractor={job=>job.id} style={{height}} initialNumToRender={8} windowSize={5} accessibilityLabel="Composition render queue" extraData={locked}
   ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No queued renders</Text>}
   renderItem={({item})=><View style={{padding:tokens.spacing.fixedElement,gap:tokens.spacing.off6}}>
    <Text {...{className:joinClasses(!unstyled&&'text-text')}}>{`${item.label}: ${item.status}`}</Text>
    <Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{item.progress?`${item.progress.completedFrames} of ${item.progress.totalFrames} frames reported`:'Frame progress not reported'}</Text>
    {item.error?<Text {...{className:joinClasses(!unstyled&&'text-danger')}}>{item.error}</Text>:null}{item.outputLabel?<Text selectable {...{className:joinClasses(!unstyled&&'text-text')}}>{item.outputLabel}</Text>:null}
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.off6}}>
     {item.status==='queued'?([-1,1] as const).map(direction=><Button key={direction} title={direction===-1?'Move earlier':'Move later'} accessibilityLabel={`${direction===-1?'Move earlier':'Move later'} ${item.label}`} disabled={locked||queued.indexOf(item.id)===(direction===-1?0:queued.length-1)} unstyled={unstyled} onPress={()=>{if(!locked)void action.run('reorder',signal=>onReorder(moveQueuedRenderJob(jobs,item.id,direction),signal));}}/>):null}
     {item.status==='queued'||item.status==='running'?<Button title={`Cancel ${item.label}`} disabled={locked} unstyled={unstyled} onPress={()=>{if(!locked)void action.run('cancel-job',signal=>onCancelJob(item.id,signal));}}/>:null}
     {item.status!=='running'?<Button title={`Remove ${item.label}`} disabled={locked} unstyled={unstyled} onPress={()=>{if(!locked)void action.run('remove-job',signal=>onRemoveJob(item.id,signal));}}/>:null}
    </View>
   </View>}/>:null}
  {action.pending!==null?<Button title="Cancel queue request" unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
function validName(value:MotionRenderSettings):boolean {try{validateMotionRenderSettings(value);return true;}catch{return false;}}
