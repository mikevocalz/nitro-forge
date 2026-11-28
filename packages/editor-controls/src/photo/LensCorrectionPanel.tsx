import {View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {validateLens,type LensSettings} from './photo-adjustments.ts';
import { tokens } from '../tokens.ts';
export type {LensSettings} from './photo-adjustments.ts';
export interface LensProfile {readonly id:string;readonly label:string}
export interface LensCorrectionPanelProps extends Omit<ViewProps,'children'> {readonly value:LensSettings;readonly profiles:readonly LensProfile[];readonly onCommit:(value:LensSettings)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Host-supplied calibrated profile identity and manual distortion/CA intent. */
export function LensCorrectionPanel({value,profiles,onCommit,disabled=false,unstyled=false,...props}:LensCorrectionPanelProps){
 validateLens(value);
 const ids=new Set<string>();for(const p of profiles){if(!p.id.trim()||!p.label.trim()||ids.has(p.id))throw new TypeError('Lens profiles require unique nonempty identities and labels');ids.add(p.id);}
 const set=(change:Partial<LensSettings>)=>{if(disabled)return;const next={...value,...change};validateLens(next);onCommit(next);};
 const options=[{value:'',label:'Manual correction'},...profiles.map(p=>({value:p.id,label:p.label}))];
 if(value.profileId!==null&&!ids.has(value.profileId))options.push({value:value.profileId,label:`Unavailable profile: ${value.profileId}`});
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <SettingSwitch label="Enable lens corrections" on={value.enabled} onChange={enabled=>set({enabled})} disabled={disabled} styled={!unstyled}/>
  <Select label="Lens correction profile" value={value.profileId??''} options={options} disabled={disabled||!value.enabled} unstyled={unstyled} onValueChange={id=>set({profileId:id||null})}/>
  <UnitInput label="Lens distortion" value={value.distortion} min={-100} max={100} step={1} disabled={disabled||!value.enabled} unstyled={unstyled} onCommit={distortion=>{if(distortion!==value.distortion)set({distortion});}}/>
  <SettingSwitch label="Remove chromatic aberration" on={value.chromaticAberration} onChange={chromaticAberration=>set({chromaticAberration})} disabled={disabled||!value.enabled} styled={!unstyled}/>
 </View>;
}
