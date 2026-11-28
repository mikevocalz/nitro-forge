import { Host,Slider } from "@expo/ui";
import { Text,View,type ViewProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { alphaPercent,assertRgba,rgbaToHex,type RgbaColor } from "./color.ts";
export interface ColorChannelsProps extends Omit<ViewProps,"children"> {
 readonly value:RgbaColor;
 readonly onValueChange:(value:RgbaColor)=>void;
 readonly showAlpha?:boolean;
 readonly disabled?:boolean;
 className?:string;
 unstyled?:boolean;
 previewClassName?:string;
 /** Classes for the hex and channel labels. @default "text-text-muted" unless `unstyled` */
 labelClassName?:string;
}
/**
 * Controlled native RGBA sliders, SDK 58-only optional `@expo/ui` backend.
 * ICC/CMYK/HDR color science stays in the owning Forge engine.
 */
export function ColorChannels({
 value,onValueChange,showAlpha=true,disabled=false,
 className,unstyled=false,previewClassName,labelClassName,style,...props
}:ColorChannelsProps){
 assertRgba(value);
 const hex=rgbaToHex(value);
 // Labels are app-token RN Text: @expo/ui Text follows the OS appearance,
 // not the app theme, and turned black on a dark app surface in light mode.
 const muted=labelClassName??joinClasses(!unstyled&&"text-text-muted");
 const channel=(label:string,v:number,max:number,step:number,on:(n:number)=>void)=>
   <View style={{gap:4}}>
     <Text {...{className:muted}} style={{fontVariant:["tabular-nums"]}}>{label}</Text>
     <Host style={{width:"100%"}}>
       <Slider value={v} min={0} max={max} step={step} disabled={disabled} onValueChange={on}/>
     </Host>
   </View>;
 const update=(key:"r"|"g"|"b",v:number)=>{
   if(!disabled)onValueChange({...value,[key]:Math.round(Math.max(0,Math.min(255,v)))});
 };
 return <View {...props}
   {...{className:joinClasses("w-full gap-2",!unstyled&&"rounded-control bg-surface-raised p-3",className)}}
   style={style}>
     <View
       accessible
       accessibilityRole="image"
       accessibilityLabel={`Selected color ${hex}`}
       {...{className:joinClasses("h-8 w-full rounded-control",previewClassName)}}
       style={{backgroundColor:hex}}/>
     <Text selectable {...{className:muted}} style={{fontVariant:["tabular-nums"]}}>{hex}</Text>
     {channel(`Red ${value.r}`,value.r,255,1,n=>update("r",n))}
     {channel(`Green ${value.g}`,value.g,255,1,n=>update("g",n))}
     {channel(`Blue ${value.b}`,value.b,255,1,n=>update("b",n))}
     {showAlpha?channel(`Opacity ${alphaPercent(value.alpha)}%`,value.alpha,1,0.01,
       n=>{if(!disabled)onValueChange({...value,alpha:Math.max(0,Math.min(1,n))});}):null}
 </View>;
}
