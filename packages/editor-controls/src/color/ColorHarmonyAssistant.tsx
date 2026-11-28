import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {assertHsv,assertRgba,hsvToRgb,rgbaToHex,type HsvColor,type RgbaColor} from "../color.ts";
import {compositeOver,contrastRating} from "./contrast.ts";
import {HARMONY_KINDS,harmonyColors,type HarmonyKind} from "./harmony.ts";
import { tokens } from "../tokens.ts";

/** Props for {@linkcode ColorHarmonyAssistant}. */
export interface ColorHarmonyAssistantProps extends Omit<ViewProps,"children"> {
  /** The base color. */
  readonly value:HsvColor;
  readonly kind:HarmonyKind;
  readonly onKindChange:(kind:HarmonyKind)=>void;
  /** Applies a harmony color. One commit per press. */
  readonly onPick:(color:HsvColor)=>void;
  /** Opaque surface the colors will sit on, for the contrast check (e.g. the canvas background). */
  readonly contrastBackground:RgbaColor;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

const level=(r:ReturnType<typeof contrastRating>)=>
  r.aaa?"AAA":r.aa?"AA":r.aaLarge?"AA large text only":"Fails AA";

/**
 * Harmony and contrast helper (C-18): pick a rule, see the base color and its
 * companions, and read each one's WCAG 2.2 contrast against
 * `contrastBackground`. The rating is spelled out in text ("AA", "Fails AA"),
 * never shown by color alone. Pressing a swatch applies it.
 */
export function ColorHarmonyAssistant({
  value,kind,onKindChange,onPick,contrastBackground,disabled=false,className,unstyled=false,testID,style,...rest
}:ColorHarmonyAssistantProps){
  assertHsv(value);
  assertRgba(contrastBackground);
  const styled=!unstyled;
  const colors=harmonyColors(value,kind);
  const background=rgbaToHex({...contrastBackground,alpha:1},false);
  const base=hsvToRgb(value);
  const baseRating=contrastRating(base,contrastBackground);
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-3",styled&&"rounded-control bg-surface-raised p-3",className)}} style={style}>
    <View accessibilityRole="radiogroup" accessibilityLabel="Harmony rule" style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.off6}}>
      {HARMONY_KINDS.map(k=>{
        const on=k.kind===kind;
        return <Pressable key={k.kind} accessibilityRole="radio" aria-checked={on} accessibilityState={{checked:on,disabled}}
          disabled={disabled} onPress={()=>onKindChange(k.kind)}
          {...{className:joinClasses(styled&&"rounded-control border px-3 focus-visible:ring-2 focus-visible:ring-focus",
            styled&&(on?"border-focus bg-surface-sunken":"border-border"))}}
          style={{minHeight:tokens.spacing.fixedTarget,justifyContent:"center"}}>
          <Text {...{className:joinClasses(styled&&"text-sm",styled&&(on?"text-text font-semibold":"text-text-muted"))}}>{k.label}</Text>
        </Pressable>;
      })}
    </View>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.fixedElement}}>
      {colors.map((c,i)=>{
        const rgb=hsvToRgb(c);
        const hex=rgbaToHex(rgb,false);
        const rating=contrastRating(rgb,contrastBackground);
        return <Pressable key={i} accessibilityRole="button" disabled={disabled} onPress={()=>onPick(c)}
          accessibilityLabel={`${i===0?"Base color":"Use"} ${hex}, contrast ${rating.ratio} to 1, ${level(rating)}`}
          {...{className:joinClasses(styled&&"rounded-control border border-border p-1 focus-visible:ring-2 focus-visible:ring-focus")}}
          style={{width:tokens.spacing.off76,gap:tokens.spacing.fixedStack,alignItems:"stretch"}}>
          <View pointerEvents="none" {...{className:joinClasses(styled&&"rounded-control")}} style={{height:tokens.spacing.fixedTarget,backgroundColor:rgbaToHex(compositeOver(rgb,contrastBackground),false)}}/>
          <Text {...{className:joinClasses(styled&&"text-text text-xs")}} style={{fontVariant:["tabular-nums"]}}>{hex}</Text>
          <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{fontVariant:["tabular-nums"]}}>
            {`${rating.ratio}:1 ${rating.aa?"AA":"fails"}`}
          </Text>
        </Pressable>;
      })}
    </View>
    <View {...{className:joinClasses(styled&&"rounded-control border border-border")}}
      style={{backgroundColor:background,padding:tokens.spacing.fixedInset,gap:tokens.spacing.fixedStack}}>
      <Text style={{color:rgbaToHex(base),fontSize:tokens.text.off22,fontWeight:tokens.fontWeight.bold}}>Aa Sample heading</Text>
      <Text style={{color:rgbaToHex(base),fontSize:tokens.text.off15}}>Body text in the base color on this background.</Text>
    </View>
    <Text accessibilityLiveRegion="polite" {...{className:joinClasses(styled&&"text-text text-sm")}} style={{fontVariant:["tabular-nums"]}}>
      {`Base on background: ${baseRating.ratio}:1, ${level(baseRating)}.`}
    </Text>
  </View>;
}
