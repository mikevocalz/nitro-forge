import {Text,View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {useLocalStore} from '@nyc-tron/ui/components/useLocalStore';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {MotionVectorFields} from './MotionVectorFields.tsx';
import {validateMotionCamera,validateMotionLight,type MotionCamera,type MotionLight} from './motion-settings.ts';
import { tokens } from '../tokens.ts';
export type {MotionCamera,MotionLight} from './motion-settings.ts';
export interface CameraAndLightControlsProps extends Omit<ViewProps,'children'> {readonly camera:MotionCamera;readonly light:MotionLight;readonly onCameraCommit:(value:MotionCamera)=>void;readonly onLightCommit:(value:MotionLight)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Lens/view/depth and lighting values, independent from native app window dimensions. */
export function CameraAndLightControls({camera,light,onCameraCommit,onLightCommit,disabled=false,unstyled=false,...props}:CameraAndLightControlsProps){
 validateMotionCamera(camera);validateMotionLight(light);
 const [local,store]=useLocalStore(()=>({error:null as string|null}));
 const setCamera=(change:Partial<MotionCamera>)=>{if(disabled)return;const next={...camera,...change};try{validateMotionCamera(next);}catch(error){store.set({error:error instanceof Error?error.message:'Invalid camera target'});return;}store.set({error:null});onCameraCommit(next);};
 const setLight=(change:Partial<MotionLight>)=>{if(disabled)return;const next={...light,...change};validateMotionLight(next);onLightCommit(next);};
 return <View {...props} style={[{gap:tokens.spacing.off10},props.style]}>
  <ErrorMessage {...(local.error?{message:local.error}:{})} unstyled={unstyled}/>
  <Select label="Camera projection" value={camera.projection} options={[{value:'perspective',label:'Perspective'},{value:'orthographic',label:'Orthographic'}]} disabled={disabled} unstyled={unstyled} onValueChange={projection=>setCamera({projection:projection as MotionCamera['projection']})}/>
  <MotionVectorFields label="Camera position" value={camera.position} disabled={disabled} unstyled={unstyled} onCommit={position=>setCamera({position})}/>
  <MotionVectorFields label="Camera target" value={camera.target} disabled={disabled} unstyled={unstyled} onCommit={target=>setCamera({target})}/>
  {([['focalLengthMm','Camera focal length mm',.1,100000],['sensorWidthMm','Camera sensor width mm',.1,100000],['near','Camera near clip',.000001,camera.far-.000001],['far','Camera far clip',camera.near+.000001,1e12],['orthographicSize','Orthographic view size',.000001,1e9],['focusDistance','Camera focus distance',.000001,1e12],['aperture','Camera aperture',.1,128]] as const).map(([key,label,min,max])=><UnitInput key={key} label={label} value={camera[key]} min={min} max={max} step={.1} precision={6} disabled={disabled||(key==='orthographicSize'?camera.projection!=='orthographic':key==='focalLengthMm'||key==='sensorWidthMm'?camera.projection!=='perspective':key==='focusDistance'||key==='aperture'?!camera.depthOfField:false)} unstyled={unstyled} onCommit={number=>setCamera({[key]:number})}/>)}
  <SettingSwitch label="Camera depth of field" on={camera.depthOfField} onChange={depthOfField=>setCamera({depthOfField})} disabled={disabled} styled={!unstyled}/>
  <Select label="Motion light type" value={light.type} options={['point','spot','directional','ambient'].map(value=>({value,label:value}))} disabled={disabled} unstyled={unstyled} onValueChange={type=>setLight({type:type as MotionLight['type']})}/>
  <MotionVectorFields label="Light position" value={light.position} disabled={disabled||light.type==='ambient'} unstyled={unstyled} onCommit={position=>setLight({position})}/>
  <MotionVectorFields label="Light rotation" value={light.rotation} min={-360000} max={360000} disabled={disabled||light.type==='ambient'||light.type==='point'} unstyled={unstyled} onCommit={rotation=>setLight({rotation})}/>
  <UnitInput label="Light intensity" value={light.intensity} min={0} max={1e6} disabled={disabled} unstyled={unstyled} onCommit={intensity=>setLight({intensity})}/>
  <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{`Light working profile: ${light.colorProfileId}`}</Text>
  {(['red','green','blue'] as const).map((channel,index)=><UnitInput key={channel} label={`Linear light ${channel}`} value={light.color[index]!} min={0} max={16} step={.01} disabled={disabled} unstyled={unstyled} onCommit={number=>{const color=[...light.color] as [number,number,number];color[index]=number;setLight({color});}}/>)}
  <UnitInput label="Spot light cone degrees" value={light.coneDegrees} min={.1} max={179.9} disabled={disabled||light.type!=='spot'} unstyled={unstyled} onCommit={coneDegrees=>setLight({coneDegrees})}/>
  <SettingSwitch label="Light casts shadows" on={light.castsShadows} onChange={castsShadows=>setLight({castsShadows})} disabled={disabled||light.type==='ambient'} styled={!unstyled}/>
 </View>;
}
