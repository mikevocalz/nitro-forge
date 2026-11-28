import {View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {validateMotionMatte,type MotionMatte} from './motion-settings.ts';
export type {MotionMatte} from './motion-settings.ts';
export interface MotionMatteSource {readonly id:string;readonly label:string;readonly unavailableReason?:string}
export interface MatteAndMaskPanelProps extends Omit<ViewProps,'children'> {
 readonly layerId:string;readonly value:MotionMatte;readonly sources:readonly MotionMatteSource[];readonly onCommit:(value:MotionMatte)=>void;
 readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** The host excludes descendants/cycles; self-matting and explicitly unavailable sources cannot be selected. */
export function MatteAndMaskPanel({layerId,value,sources,onCommit,disabled=false,unstyled=false,...props}:MatteAndMaskPanelProps){
 validateMotionMatte(value);const ids=new Set<string>();for(const source of sources){if(!source.id.trim()||!source.label.trim()||ids.has(source.id))throw new TypeError('Matte sources require unique identities and labels');ids.add(source.id);}
 if(!layerId.trim()||value.sourceId===layerId)throw new TypeError('A layer cannot matte itself');
 const options=[{value:'',label:'No matte source',disabled:false},...sources.map(source=>({value:source.id,label:source.unavailableReason?`${source.label} — ${source.unavailableReason}`:source.label,disabled:source.id===layerId||!!source.unavailableReason}))];
 if(value.sourceId!==null&&!ids.has(value.sourceId))options.push({value:value.sourceId,label:`Unavailable source: ${value.sourceId}`,disabled:true});
 const available=value.sourceId!==null&&sources.some(source=>source.id===value.sourceId&&!source.unavailableReason&&source.id!==layerId);
 const set=(change:Partial<MotionMatte>)=>{if(disabled)return;const next={...value,...change};validateMotionMatte(next);onCommit(next);};
 return <View {...props} style={[{gap:8},props.style]}>
  <Select label="Track matte source" value={value.sourceId??''} options={options} disabled={disabled} unstyled={unstyled} onValueChange={sourceId=>set({sourceId:sourceId||null,enabled:sourceId?value.enabled:false})}/>
  <Select label="Track matte mode" value={value.mode} options={[{value:'alpha',label:'Alpha'},{value:'alpha-inverted',label:'Inverted alpha'},{value:'luma',label:'Luma'},{value:'luma-inverted',label:'Inverted luma'}]} disabled={disabled} unstyled={unstyled} onValueChange={mode=>set({mode:mode as MotionMatte['mode']})}/>
  <SettingSwitch label="Enable track matte" on={value.enabled} onChange={enabled=>set({enabled})} disabled={disabled||!available} styled={!unstyled}/>
  <UnitInput label="Track matte feather pixels" value={value.feather} min={0} max={4096} step={1} disabled={disabled||!available} unstyled={unstyled} onCommit={feather=>set({feather})}/>
 </View>;
}
