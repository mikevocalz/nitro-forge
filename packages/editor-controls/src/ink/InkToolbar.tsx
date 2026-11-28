import {useRef,type ReactNode} from "react";
import {Pressable,ScrollView,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {
 INK_SIZE_LABELS,INK_TOOL_LABELS,INK_TOOL_SHORTCUTS,INK_TOUCH_TARGET,availabilityReason,
 formatInkOpacity,inkSizePreviewDiameter,planInkCommand,resolveInkShortcut,stepInkOpacity,validateInkToolbar,
 type InkAvailability,type InkCommandOutcome,type InkKeyEvent,type InkPressure,type InkSize,type InkSwatch,
 type InkTool,type InkToolOption,
} from "./ink-model.ts";

/** Icon slots an {@linkcode InkToolbar} host can fill. Missing slots fall back to text labels. */
export type InkToolbarIcon=InkTool|"undo"|"redo";

/** Props for {@linkcode InkToolbar}. Every value is controlled by the host board. */
export interface InkToolbarProps extends Omit<ViewProps,"children"|"onKeyDown"> {
 /**
  * Lay controls out in a row (top or bottom bar) or a column (rail).
  * @default "horizontal"
  */
 orientation?:"horizontal"|"vertical";
 /**
  * Physical screen edge the toolbar sits against; draws the separating
  * border on the opposite side. A foldable or tablet rail is `"right"`
  * even in RTL, per the navigation shell policy.
  */
 edge?:"left"|"right"|"top"|"bottom";
 /** Tools the host board implements, in display order. */
 tools:readonly InkToolOption[];
 /** The active tool. Must be one of `tools`. */
 tool:InkTool;
 /** Called when the user picks an enabled tool other than the active one. */
 onToolChange:(tool:InkTool)=>void;
 /** The active stroke size. */
 size:InkSize;
 /** Called with the next size step. */
 onSizeChange:(size:InkSize)=>void;
 /** Host palette. The color group is hidden when omitted or empty. */
 swatches?:readonly InkSwatch[];
 /** Selected swatch id. Must match one of `swatches` when set. */
 color?:string;
 /** Called with a swatch id. Required to make swatches interactive. */
 onColorChange?:(id:string)=>void;
 /**
  * Shows a "Custom color" button that asks the host to open its own picker
  * (for example `ColorChannels` in a popover). Hidden when omitted.
  */
 onRequestCustomColor?:()=>void;
 /** Stroke opacity 0..1. The opacity control is hidden when omitted. */
 opacity?:number;
 /** Called with the stepped opacity. */
 onOpacityChange?:(opacity:number)=>void;
 /** Whether undo can run, and why not. */
 undo:InkAvailability;
 /** Whether redo can run, and why not. */
 redo:InkAvailability;
 onUndo:()=>void;
 onRedo:()=>void;
 /**
  * Pressure toggle. Pass it only when the current hardware reports measured
  * pressure; the toggle is not rendered otherwise.
  */
 pressure?:InkPressure;
 onPressureChange?:(enabled:boolean)=>void;
 /** Host-drawn glyphs. Each control shows its text label when its slot is empty. */
 icons?:Partial<Record<InkToolbarIcon,ReactNode>>;
 /** @default "Ink tools" */
 label?:string;
 className?:string;
 unstyled?:boolean;
}

type Local={notice:string|undefined};
type Styled=boolean;

/**
 * Controlled tool, size, color, opacity, pressure and history controls for a
 * drawing board. The board's stroke engine, renderer, pen connection and
 * history stay in the host; this component holds only the notice line that
 * explains why a disabled control did nothing.
 *
 * Keyboard shortcuts run while focus is inside the toolbar. For board-wide
 * shortcuts, call {@linkcode resolveInkShortcut} from the host's own key
 * handling; the toolbar never installs a global listener.
 */
export function InkToolbar({
 orientation="horizontal",edge,tools,tool,onToolChange,size,onSizeChange,swatches,color,onColorChange,
 onRequestCustomColor,opacity,onOpacityChange,undo,redo,onUndo,onRedo,pressure,onPressureChange,icons,
 label="Ink tools",className,unstyled=false,style,...rest
}:InkToolbarProps){
 validateInkToolbar({tools,tool,size,swatches,color,opacity,undo,redo});
 const local=useRef<StoreApi<Local>|null>(null);
 if(!local.current)local.current=createStore<Local>(()=>({notice:undefined}));
 const store=local.current;
 const notice=useStore(store,s=>s.notice);
 const vertical=orientation==="vertical";
 const styled=!unstyled;

 const run=(outcome:InkCommandOutcome)=>{
  if(outcome.kind==="notice"){store.setState({notice:outcome.message});return;}
  if(outcome.kind==="none")return;
  store.setState({notice:undefined});
  if(outcome.kind==="tool")onToolChange(outcome.tool);
  else if(outcome.kind==="size")onSizeChange(outcome.size);
  else if(outcome.kind==="undo")onUndo();
  else onRedo();
 };
 const state={tools,tool,size,undo,redo};
 const onKeyDown=(event:InkKeyEvent&{preventDefault?:()=>void})=>{
  const command=resolveInkShortcut(event);
  if(command===undefined)return;
  event.preventDefault?.();
  run(planInkCommand(command,state));
 };
 const blocked=(reason:string|undefined,action:()=>void)=>()=>{
  if(reason!==undefined){store.setState({notice:reason});return;}
  store.setState({notice:undefined});
  action();
 };
 const swatchList=swatches??[];
 const showColor=swatchList.length>0||onRequestCustomColor!==undefined;
 const borderSide=edge==="left"?"border-r":edge==="right"?"border-l":edge==="top"?"border-b":edge==="bottom"?"border-t":undefined;
 const group={flexDirection:vertical?"column":"row",alignItems:"center",gap:4} as const;

 return <View {...rest} role="toolbar" aria-label={label} aria-orientation={orientation}
   {...{onKeyDown,className:joinClasses("min-w-0",styled&&"bg-surface-raised",styled&&borderSide,styled&&borderSide&&"border-border",className)}}
   style={[vertical?{width:92,maxHeight:"100%"}:{maxWidth:"100%"},style]}>
  <ScrollView horizontal={!vertical} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
   contentContainerStyle={{...group,gap:6,padding:6}}>
   <View role="radiogroup" aria-label="Tool" style={group}>
    {tools.map(option=>{
     const selected=option.tool===tool;
     const reason=option.disabledReason;
     const name=option.label??INK_TOOL_LABELS[option.tool];
     return <ToolbarButton key={option.tool} role="radio" checked={selected} styled={styled} vertical={vertical}
      label={name} hint={reason??"Shortcut "+INK_TOOL_SHORTCUTS[option.tool]} disabled={reason!==undefined}
      icon={icons?.[option.tool]}
      onPress={blocked(reason,()=>{if(!selected)onToolChange(option.tool);})}/>;
    })}
   </View>
   <Divider vertical={vertical} styled={styled}/>
   <Stepper styled={styled} vertical={vertical} label="Size" valueText={INK_SIZE_LABELS[size]}
    hint="Shortcuts [ and ]"
    onStep={direction=>run(planInkCommand({type:"size",direction},state))}>
    <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-text")}}
     style={{width:inkSizePreviewDiameter(size,tool),height:inkSizePreviewDiameter(size,tool),borderRadius:14}}/>
   </Stepper>
   {opacity!==undefined&&onOpacityChange?<Stepper styled={styled} vertical={vertical} label="Opacity"
     valueText={formatInkOpacity(opacity)} valueNow={Math.round(opacity*100)}
     onStep={direction=>{
      const next=stepInkOpacity(opacity,direction);
      if(next===opacity)store.setState({notice:direction>0?"Already fully opaque":"Opacity is at its minimum"});
      else{store.setState({notice:undefined});onOpacityChange(next);}
     }}>
     <Text {...{className:joinClasses(styled&&"text-text")}}
      style={{fontSize:12,fontWeight:"600",fontVariant:["tabular-nums"]}}>{formatInkOpacity(opacity)}</Text>
    </Stepper>:null}
   {showColor?<>
    <Divider vertical={vertical} styled={styled}/>
    <View role="radiogroup" aria-label="Color" style={{...group,flexWrap:vertical?"wrap":"nowrap",justifyContent:"center"}}>
     {swatchList.map(swatch=><Swatch key={swatch.id} swatch={swatch} selected={swatch.id===color} styled={styled}
      reason={onColorChange?undefined:"Color is fixed for this tool"}
      onPress={blocked(onColorChange?undefined:"Color is fixed for this tool",
       ()=>{if(swatch.id!==color)onColorChange?.(swatch.id);})}/>)}
    </View>
    {onRequestCustomColor?<ToolbarButton styled={styled} vertical={vertical} label="Custom color" shortLabel="Custom"
     onPress={blocked(undefined,onRequestCustomColor)}/>:null}
   </>:null}
   {pressure!==undefined&&onPressureChange?<>
    <Divider vertical={vertical} styled={styled}/>
    <ToolbarButton role="switch" checked={pressure.enabled} styled={styled} vertical={vertical} label="Pressure"
     hint={pressure.disabledReason??"Stroke width follows pen pressure"} disabled={pressure.disabledReason!==undefined}
     onPress={blocked(pressure.disabledReason,()=>onPressureChange(!pressure.enabled))}/>
   </>:null}
   <Divider vertical={vertical} styled={styled}/>
   <View style={group}>
    <ToolbarButton styled={styled} vertical={vertical} label="Undo" icon={icons?.undo}
     hint={availabilityReason(undo)} disabled={!undo.enabled} onPress={()=>run(planInkCommand({type:"undo"},state))}/>
    <ToolbarButton styled={styled} vertical={vertical} label="Redo" icon={icons?.redo}
     hint={availabilityReason(redo)} disabled={!redo.enabled} onPress={()=>run(planInkCommand({type:"redo"},state))}/>
   </View>
  </ScrollView>
  {/* Polite live region: a disabled control explains itself when pressed. */}
  <Text aria-live="polite" accessibilityLiveRegion="polite" numberOfLines={2}
   {...{className:joinClasses(styled&&"text-text-muted")}}
   style={{fontSize:12,paddingHorizontal:8,paddingBottom:notice?6:0,textAlign:"center",
    ...(notice?null:{height:0,overflow:"hidden"})}}>{notice??""}</Text>
 </View>;
}

function ToolbarButton({label,shortLabel,hint,icon,onPress,disabled=false,role="button",checked,styled,vertical}:{
 label:string;shortLabel?:string;hint?:string|undefined;icon?:ReactNode;onPress:()=>void;disabled?:boolean;
 role?:"button"|"radio"|"switch";checked?:boolean;styled:Styled;vertical:boolean;
}){
 const on=checked===true;
 // A switch reads its state from aria-checked; only radios get the filled selected look.
 const filled=on&&role==="radio";
 // Disabled controls stay pressable so they can say why in the notice line.
 // React Native Web's Pressable overwrites aria-disabled with its own
 // `disabled` prop, which would block the press, so the unavailable state is
 // also part of the accessible name. Native platforms read accessibilityState.
 return <Pressable role={role} aria-label={disabled?label+", unavailable":label}
  aria-checked={role==="button"?undefined:on}
  accessibilityState={{disabled}} accessibilityHint={hint} onPress={onPress}
  {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus",
   styled&&(filled?"bg-primary":"bg-surface-raised"),
   styled&&role==="switch"&&"border",styled&&role==="switch"&&(on?"border-primary":"border-border"))}}
  style={{minWidth:INK_TOUCH_TARGET,minHeight:INK_TOUCH_TARGET,width:vertical?"100%":undefined,
   paddingHorizontal:vertical?4:10,alignItems:"center",justifyContent:"center",
   flexDirection:vertical?"column":"row",gap:vertical?3:6,
   opacity:disabled?0.45:1}}>
  {icon??null}
  {icon&&!vertical?null:<Text numberOfLines={1}
   {...{className:joinClasses(styled&&(filled?"text-on-primary":"text-text"))}}
   style={{fontSize:13,fontWeight:on?"700":"500"}}>{vertical&&shortLabel?shortLabel:label}</Text>}
  {role==="switch"?<View pointerEvents="none"
   {...{className:joinClasses(styled&&(on?"bg-primary":"bg-border"))}}
   style={vertical?{width:20,height:3,borderRadius:2}:{width:8,height:8,borderRadius:4}}/>:null}
 </Pressable>;
}

