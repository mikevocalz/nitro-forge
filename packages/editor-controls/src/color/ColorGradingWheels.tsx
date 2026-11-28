import { Text, View, type ViewProps } from "react-native";
import { SegmentedControl } from "@nyc-tron/ui/components/SegmentedControl";
import { SliderField } from "@nyc-tron/ui/components/shell/SliderField";
import { ColorDiscPicker } from "./ColorDiscPicker.tsx";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { validateGrade,type ColorGrade } from "./color-adjustments.ts";
import { tokens } from "../tokens.ts";
export type { ColorGrade } from "./color-adjustments.ts";
/** Three controlled grading ranges with preview and transaction boundaries. */
export interface ColorGradingWheelsProps extends Omit<ViewProps,"children"> {
 readonly value:ColorGrade; readonly onCommit:(value:ColorGrade)=>void;
 readonly onPreview?:(value:ColorGrade|undefined)=>void;
 readonly disabled?:boolean; readonly unstyled?:boolean;
}
/** Tonal hue/saturation wheels and explicit exposure, balance and blending controls. */
export function ColorGradingWheels({value,onCommit,onPreview,disabled=false,unstyled=false,...props}:ColorGradingWheelsProps){
 validateGrade(value);
 const lgg=value.model==='lift-gamma-gain';
 const levels=value.liftGammaGain??{lift:0,gamma:1,gain:1};
 return <View {...props} style={[{gap:tokens.spacing.fixedInset},props.style]}>
 <SegmentedControl aria-label="Grading model" value={value.model??'tonal'} options={[{value:'tonal',label:'Shadows / midtones / highlights'},{value:'lift-gamma-gain',label:'Lift / gamma / gain'}]} disabled={disabled} unstyled={unstyled} onChange={model=>{if(!disabled)onCommit({...value,model,...(model==='lift-gamma-gain'?{liftGammaGain:levels}:{})});}}/>
 {(['shadows','midtones','highlights'] as const).map(key=><View key={key} style={{gap:tokens.spacing.fixedElement}}>
   <Text accessibilityRole="header" {...{className:joinClasses(!unstyled&&"text-text font-semibold")}}>{lgg?({shadows:'Lift',midtones:'Gamma',highlights:'Gain'} as const)[key]:key}</Text>
   <ColorDiscPicker value={{h:value[key].hue,s:value[key].saturation,v:1,alpha:1}} maxSize={180} showBrightness={false} disabled={disabled} unstyled={unstyled}
    onPreview={color=>onPreview?.(color.h===value[key].hue&&color.s===value[key].saturation?undefined:{...value,[key]:{...value[key],hue:color.h,saturation:color.s}})} onCommit={color=>{onPreview?.(undefined);if(!disabled)onCommit({...value,[key]:{...value[key],hue:color.h,saturation:color.s}});}}/>
   {!lgg?<SliderField label={`${key} exposure EV`} value={value[key].exposureEv} min={-10} max={10} step={.01} disabled={disabled} unstyled={unstyled} onPreview={number=>onPreview?.(number===value[key].exposureEv?undefined:{...value,[key]:{...value[key],exposureEv:number}})} onCommit={number=>{onPreview?.(undefined);if(!disabled)onCommit({...value,[key]:{...value[key],exposureEv:number}});}}/>:<SliderField label={`${({shadows:'Lift',midtones:'Gamma',highlights:'Gain'} as const)[key]} level`} value={levels[({shadows:'lift',midtones:'gamma',highlights:'gain'} as const)[key]]} min={key==='shadows'?-1:key==='midtones'?.1:0} max={key==='shadows'?1:key==='midtones'?10:8} step={.01} disabled={disabled} unstyled={unstyled} onCommit={number=>{if(!disabled)onCommit({...value,liftGammaGain:{...levels,[({shadows:'lift',midtones:'gamma',highlights:'gain'} as const)[key]]:number}});}}/>}
 </View>)}<SliderField label="Tonal balance" value={value.balance} min={-1} max={1} step={.01} disabled={disabled} unstyled={unstyled} onCommit={balance=>{if(!disabled)onCommit({...value,balance});}}/>
 <SliderField label="Grading blend" value={value.blend} min={0} max={1} step={.01} disabled={disabled} unstyled={unstyled} onCommit={blend=>{if(!disabled)onCommit({...value,blend});}}/>
 </View>;
}
