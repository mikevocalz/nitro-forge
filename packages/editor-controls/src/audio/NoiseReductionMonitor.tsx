import {AudioProcessingPanel,type AudioProcessingPanelProps} from './AudioProcessingPanel.tsx';
export type NoiseReductionMonitorProps=Omit<AudioProcessingPanelProps,'label'|'parameters'|'onParameter'>&{
 reductionDb:number;sensitivity:number;onSettingsCommit:(value:{reductionDb:number;sensitivity:number},signal?:AbortSignal)=>unknown;
};
/** Original/cleaned audition with actual host measurements and reversible processing. */
export function NoiseReductionMonitor({reductionDb,sensitivity,onSettingsCommit,...props}:NoiseReductionMonitorProps){return <AudioProcessingPanel {...props} label="Noise reduction monitor" parameters={[{id:'reductionDb',label:'Noise attenuation',min:0,max:60,step:.5,unit:'dB',value:reductionDb},{id:'sensitivity',label:'Noise detection sensitivity',min:0,max:1,step:.01,value:sensitivity}]} onParameter={(id,value,signal)=>onSettingsCommit({reductionDb,sensitivity,[id]:value},signal)}/>;}
