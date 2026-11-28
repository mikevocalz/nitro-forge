import {AudioProcessingPanel,type AudioProcessingPanelProps} from './AudioProcessingPanel.tsx';
export type VoiceIsolationPanelProps=Omit<AudioProcessingPanelProps,'label'|'parameters'|'onParameter'>&{
 strength:number;onStrengthCommit:(strength:number,signal?:AbortSignal)=>unknown;
};
/** Requests the host's admitted speech separation service and reversible output. */
export function VoiceIsolationPanel({strength,onStrengthCommit,...props}:VoiceIsolationPanelProps){return <AudioProcessingPanel {...props} label="Voice isolation" parameters={[{id:'strength',label:'Speech separation strength',min:0,max:1,step:.01,value:strength}]} onParameter={(_id,value,signal)=>onStrengthCommit(value,signal)}/>;}
