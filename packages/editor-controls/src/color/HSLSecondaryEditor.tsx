import { Text, View, type ViewProps } from "react-native";
import { UnitInput } from "@nyc-tron/ui/components/shell/UnitInput";
import { SettingSwitch } from "@nyc-tron/ui/components/forms/SettingSwitch";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { validateHSLSecondary,type HSLSecondary } from "./color-adjustments.ts";
export type { HSLSecondary } from "./color-adjustments.ts";
/** Host-owned secondary selection and correction values. */
export interface HSLSecondaryEditorProps extends Omit<ViewProps,"children"> {readonly value:HSLSecondary;readonly onCommit:(value:HSLSecondary)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Edits wrapping hue selection, saturation/luma bounds, mask refinement and corrections. */
export function HSLSecondaryEditor({value,onCommit,disabled=false,unstyled=false,...props}:HSLSecondaryEditorProps){
 validateHSLSecondary(value);
 const set=(change:Partial<HSLSecondary>)=>{if(disabled)return;const next={...value,...change};validateHSLSecondary(next);onCommit(next);};
 const fields=[['hueStart','Hue start degrees',0,360],['hueEnd','Hue end degrees',0,360],['hueFeather','Hue feather degrees',0,180],['saturationMin','Saturation minimum',0,value.saturationMax],['saturationMax','Saturation maximum',value.saturationMin,1],['luminanceMin','Luminance minimum',0,value.luminanceMax],['luminanceMax','Luminance maximum',value.luminanceMin,1],['softness','Mask softness',0,1],['denoise','Mask denoise',0,1],['hueShift','Hue shift degrees',-180,180],['saturationShift','Saturation correction',-1,1],['luminanceShift','Luminance correction',-1,1]] as const;
 return <View {...props} style={[{gap:8},props.style]}>
  <SettingSwitch label="Enable HSL secondary" on={value.enabled} onChange={enabled=>set({enabled})} disabled={disabled} styled={!unstyled}/>
  <Text {...{className:joinClasses(!unstyled&&"text-text-muted")}}>Hue start above end selects across zero degrees.</Text>
  {fields.map(([key,label,min,max])=><UnitInput key={key} label={label} value={value[key]} min={min} max={max} step={key.startsWith('hue')?1:.01} precision={4} disabled={disabled} unstyled={unstyled} onCommit={number=>set({[key]:number})}/>)}
  <SettingSwitch label="Show secondary mask" on={value.showMask} onChange={showMask=>set({showMask})} disabled={disabled} styled={!unstyled}/>
  <SettingSwitch label="Invert secondary mask" on={value.invert} onChange={invert=>set({invert})} disabled={disabled} styled={!unstyled}/>
 </View>;
}
