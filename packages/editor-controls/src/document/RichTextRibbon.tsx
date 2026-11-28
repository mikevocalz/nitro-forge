import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import type {ReactNode} from "react";
import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {OFFICE_TOUCH_TARGET,ToolButton} from "../office/office-controls.tsx";
import {TEXT_CASE_LABELS,stepFontSize,type InlineToggle,type RibbonState,type SharedValue,type TextCase} from "./ribbon-model.ts";
import {exact} from '../exact-optional.ts';

/** A color the ribbon offers. `value` is document data (the engine's color string), not a theme token. */
export interface RibbonColor {
  readonly value:string;
  /** Spoken name, e.g. "Dark red". */
  readonly label:string;
}

/** A paragraph style, such as "Heading 1". `id` is the engine's block kind. */
export interface RibbonParagraphStyle {
  readonly id:string;
  readonly label:string;
}

/** Props for {@linkcode RichTextRibbon}. Each group renders only when its callback is passed. */
export interface RichTextRibbonProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** Character state of the selection, from `ribbonStateFor`. */
  readonly state:RibbonState;
  /** Bold, italic, underline and strikethrough. */
  readonly onToggle?:((toggle:InlineToggle,on:boolean)=>void)|undefined;
  /** Toggles to show, in order. @default all four */
  readonly toggles?:readonly InlineToggle[];
  readonly colors?:readonly RibbonColor[];
  /** `undefined` clears the color back to automatic. */
  readonly onColorChange?:((color:string|undefined)=>void)|undefined;
  readonly highlights?:readonly RibbonColor[];
  readonly highlight?:SharedValue<string>;
  readonly onHighlightChange?:((color:string|undefined)=>void)|undefined;
  readonly fontFamilies?:readonly string[];
  readonly fontFamily?:SharedValue<string>;
  readonly onFontFamilyChange?:((family:string)=>void)|undefined;
  readonly fontSize?:SharedValue<number>;
  readonly onFontSizeChange?:((size:number)=>void)|undefined;
  readonly onChangeCase?:((mode:TextCase)=>void)|undefined;
  readonly paragraphStyles?:readonly RibbonParagraphStyle[];
  readonly paragraphStyle?:SharedValue<string>;
  readonly onParagraphStyleChange?:((id:string)=>void)|undefined;
  /** Disables every control, e.g. while the document is read-only. */
  readonly disabled?:boolean;
  /** @default "Formatting" */
  readonly label?:string;
  className?:string;
  unstyled?:boolean;
}

const TOGGLE_FACE:Record<InlineToggle,{label:string;letter:string;style:object}>={
  bold:{label:"Bold",letter:"B",style:{fontWeight:"800"}},
  italic:{label:"Italic",letter:"I",style:{fontStyle:"italic",fontWeight:"600"}},
  underline:{label:"Underline",letter:"U",style:{textDecorationLine:"underline",fontWeight:"600"}},
  strike:{label:"Strikethrough",letter:"S",style:{textDecorationLine:"line-through",fontWeight:"600"}},
};
const ALL_TOGGLES:readonly InlineToggle[]=["bold","italic","underline","strike"];

/**
 * Home-tab formatting ribbon for text documents (H-03): paragraph style,
 * font family and size, character toggles with mixed state, text and
 * highlight color, and case. Everything is controlled; the ribbon only
 * reports intent. Groups wrap onto new lines on narrow screens instead of
 * scrolling, so every control stays reachable.
 */
