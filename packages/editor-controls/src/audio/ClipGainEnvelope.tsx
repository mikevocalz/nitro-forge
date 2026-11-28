import {AutomationLane,type AutomationLaneProps} from './AutomationLane.tsx';
/** Clip-local sample positions use ticks as integer sample offsets; host owns scheduling. */
export type ClipGainEnvelopeProps=Omit<AutomationLaneProps,'param'|'mode'|'lengthTicks'|'ppq'|'beatsPerBar'>&{lengthSamples:number;mode?:'off'|'read'};
export function ClipGainEnvelope({lengthSamples,mode='read',...props}:ClipGainEnvelopeProps){
 return <AutomationLane {...props} lengthTicks={lengthSamples} mode={mode} param="gain" ppq={1} beatsPerBar={4}/>;
}
