import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {rgbaToHex} from "../color.ts";
import {DEFAULT_COLOR_PAIR,sameColorPair,swapColorPair,type ColorPair,type ColorPairSlot} from "./color-pair.ts";

/** Props for {@linkcode ForegroundBackgroundChips}. */
export interface ForegroundBackgroundChipsProps extends Omit<ViewProps,"children"> {
  readonly value:ColorPair;
  /** One commit per Swap or Reset. */
  readonly onCommit:(next:ColorPair)=>void;
  /** The chip the pickers edit. */
  readonly active:ColorPairSlot;
  readonly onActiveChange:(slot:ColorPairSlot)=>void;
  /** What Reset restores. @default DEFAULT_COLOR_PAIR (black on white) */
  readonly defaults?:ColorPair;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

/**
 * Foreground and background chips with Swap and Reset (C-12). Tapping a chip
 * makes it the one the pickers edit; the host owns both colors and the active
 * slot. Reset is disabled, with its reason in the hint, when the pair already
 * equals the defaults.
 */
export function ForegroundBackgroundChips({
  value,onCommit,active,onActiveChange,defaults=DEFAULT_COLOR_PAIR,disabled=false,className,unstyled=false,testID,style,...rest
}:ForegroundBackgroundChipsProps){
  const styled=!unstyled;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const atDefaults=sameColorPair(value,defaults);
  const chip=(slot:ColorPairSlot,label:string)=>{
    const on=slot===active;
    const hex=rgbaToHex(value[slot],value[slot].alpha<1);
    return <Pressable key={slot} accessibilityRole="radio" aria-checked={on}
      accessibilityState={{checked:on,disabled}} accessibilityLabel={`${label} ${hex}`}
      disabled={disabled} onPress={()=>onActiveChange(slot)} {...id(slot)}
      {...{className:joinClasses(styled&&"rounded-control border-2 focus-visible:ring-2 focus-visible:ring-focus",
        styled&&(on?"border-focus":"border-border"))}}
      style={{flexDirection:"row",alignItems:"center",gap:8,minHeight:44,paddingHorizontal:6,paddingVertical:4}}>
      <View {...{className:joinClasses(styled&&"rounded-control border border-border")}}
        style={{width:32,height:32,backgroundColor:rgbaToHex(value[slot])}}/>
      <Text {...{className:joinClasses(styled&&(on?"text-text font-semibold":"text-text-muted"),styled&&"text-sm")}}>{label}</Text>
    </Pressable>;
  };
  return <View {...rest} {...{className:joinClasses("gap-2",className)}} style={[{flexDirection:"row",flexWrap:"wrap",alignItems:"center"},style]}
    {...(testID?{testID}:{})}>
    <View accessibilityRole="radiogroup" accessibilityLabel="Color being edited" style={{flexDirection:"row",gap:8}}>
      {chip("foreground","Foreground")}
      {chip("background","Background")}
    </View>
    <View style={{flexDirection:"row",gap:8}}>
      <Button title="Swap" variant="secondary" disabled={disabled} accessibilityLabel="Swap foreground and background"
        onPress={()=>onCommit(swapColorPair(value))} {...id("swap")}/>
      <Button title="Reset" variant="ghost" disabled={disabled||atDefaults}
        accessibilityHint={atDefaults?"Already at the default colors":"Restore the default foreground and background"}
        onPress={()=>onCommit(defaults)} {...id("reset")}/>
    </View>
  </View>;
}
