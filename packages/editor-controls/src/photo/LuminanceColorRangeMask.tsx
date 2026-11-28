import {useRef,type ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import type {ProfileColor} from '../color/color-management.ts';
import {validatePhotoRange,validatePhotoImageSize,type PhotoRangeMask,type PhotoImageSize,type PhotoMaskCombine} from './photo-masks.ts';
import { tokens } from '../tokens.ts';
export type {PhotoRangeMask} from './photo-masks.ts';
export interface PhotoRangeSampleRequest {readonly photoId:string;readonly expectedRevision:string;readonly x:number;readonly y:number}
export interface LuminanceColorRangeMaskProps extends Omit<ViewProps,'children'> {
 readonly photoId:string;readonly revision:string;readonly imageSize:PhotoImageSize;readonly value:PhotoRangeMask;
 readonly onChange:(mask:PhotoRangeMask)=>void;
 readonly onSample:(request:PhotoRangeSampleRequest,signal:AbortSignal)=>{readonly luminance:number;readonly color:ProfileColor}|Promise<{readonly luminance:number;readonly color:ProfileColor}>;
 readonly children?:ReactNode;readonly disabled?:boolean;readonly unstyled?:boolean;
}
const makeStore=()=>createStore(()=>({x:0,y:0}));
/** Document-only sampling: profile-bearing color is retained, never inferred from an OS screenshot. */
export function LuminanceColorRangeMask({photoId,revision,imageSize,value,onChange,onSample,children,disabled=false,unstyled=false,...props}:LuminanceColorRangeMaskProps){
 validatePhotoRange(value);validatePhotoImageSize(imageSize);if(!photoId.trim())throw new TypeError('Range sampling requires a photo identity');
 const action=useOwnedAction(JSON.stringify([photoId,revision])),locked=disabled||action.pending!==null;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,point=useStore(store,s=>s);
 const set=(change:Partial<PhotoRangeMask>)=>{if(locked)return;const next={...value,...change};validatePhotoRange(next);onChange(next);};
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <Select label="Photo range mask kind" value={value.mode} options={[{value:'luminance',label:'Luminance range'},{value:'color',label:'Color range'}]} disabled={locked} unstyled={unstyled} onValueChange={mode=>set({mode:mode as PhotoRangeMask['mode']})}/>
  <UnitInput label="Normalized mask luminance minimum" value={value.minimum} min={0} max={value.maximum} step={.01} disabled={locked||value.mode!=='luminance'} unstyled={unstyled} onCommit={minimum=>set({minimum})}/>
  <UnitInput label="Normalized mask luminance maximum" value={value.maximum} min={value.minimum} max={1} step={.01} disabled={locked||value.mode!=='luminance'} unstyled={unstyled} onCommit={maximum=>set({maximum})}/>
  <UnitInput label="Color range tolerance" value={value.tolerance} min={0} max={1} step={.01} disabled={locked||value.mode!=='color'} unstyled={unstyled} onCommit={tolerance=>set({tolerance})}/>
  <UnitInput label="Photo range softness" value={value.softness} min={0} max={1} step={.01} disabled={locked} unstyled={unstyled} onCommit={softness=>set({softness})}/>
  <Select label="Photo range combination" value={value.combine} options={['replace','add','subtract','intersect'].map(value=>({value,label:value}))} disabled={locked} unstyled={unstyled} onValueChange={combine=>set({combine:combine as PhotoMaskCombine})}/>
  <SettingSwitch label="Invert photo range mask" on={value.invert} onChange={invert=>set({invert})} disabled={locked} styled={!unstyled}/>
  <UnitInput label="Range sample image x" value={Math.min(point.x,imageSize.width-1)} min={0} max={imageSize.width-1} step={1} precision={0} disabled={locked} unstyled={unstyled} onCommit={x=>store.setState({x:Math.round(x)})}/>
  <UnitInput label="Range sample image y" value={Math.min(point.y,imageSize.height-1)} min={0} max={imageSize.height-1} step={1} precision={0} disabled={locked} unstyled={unstyled} onCommit={y=>store.setState({y:Math.round(y)})}/>
  <Button title="Sample photo range" disabled={locked} unstyled={unstyled} onPress={()=>{if(locked)return;const request={photoId,expectedRevision:revision,x:Math.min(point.x,imageSize.width-1),y:Math.min(point.y,imageSize.height-1)};void action.run('sample',async signal=>{const sample=await onSample(request,signal);if(!Number.isFinite(sample.luminance)||sample.luminance<0||sample.luminance>1)throw new RangeError('Sampler must report normalized luminance');const next={...value,color:sample.color,...(value.mode==='luminance'?{minimum:Math.max(0,sample.luminance-.05),maximum:Math.min(1,sample.luminance+.05)}:{})};validatePhotoRange(next);return next;},onChange);}}/>
  <Text {...{className:joinClasses(!unstyled&&'text-text')}}>{value.color?`${value.color.profileId}: ${value.color.channels.join(', ')}; alpha ${value.color.alpha}`:'No document color sample'}</Text>
  {children}
  {action.pending!==null?<Button title="Cancel range sample" unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
