import {Text,View} from 'react-native';
import {RenderQueuePanel,type RenderQueuePanelProps} from '../motion/RenderQueuePanel.tsx';
import {Select} from '@nyc-tron/ui/components/Select';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
export interface VideoExportOutput {width:number;height:number;codecId:string}
export interface VideoExportCodec {id:string;label:string;maxWidth:number;maxHeight:number;widthMultiple:number;heightMultiple:number;unavailableReason?:string}
export interface ExportMonitorProps extends Omit<RenderQueuePanelProps,'onEnqueue'> {
 revision?:string|number;output:VideoExportOutput;codecs:readonly VideoExportCodec[];onOutputChange:(output:VideoExportOutput)=>void;
 onEnqueue:(settings:RenderQueuePanelProps['value'],output:VideoExportOutput,signal:AbortSignal)=>void|Promise<void>;
}
/** Encoder-specific geometry wraps the shared preset/frame-rate/progress queue owner. */
export function ExportMonitor({revision=0,output,codecs,onOutputChange:_output,onEnqueue:_enqueue,...props}:ExportMonitorProps){
 if(![output.width,output.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=16384)||!output.codecId.trim()||codecs.length>256||new Set(codecs.map(c=>c.id)).size!==codecs.length||codecs.some(c=>!c.id.trim()||!c.label.trim()||![c.maxWidth,c.maxHeight,c.widthMultiple,c.heightMultiple].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=16384)))throw new RangeError('Invalid video encoder capabilities');
 const host={...props,output,codecs,onOutputChange:_output,onEnqueue:_enqueue},owner=JSON.stringify(controlIdentity(props.scope,revision)),guard=useScopedControl(owner,host,!!props.disabled);
 const reasonFor=(candidate:VideoExportOutput,choices:readonly VideoExportCodec[])=>{const codec=choices.find(c=>c.id===candidate.codecId);return !codec?'Encoder is not available':codec.unavailableReason??(candidate.width>codec.maxWidth||candidate.height>codec.maxHeight?'Resolution exceeds this encoder capability':candidate.width%codec.widthMultiple||candidate.height%codec.heightMultiple?`Encoder dimensions require multiples of ${codec.widthMultiple} × ${codec.heightMultiple}`:undefined);};
 const reason=reasonFor(output,codecs);
 const set=(patch:Partial<VideoExportOutput>)=>{const current=guard.current();if(current)current.onOutputChange({...current.output,...patch});};
 return <View style={{gap:8,minWidth:0}} accessibilityLabel="Video export monitor">
  <Select label="Video codec" value={output.codecId} options={codecs.map(c=>({value:c.id,label:c.label,disabled:c.unavailableReason!==undefined}))} disabled={props.disabled} unstyled={props.unstyled} onValueChange={codecId=>set({codecId})}/>
  {(['width','height'] as const).map(key=><PrecisionScrubber key={key} scope={props.scope} revision={revision} label={'Export '+key+' pixels'} value={output[key]} min={1} max={16384} step={1} disabled={props.disabled} unstyled={props.unstyled} onCommit={n=>set({[key]:Math.round(n)})}/>)}
  {reason?<Text {...{className:props.unstyled?undefined:'text-text'}}>{reason}</Text>:null}
  <RenderQueuePanel key={owner} {...props} onEnqueue={(settings,signal)=>{const current=guard.current();if(!current)return;const problem=reasonFor(current.output,current.codecs);if(problem)throw new Error(problem);return current.onEnqueue(settings,{...current.output},signal);}}/>
 </View>;
}
