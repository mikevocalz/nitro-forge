import {Pressable,Text,View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";

/** Props for {@linkcode SwitchRow}. */
export interface SwitchRowProps {
  label:string;
  /** Secondary line under the label. */
  detail?:string;
  value:boolean;
  onValueChange:(value:boolean)=>void;
  /** Why the switch cannot change; shown as its detail line and read as its hint. */
  disabledReason?:string;
  unstyled?:boolean;
}

/**
 * A full-width 44pt switch row shared by the Forge selection and canvas tool
 * panels. Disabled rows stay pressable and do nothing, showing their reason,
 * so a press is never silent.
 */
export function SwitchRow({label,detail,value,onValueChange,disabledReason,unstyled=false}:SwitchRowProps){
  const styled=!unstyled,off=disabledReason!==undefined;
  return <Pressable role="switch" aria-checked={value} aria-label={off?label+", unavailable":label}
    accessibilityState={{disabled:off,checked:value}} accessibilityHint={disabledReason??detail}
    onPress={()=>{if(!off)onValueChange(!value);}}
    {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
    style={{minHeight:44,flexDirection:"row",alignItems:"center",gap:12,paddingVertical:6,paddingHorizontal:4}}>
    <View style={{flex:1,minWidth:0,opacity:off?0.6:1}}>
      <Text {...{className:joinClasses(styled&&"text-text text-sm font-medium")}}>{label}</Text>
      {disabledReason??detail?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{disabledReason??detail}</Text>:null}
    </View>
    <View pointerEvents="none" {...{className:joinClasses(styled&&"border",styled&&(value?"bg-primary border-primary":"bg-surface-sunken border-border"))}}
      style={{width:44,height:26,borderRadius:13,justifyContent:"center",paddingHorizontal:3,opacity:off?0.5:1}}>
      <View {...{className:joinClasses(styled&&(value?"bg-on-primary":"bg-text-muted"))}}
        style={{width:18,height:18,borderRadius:9,alignSelf:value?"flex-end":"flex-start"}}/>
    </View>
  </Pressable>;
}
