import type {ReactNode} from "react";
import {Pressable,Text,View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";

/**
 * Internal 44pt button shared by the layer panels. A control that cannot run
 * passes `reason`: it stays focusable and pressable (doing nothing), its name
 * ends in ", unavailable" and the reason is its hint, so a screen reader hears
 * why. Callers also print the reason next to the control (see {@linkcode Reason}).
 *
 * React Native Web's Pressable overwrites aria-disabled with its own `disabled`
 * prop, which would make the control unfocusable, so `disabled` is not used.
 */
export function PanelButton({label,onPress,reason,role="button",checked,tone="secondary",styled,icon,grow=false,testID}:{
  label:string;onPress:()=>void;reason?:string|undefined;role?:"button"|"switch";checked?:boolean;
  tone?:"primary"|"secondary"|"quiet";styled:boolean;icon?:ReactNode;grow?:boolean;testID?:string;
}){
  const off=reason!==undefined;
  const on=checked===true;
  const fill=tone==="primary"&&!off?"bg-primary border-primary":tone==="quiet"?"bg-transparent border-transparent":"bg-surface-raised border-border";
  const ink=tone==="primary"&&!off?"text-on-primary":"text-text";
  return <Pressable role={role} aria-label={off?label+", unavailable":label}
    aria-checked={role==="switch"?on:undefined} accessibilityState={{disabled:off,...(role==="switch"?{checked:on}:{})}}
    accessibilityHint={reason} testID={testID}
    onPress={()=>{if(!off)onPress();}}
    {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",styled&&fill)}}
    style={{minHeight:44,minWidth:44,paddingHorizontal:12,flexDirection:"row",alignItems:"center",justifyContent:"center",
      gap:8,opacity:off?0.45:1,...(grow?{flexGrow:1}:null)}}>
    {icon??null}
    <Text numberOfLines={1} {...{className:joinClasses(styled&&ink,styled&&"text-sm font-medium")}}>{label}</Text>
    {role==="switch"?<View pointerEvents="none"
      {...{className:joinClasses(styled&&(on?"bg-primary border-primary":"bg-surface-sunken border-border"))}}
      style={{width:30,height:18,borderRadius:9,borderWidth:1,justifyContent:"center",paddingHorizontal:2,
        alignItems:on?"flex-end":"flex-start"}}>
      <View {...{className:joinClasses(styled&&(on?"bg-on-primary":"bg-text-muted"))}} style={{width:12,height:12,borderRadius:6}}/>
    </View>:null}
  </Pressable>;
}

/** Visible reason line under a group of controls; renders nothing without a reason. */
export function Reason({text,styled}:{text:string|undefined;styled:boolean}){
  if(!text)return null;
  return <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{lineHeight:16}}>{text}</Text>;
}