function Stepper({label,valueText,valueNow,hint,onStep,children,styled,vertical}:{
 label:string;valueText:string;valueNow?:number;hint?:string;onStep:(direction:-1|1)=>void;
 children:ReactNode;styled:Styled;vertical:boolean;
}){
 const step=(direction:-1|1)=><Pressable role="button" aria-label={(direction<0?"Decrease ":"Increase ")+label.toLowerCase()}
  onPress={()=>onStep(direction)}
  {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
  style={{width:INK_TOUCH_TARGET,height:INK_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
  <Text {...{className:joinClasses(styled&&"text-text")}} style={{fontSize:18}}>{direction<0?"−":"+"}</Text>
 </Pressable>;
 return <View style={{flexDirection:vertical?"column-reverse":"row",alignItems:"center"}}
  {...{className:joinClasses(styled&&"rounded-control bg-surface-sunken")}}>
  {step(-1)}
  <View accessible accessibilityRole="adjustable" aria-label={label} aria-valuetext={valueText}
   aria-valuenow={valueNow} accessibilityHint={hint}
   accessibilityActions={[{name:"increment",label:"Increase"},{name:"decrement",label:"Decrease"}]}
   onAccessibilityAction={e=>{
    if(e.nativeEvent.actionName==="increment")onStep(1);
    if(e.nativeEvent.actionName==="decrement")onStep(-1);
   }}
   style={{minWidth:INK_TOUCH_TARGET,height:INK_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
   {children}
  </View>
  {step(1)}
 </View>;
}

function Swatch({swatch,selected,onPress,reason,styled}:{
 swatch:InkSwatch;selected:boolean;onPress:()=>void;reason:string|undefined;styled:Styled;
}){
 return <Pressable role="radio" aria-label={reason===undefined?swatch.label:swatch.label+", unavailable"}
  aria-checked={selected} accessibilityState={{disabled:reason!==undefined}}
  accessibilityHint={reason} onPress={onPress}
  {...{className:joinClasses(styled&&"rounded-full focus-visible:ring-2 focus-visible:ring-focus")}}
  style={{width:INK_TOUCH_TARGET,height:INK_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
  <View pointerEvents="none" {...{className:joinClasses(styled&&(selected?"border-text":"border-border"))}}
   style={{width:34,height:34,borderRadius:17,borderWidth:selected?2:1,alignItems:"center",justifyContent:"center",
    borderColor:styled?undefined:selected?swatch.value:undefined}}>
   <View style={{width:selected?24:30,height:selected?24:30,borderRadius:15,backgroundColor:swatch.value}}/>
  </View>
 </Pressable>;
}

function Divider({vertical,styled}:{vertical:boolean;styled:Styled}){
 return <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-border")}}
  style={vertical?{height:1,width:40,marginVertical:2}:{width:1,height:28,marginHorizontal:2}}/>;
}
