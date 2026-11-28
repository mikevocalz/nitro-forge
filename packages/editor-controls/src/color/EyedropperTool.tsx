import {useRef} from "react";
import {Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {UnitInput} from "@nyc-tron/ui/components/shell/UnitInput";
import {Select} from "@nyc-tron/ui/components/Select";
import {Button} from "@nyc-tron/ui/components/Button";
import {ErrorMessage} from "@nyc-tron/ui/components/feedback/ErrorMessage";
import {useOwnedAction} from "@nyc-tron/ui/components/shell/useOwnedAction";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {assertRgba,rgbaToHex,type RgbaColor} from "../color.ts";
/** Exact document/revision/pixel selection sent to the host's document sampler. */
export interface EyedropperRequest {readonly documentId:string;readonly revision:string;readonly sourceId:string;readonly x:number;readonly y:number;readonly radius:number}
/** Profile-preserving sampled channels plus a separate display-only sRGB preview. */
export interface SampledColor {readonly profileId:string;readonly channels:readonly number[];readonly alpha:number;readonly preview:RgbaColor}
/** Controlled pixel selection, sampling source and provider contract for EyedropperTool. */
export interface EyedropperToolProps extends Omit<ViewProps,'children'>{
 readonly request:EyedropperRequest;
 readonly documentWidth:number;readonly documentHeight:number;
 readonly sources:readonly {readonly id:string;readonly label:string}[];
 readonly onRequestChange:(request:EyedropperRequest)=>void;
 /** Samples document pixels, never an OS screen screenshot. */
 readonly onSample:(request:EyedropperRequest,signal:AbortSignal)=>SampledColor|Promise<SampledColor>;
 /** Applies the exact sampled profile/channels; the host rejects stale document revisions. */
 readonly onApply:(sample:SampledColor,request:EyedropperRequest,signal:AbortSignal)=>void|Promise<void>;
 readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Validates a sampled color without silently converting/clipping it to the display preview. */
export function validateSampledColor(sample:SampledColor):void{
 if(!sample.profileId||sample.channels.length<1||sample.channels.length>16||sample.channels.some(n=>!Number.isFinite(n)))throw new TypeError('Sample requires a profile and 1..16 finite channels');
 if(!Number.isFinite(sample.alpha)||sample.alpha<0||sample.alpha>1)throw new RangeError('Sample alpha must be 0..1');assertRgba(sample.preview);
}
/** Document-space eyedropper with bounded sampling, explicit apply, cancellation and stale-result suppression. */
export function EyedropperTool({request,documentWidth,documentHeight,sources,onRequestChange,onSample,onApply,disabled=false,unstyled=false,...props}:EyedropperToolProps){
 if(![documentWidth,documentHeight].every(n=>Number.isSafeInteger(n)&&n>0)||!request.documentId||!request.revision)throw new TypeError('Eyedropper requires document identity, revision and positive pixel dimensions');
 if(![request.x,request.y,request.radius].every(Number.isSafeInteger)||request.x<0||request.x>=documentWidth||request.y<0||request.y>=documentHeight||request.radius<0||request.radius>128)throw new RangeError('Invalid document sampling point or radius');
 if(sources.length>1000||sources.some(s=>!s.id||!s.label)||new Set(sources.map(s=>s.id)).size!==sources.length||!sources.some(s=>s.id===request.sourceId))throw new TypeError('Choose a distinct, available document sampling source');
 const scope=JSON.stringify([request,documentWidth,documentHeight,disabled]),action=useOwnedAction(scope);
 const local=useRef<StoreApi<{sample:SampledColor|null;scope:string}>|null>(null);local.current??=createStore(()=>({sample:null as SampledColor|null,scope:''}));const store=local.current,state=useStore(store,s=>s),sample=state.scope===scope?state.sample:null,pending=action.pending!==null,locked=disabled||pending;
 const set=(change:Partial<EyedropperRequest>)=>{if(!locked)onRequestChange({...request,...change});};
 return <View {...props} style={[{gap:8},props.style]}>
  <Select label="Document sampling source" value={request.sourceId} options={sources.map(s=>({value:s.id,label:s.label}))} onValueChange={sourceId=>set({sourceId})} disabled={locked} unstyled={unstyled}/>
  <UnitInput label="Sample pixel X" value={request.x} min={0} max={documentWidth-1} step={1} precision={0} disabled={locked} unstyled={unstyled} onCommit={x=>set({x:Math.round(x)})}/>
  <UnitInput label="Sample pixel Y" value={request.y} min={0} max={documentHeight-1} step={1} precision={0} disabled={locked} unstyled={unstyled} onCommit={y=>set({y:Math.round(y)})}/>
  <UnitInput label="Sample radius pixels" value={request.radius} min={0} max={128} step={1} precision={0} disabled={locked} unstyled={unstyled} onCommit={radius=>set({radius:Math.round(radius)})}/>
  <Button title="Sample document color" disabled={locked} unstyled={unstyled} onPress={()=>{if(locked)return;store.setState({sample:null,scope:''});void action.run('sample',async signal=>{const result=await onSample(request,signal);validateSampledColor(result);return result;},sample=>store.setState({sample,scope}));}}/>
  <Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text')}}>{sample?`${sample.profileId}: ${sample.channels.join(', ')}; alpha ${sample.alpha}; display preview ${rgbaToHex(sample.preview,true)}`:'No color sampled for this document selection'}</Text>
  <Button title="Apply sampled color" disabled={locked||!sample} unstyled={unstyled} onPress={()=>{if(!locked&&sample)void action.run('apply',signal=>onApply(sample,request,signal));}}/>
  {pending?<Button title="Cancel color sampling request" unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
