import {forgeHairlineRadius} from "../radius.ts";
import type {ReactNode} from "react";
import {Platform,Pressable,Text,View,type PressableProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";

/** Minimum touch target for every office control, in points. */
export const OFFICE_TOUCH_TARGET=44;

/** A key event as React Native Web and RN key handlers deliver it. */
export type OfficeKeyEvent=Parameters<NonNullable<PressableProps["onKeyDown"]>>[0];

/** The pressed key and its modifiers, wherever the platform put them. */
export function officeKey(e:OfficeKeyEvent):{key:string;shift:boolean;mod:boolean;alt:boolean}{
  const n=(e as unknown as {nativeEvent?:Record<string,unknown>}).nativeEvent??{};
  const r=e as unknown as Record<string,unknown>;
  const flag=(k:string)=>n[k]===true||r[k]===true;
  return {key:String(n.key??r.key??""),shift:flag("shiftKey"),mod:flag("metaKey")||flag("ctrlKey"),alt:flag("altKey")};
}

/** Props for {@linkcode ToolButton}. */
export interface ToolButtonProps extends Omit<PressableProps,"children"|"disabled"> {
  /** Spoken and, unless `children` is given, shown. */
  label:string;
  /** Visible content when the label alone is not the right face (a glyph, a styled letter). */
  children?:ReactNode;
  /**
   * Toggle state. `undefined` makes a plain button; `"mixed"` is a selection
   * that is partly on.
   */
  checked?:boolean|"mixed";
  disabled?:boolean;
  /** Shows only `children` and keeps `label` for screen readers. */
  iconOnly?:boolean;
  /**
   * No outline while off, for buttons inside a bordered toolbar. Standalone
   * buttons keep the outline so they read as buttons, not labels.
   * @default false
   */
  quiet?:boolean;
  styled?:boolean;
  className?:string;
}

/**
 * 44pt square-or-wider press target shared by the office cluster's toolbars.
 * A toggle reports `checked` (with "mixed") so screen readers say on, off or
 * mixed; a plain button reports nothing.
 */
export function ToolButton({label,children,checked,disabled=false,iconOnly=false,quiet=false,styled=true,className,style,...rest}:ToolButtonProps){
  const on=checked===true;
  const mixed=checked==="mixed";
  // Native gets the platform toggle role. The web has no "togglebutton" role, so React Native Web
  // gets a button with aria-pressed, which is what screen readers announce as a toggle there.
  const web=(Platform.OS==="web"&&checked!==undefined?{role:"button","aria-pressed":checked}:{}) as object;
  return <Pressable {...rest} {...web} accessibilityRole={checked===undefined?"button":"togglebutton"}
    accessibilityLabel={rest.accessibilityLabel??label}
    accessibilityState={{...rest.accessibilityState,disabled,...(checked===undefined?{}:{checked})}}
    disabled={disabled}
    {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
      // Mixed keeps the accent outline without the fill, so "partly on" never reads as "on".
      styled&&(on?"border-accent bg-accent/10":mixed?"border-accent":quiet?"border-transparent":"border-border"),className)}}
    style={[{minWidth:OFFICE_TOUCH_TARGET,minHeight:OFFICE_TOUCH_TARGET,paddingHorizontal:iconOnly?0:10,
      alignItems:"center",justifyContent:"center",flexDirection:"row",gap:6,opacity:disabled?0.45:1},style as object]}>
    {children??null}
    {iconOnly?null:children===undefined?<Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-sm")}}>{label}</Text>:null}
  </Pressable>;
}

type GlyphProps={styled:boolean;size?:number};

/**
 * Right-pointing triangle (mirrored by `flip`): a square turned 45° and
 * half-clipped, then stretched. Built from a filled view so the theme's text
 * token colors it; a border triangle would need a per-side color class.
 */
export function PlayGlyph({styled,size=14,flip=false}:GlyphProps&{flip?:boolean}){
  const side=size/Math.SQRT2;
  return <View pointerEvents="none" style={{width:size*0.85,height:size,transform:flip?[{scaleX:-1}]:undefined}}>
    <View style={{width:size/2,height:size,overflow:"hidden",transformOrigin:"left",transform:[{scaleX:1.7}]}}>
      <View {...{className:joinClasses(styled&&"bg-text")}}
        style={{position:"absolute",width:side,height:side,left:-side/2,top:(size-side)/2,transform:[{rotate:"45deg"}]}}/>
    </View>
  </View>;
}

/** Two vertical bars. */
export function PauseGlyph({styled,size=14}:GlyphProps){
  const bar=joinClasses(styled&&"bg-text");
  return <View pointerEvents="none" style={{flexDirection:"row",gap:size*0.28}}>
    <View {...{className:bar}} style={{width:size*0.3,height:size,borderRadius:forgeHairlineRadius.tick}}/>
    <View {...{className:bar}} style={{width:size*0.3,height:size,borderRadius:forgeHairlineRadius.tick}}/>
  </View>;
}

/**
 * A bar and one triangle (or two, `double`, for page steps): skip to the
 * next item, or with `back` to the previous one.
 */
export function SkipGlyph({styled,size=12,back=false,double=false}:GlyphProps&{back?:boolean;double?:boolean}){
  const bar=<View {...{className:joinClasses(styled&&"bg-text")}} style={{width:2,height:size,borderRadius:forgeHairlineRadius.tick}}/>;
  const tri=<PlayGlyph styled={styled} size={size} flip={back}/>;
  return <View pointerEvents="none" style={{flexDirection:"row",alignItems:"center",gap:1}}>
    {back?bar:null}{tri}{double?tri:null}{back?null:bar}
  </View>;
}

/** A plus sign. */
export function PlusGlyph({styled,size=14}:GlyphProps){
  const bar=joinClasses(styled&&"bg-text");
  return <View pointerEvents="none" style={{width:size,height:size,alignItems:"center",justifyContent:"center"}}>
    <View {...{className:bar}} style={{position:"absolute",width:size,height:2,borderRadius:forgeHairlineRadius.tick}}/>
    <View {...{className:bar}} style={{position:"absolute",width:2,height:size,borderRadius:forgeHairlineRadius.tick}}/>
  </View>;
}

/** A chevron pointing right (or down when `open`). */
export function ChevronGlyph({styled,open=false,size=8}:GlyphProps&{open?:boolean}){
  return <View pointerEvents="none" {...{className:joinClasses(styled&&"border-text-muted")}}
    style={{width:size,height:size,borderRightWidth:1.5,borderBottomWidth:1.5,
      transform:[{rotate:open?"45deg":"-45deg"}],marginTop:open?-size/3:0}}/>;
}

/** Two crossed bars. */
export function CloseMark({styled,size=14}:GlyphProps){
  const bar=joinClasses(styled&&"bg-text-muted");
  return <View pointerEvents="none" style={{width:size,height:size,alignItems:"center",justifyContent:"center"}}>
    <View {...{className:bar}} style={{position:"absolute",width:size+2,height:1.5,borderRadius:forgeHairlineRadius.tick,transform:[{rotate:"45deg"}]}}/>
    <View {...{className:bar}} style={{position:"absolute",width:size+2,height:1.5,borderRadius:forgeHairlineRadius.tick,transform:[{rotate:"-45deg"}]}}/>
  </View>;
}
