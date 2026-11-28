import {forgeRadius} from "../radius.ts";
import type {ReactNode} from "react";
import {Pressable,Text,View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import { tokens } from "../tokens.ts";

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
    style={{minHeight:tokens.spacing.fixedTarget,minWidth:tokens.spacing.fixedTarget,paddingHorizontal:tokens.spacing.fixedInset,flexDirection:"row",alignItems:"center",justifyContent:"center",
      gap:tokens.spacing.fixedElement,opacity:off?tokens.opacity.disabled:1,...(grow?{flexGrow:1}:null)}}>
    {icon??null}
    <Text numberOfLines={1} {...{className:joinClasses(styled&&ink,styled&&"text-sm font-medium")}}>{label}</Text>
    {role==="switch"?<View pointerEvents="none"
      {...{className:joinClasses(styled&&(on?"bg-primary border-primary":"bg-surface-sunken border-border"))}}
      style={{width:tokens.spacing.fixedCanvas,height:tokens.spacing.off18,borderRadius:forgeRadius.sm,borderWidth:tokens.borderWidth.hairline,justifyContent:"center",paddingHorizontal:tokens.spacing.off2,
        alignItems:on?"flex-end":"flex-start"}}>
      <View {...{className:joinClasses(styled&&(on?"bg-on-primary":"bg-text-muted"))}} style={{width:tokens.spacing.fixedInset,height:tokens.spacing.fixedInset,borderRadius:forgeRadius.sm}}/>
    </View>:null}
  </Pressable>;
}

/** Visible reason line under a group of controls; renders nothing without a reason. */
export function Reason({text,styled}:{text:string|undefined;styled:boolean}){
  if(!text)return null;
  return <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{lineHeight:tokens.text.off15}}>{text}</Text>;
}
