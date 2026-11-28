import {AudioProcessingPanel,type AudioProcessingPanelProps} from './AudioProcessingPanel.tsx';
import {ClipGainEnvelope,type ClipGainEnvelopeProps} from './ClipGainEnvelope.tsx';
export interface DuckSettings {sensitivity:number;depthDb:number;attackMs:number;releaseMs:number}
export type AutoDuckEnvelopePanelProps=Omit<AudioProcessingPanelProps,'label'|'parameters'|'onParameter'|'preview'>&{
 settings:DuckSettings;onSettingsCommit:(settings:DuckSettings,signal?:AbortSignal)=>unknown;
 envelope:ClipGainEnvelopeProps;
};
/** Host-generated ducking against dialogue, with an editable sample-local gain envelope. */
export function AutoDuckEnvelopePanel({settings,onSettingsCommit,envelope,...props}:AutoDuckEnvelopePanelProps){
 return <AudioProcessingPanel {...props} label="Dialogue auto ducking" parameters={[
 {id:'sensitivity',label:'Dialogue detection sensitivity',min:0,max:1,step:.01,value:settings.sensitivity},
 {id:'depthDb',label:'Music attenuation',min:0,max:60,step:.5,unit:'dB',value:settings.depthDb},
 {id:'attackMs',label:'Duck attack',min:1,max:5000,step:1,unit:'ms',value:settings.attackMs},
 {id:'releaseMs',label:'Duck release',min:1,max:10000,step:1,unit:'ms',value:settings.releaseMs}
 ]} onParameter={(id,value,signal)=>onSettingsCommit({...settings,[id]:value},signal)} preview={<ClipGainEnvelope {...envelope} scope={props.scope??'auto-duck-envelope'} revision={props.revision??0} disabled={envelope.disabled||props.job.status==='processing'||props.disabledReason!==undefined||!props.capability.available} unstyled={props.unstyled}/>}/>;
}
