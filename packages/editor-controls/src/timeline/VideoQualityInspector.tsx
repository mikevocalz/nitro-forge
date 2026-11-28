import {Text,View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {assertFrameRate,type FrameRate} from '../timebase.ts';
export interface VideoQualityInspectorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 media:{width:number;height:number;bitDepth:number;frameRate:FrameRate;codec:string;colorSpace:string;bitrate?:number};
 preview:{supported:boolean;reason?:string};profileId:string;
 profiles:readonly {id:string;label:string;unavailableReason?:string}[];warnings:readonly string[];
 onProfileChange:(id:string,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
export function VideoQualityInspector({scope='video-quality',revision=0,...props}:VideoQualityInspectorProps){
 const {media,preview,profileId,profiles,warnings,onProfileChange:_change,unstyled=false,disabledReason,style,...rest}=props;assertFrameRate(media.frameRate);
 if(![media.width,media.height,media.bitDepth].every(n=>Number.isSafeInteger(n)&&n>0)||media.bitDepth>64||media.bitrate!==undefined&&(!Number.isFinite(media.bitrate)||media.bitrate<=0)||!media.codec.trim()||!media.colorSpace.trim()||profiles.length>256||new Set(profiles.map(p=>p.id)).size!==profiles.length||warnings.length>128||warnings.some(w=>w.length>4096))throw new RangeError('Invalid video quality metadata');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason]),props,disabledReason!==undefined);
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Video quality">
  <Text {...{className:unstyled?undefined:'text-text'}}>{media.width} × {media.height}; {media.bitDepth}-bit; {media.codec}; {media.colorSpace}</Text>
  <Text {...{className:unstyled?undefined:'text-text'}}>{media.frameRate.numerator}/{media.frameRate.denominator} fps; bitrate: {media.bitrate===undefined?'Not reported':media.bitrate+' bit/s'}</Text>
  <Text {...{className:unstyled?undefined:'text-text'}}>Native preview: {preview.supported?'Supported':preview.reason??'Not supported by this host'}</Text>
  <Select label="Video export profile" value={profileId} options={profiles.map(p=>({value:p.id,label:p.label,disabled:p.unavailableReason!==undefined}))} disabled={disabledReason!==undefined||guard.pending} unstyled={unstyled}
   onValueChange={id=>guard.run('profile',(host,signal)=>host.profiles.some(p=>p.id===id&&p.unavailableReason===undefined)?host.onProfileChange(id,signal):undefined)}/>
  {profiles.filter(p=>p.unavailableReason).map(p=><Text key={p.id} {...{className:unstyled?undefined:'text-text'}}>{p.label}: {p.unavailableReason}</Text>)}
  {warnings.map((warning,index)=><Text key={index} {...{className:unstyled?undefined:'text-text'}}>{warning}</Text>)}<ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
 </View>;
}
