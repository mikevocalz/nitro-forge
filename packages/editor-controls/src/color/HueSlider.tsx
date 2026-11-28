import {View,type ViewProps} from "react-native";
import {ChannelTrack} from "./ChannelTrack.tsx";
import {UnitInput} from "@nyc-tron/ui/components/shell/UnitInput";
import {assertHsv,hsvToRgb,rgbaToHex,wrapHue,type HsvColor} from "../color.ts";
/** Standalone hue control retaining saturation, brightness and alpha. */
export interface HueSliderProps extends Omit<ViewProps,'children'> {readonly value:HsvColor;readonly onPreview?:(value:HsvColor)=>void;readonly onCommit:(value:HsvColor)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Hue gradient, keyboard/screen-reader adjustment and exact degree entry. */
export function HueSlider({value,onPreview,onCommit,disabled=false,unstyled=false,...props}:HueSliderProps){
 assertHsv(value);const change=(h:number)=>{if(!disabled&&wrapHue(h)!==wrapHue(value.h))onCommit({...value,h:wrapHue(h)});};
 return <View {...props} style={[{gap:8},props.style]}>
  <ChannelTrack label="Color hue" value={wrapHue(value.h)/360} stops={Array.from({length:7},(_,i)=>hsvToRgb({h:i*60,s:1,v:1,alpha:1}))} valueText={n=>`${Math.round(n*360)} degrees`} thumbColor={n=>rgbaToHex(hsvToRgb({h:n*360,s:1,v:1,alpha:1}),false)} step={1/360} pageStep={15/360} disabled={disabled} unstyled={unstyled} onPreview={n=>onPreview?.({...value,h:wrapHue(n*360)})} onCommit={n=>change(n*360)}/>
  <UnitInput label="Hue degrees" value={wrapHue(value.h)} min={0} max={360} step={1} precision={3} disabled={disabled} unstyled={unstyled} onCommit={change}/>
 </View>;
}