export function RichTextRibbon({scope='RichTextRibbon',revision=0,...props}:RichTextRibbonProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <RichTextRibbonBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onToggle={props.onToggle?(...args:Parameters<NonNullable<RichTextRibbonProps['onToggle']>>)=>guard.run('onToggle',h=>h.onToggle?.(...args)):undefined}
  onColorChange={props.onColorChange?(...args:Parameters<NonNullable<RichTextRibbonProps['onColorChange']>>)=>guard.run('onColorChange',h=>h.onColorChange?.(...args)):undefined}
  onHighlightChange={props.onHighlightChange?(...args:Parameters<NonNullable<RichTextRibbonProps['onHighlightChange']>>)=>guard.run('onHighlightChange',h=>h.onHighlightChange?.(...args)):undefined}
  onFontFamilyChange={props.onFontFamilyChange?(...args:Parameters<NonNullable<RichTextRibbonProps['onFontFamilyChange']>>)=>guard.run('onFontFamilyChange',h=>h.onFontFamilyChange?.(...args)):undefined}
  onFontSizeChange={props.onFontSizeChange?(...args:Parameters<NonNullable<RichTextRibbonProps['onFontSizeChange']>>)=>guard.run('onFontSizeChange',h=>h.onFontSizeChange?.(...args)):undefined}
  onChangeCase={props.onChangeCase?(...args:Parameters<NonNullable<RichTextRibbonProps['onChangeCase']>>)=>guard.run('onChangeCase',h=>h.onChangeCase?.(...args)):undefined}
  onParagraphStyleChange={props.onParagraphStyleChange?(...args:Parameters<NonNullable<RichTextRibbonProps['onParagraphStyleChange']>>)=>guard.run('onParagraphStyleChange',h=>h.onParagraphStyleChange?.(...args)):undefined}
 />;
}
function RichTextRibbonBody({actionError,disabledReason,
  state,onToggle,toggles=ALL_TOGGLES,colors,onColorChange,highlights,highlight,onHighlightChange,fontFamilies,fontFamily,
  onFontFamilyChange,fontSize,onFontSizeChange,onChangeCase,paragraphStyles,paragraphStyle,onParagraphStyleChange,
  disabled=false,label="Formatting",className,unstyled=false,...rest
}:RichTextRibbonProps&{actionError?:string|null}){
  const styled=!unstyled;
  const sizeKnown=typeof fontSize==="number";
  return <View {...rest} accessibilityRole="toolbar" accessibilityLabel={label}
    {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-raised",className)}}
    style={[{flexDirection:"row",flexWrap:"wrap",alignItems:"flex-start",columnGap:14,rowGap:4,padding:4},rest.style as object]}>
    {onParagraphStyleChange&&paragraphStyles?.length?<Group label="Paragraph style" styled={styled}>
      {paragraphStyles.map(p=><ToolButton quiet key={p.id} label={p.label} checked={paragraphStyle===p.id} disabled={disabled}
        styled={styled} onPress={()=>onParagraphStyleChange(p.id)}/>)}
    </Group>:null}
    {onFontFamilyChange&&fontFamilies?.length?<Group label="Font" styled={styled}>
      {fontFamilies.map(f=><ToolButton quiet key={f} label={f} checked={fontFamily===f} disabled={disabled} styled={styled}
        onPress={()=>onFontFamilyChange(f)}>
        <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-sm")}} style={{fontFamily:f}}>{f}</Text>
      </ToolButton>)}
    </Group>:null}
    {onFontSizeChange?<Group label="Font size" styled={styled}>
      <ToolButton quiet label="Decrease font size" disabled={disabled||!sizeKnown} styled={styled}
        onPress={()=>sizeKnown&&onFontSizeChange(stepFontSize(fontSize,-1))}>
        <Text {...{className:joinClasses(styled&&"text-text")}} style={{fontSize:13,fontWeight:"600"}}>A−</Text>
      </ToolButton>
      <View accessible accessibilityLabel={"Font size "+(sizeKnown?fontSize+" point":"mixed")}
        style={{minWidth:44,minHeight:OFFICE_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
        <Text {...{className:joinClasses(styled&&"text-text")}} style={{fontVariant:["tabular-nums"]}}>{sizeKnown?String(fontSize):"–"}</Text>
      </View>
      <ToolButton quiet label="Increase font size" disabled={disabled||!sizeKnown} styled={styled}
        onPress={()=>sizeKnown&&onFontSizeChange(stepFontSize(fontSize,1))}>
        <Text {...{className:joinClasses(styled&&"text-text")}} style={{fontSize:17,fontWeight:"600"}}>A+</Text>
      </ToolButton>
    </Group>:null}
    {onToggle&&toggles.length?<Group label="Character style" styled={styled}>
      {toggles.map(t=>{
        const face=TOGGLE_FACE[t];
        return <ToolButton quiet key={t} label={face.label} checked={state[t]} disabled={disabled} styled={styled}
          onPress={()=>onToggle(t,state[t]!==true)}>
          <Text {...{className:joinClasses(styled&&"text-text")}} style={[{fontSize:17},face.style]}>{face.letter}</Text>
        </ToolButton>;
      })}
    </Group>:null}
    {onColorChange&&colors?.length?<Swatches label="Text color" colors={colors} value={state.color} disabled={disabled}
      styled={styled} onChange={onColorChange} clearLabel="Automatic color"/>:null}
    {onHighlightChange&&highlights?.length?<Swatches label="Highlight" colors={highlights} value={highlight} disabled={disabled}
      styled={styled} onChange={onHighlightChange} clearLabel="No highlight"/>:null}
    {onChangeCase?<Group label="Change case" styled={styled}>
      {(Object.keys(TEXT_CASE_LABELS) as TextCase[]).map(c=><ToolButton quiet key={c} label={TEXT_CASE_LABELS[c]} disabled={disabled}
        styled={styled} onPress={()=>onChangeCase(c)}/>)}
    </Group>:null}
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}

function Group({label,styled,children}:{label:string;styled:boolean;children:ReactNode}){
  // Groups are set apart by space, not rules: a rule would dangle at the end of every wrapped line.
  return <View accessibilityLabel={label} {...{role:"group"}}
    style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:2}}>
    {children}
  </View>;
}

function Swatches({label,colors,value,onChange,clearLabel,disabled,styled}:{
  label:string;colors:readonly RibbonColor[];value:SharedValue<string>;onChange:(c:string|undefined)=>void;
  clearLabel:string;disabled:boolean;styled:boolean;
}){
  return <Group label={label} styled={styled}>
    <ToolButton quiet label={clearLabel} checked={value===undefined} disabled={disabled} styled={styled} onPress={()=>onChange(undefined)}>
      <View {...{className:joinClasses(styled&&"border-text-muted")}}
        style={{width:20,height:20,borderRadius:10, /* radius-exempt: colour-well */borderWidth:1.5,alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
        <View {...{className:joinClasses(styled&&"bg-text-muted")}} style={{width:24,height:1.5,transform:[{rotate:"-45deg"}]}}/>
      </View>
    </ToolButton>
    {colors.map(c=>{
      const on=value===c.value;
      return <Pressable key={c.value} accessibilityRole="radio" accessibilityLabel={label+" "+c.label}
        accessibilityState={{checked:on,disabled}} disabled={disabled} onPress={()=>onChange(c.value)}
        {...{className:joinClasses(styled&&"rounded-control border-2 focus-visible:ring-2 focus-visible:ring-focus",
          styled&&(on?"border-focus":"border-transparent"))}}
        style={{width:OFFICE_TOUCH_TARGET,height:OFFICE_TOUCH_TARGET,alignItems:"center",justifyContent:"center",opacity:disabled?0.45:1}}>
        <View {...{className:joinClasses(styled&&"border border-border")}}
          style={{width:24,height:24,borderRadius:12, /* radius-exempt: colour-well */backgroundColor:c.value}}/>
      </Pressable>;
    })}
  </Group>;
}
