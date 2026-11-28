import {useLayoutEffect,useRef,type ComponentRef,type ReactNode} from "react";
import {PanResponder,Platform,Text,View,type GestureResponderEvent,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {Button} from "@nyc-tron/ui/components/Button";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {PrecisionScrubber} from "@nyc-tron/ui/components/shell/PrecisionScrubber";
import {Crosshair,MarchingAnts} from "./selection-overlay.tsx";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {createCanvasResponder} from '@nyc-tron/ui/components/gestures/canvas-responder';
import {SwitchRow} from "./switch-row.tsx";
import {
 KEYBOARD_STEP,MAX_SELECTION_RADIUS,clampRadius,docRectToView,docToView,modeFromModifiers,validateMapping,viewToDoc,
 type DocPoint,type DocRect,type SelectionKey,type SelectionMode,type ViewMapping,
} from "./selection-model.ts";
import {
 MAX_TOLERANCE,WAND_SAMPLES,buildMagicWand,buildModifySelection,describeWand,formatTolerance,modifyProblem,
 validateWandSettings,wandProblem,type MagicWandRequest,type MagicWandSettings,type ModifySelectionRequest,
 type RefineEdgeRequest,type WandSample,
} from "./magic-selection-model.ts";
import {exact} from '../exact-optional.ts';

/** Radii the edge tools use, in document pixels. Host-owned like every other setting. */
export interface SelectionEdgeRadii {
  readonly grow:number;
  readonly feather:number;
  readonly smooth:number;
}

/** Props for {@linkcode MagicSelectionControls}. */
export interface MagicSelectionControlsProps extends Omit<ViewProps,"children">,ScopedControlProps {
  settings:MagicWandSettings;
  /** One call per committed scrubber change, toggle or sample choice. */
  onSettingsChange:(settings:MagicWandSettings)=>void;
  /** Name of the layer `sample: "layer"` reads, shown on the choice. `undefined` when no layer is current. */
  currentLayerName?:string|undefined;
  /** Whether the editor has a pixel selection (from `getSelection`). Edge tools need one. */
  hasSelection:boolean;
  radii:SelectionEdgeRadii;
  onRadiiChange:(radii:SelectionEdgeRadii)=>void;
  /** Grow, Shrink and Feather. Maps to `modifySelection`. One call per press. */
  onModifySelection:(request:ModifySelectionRequest,signal?:AbortSignal)=>void|Promise<unknown>;
  /**
   * Refine edge (smooth, then feather). Optional: the Prism v2 contract has no
   * smoothing op, so without this handler the section explains that and stays off.
   */
  onRefineEdge?:(request:RefineEdgeRequest,signal?:AbortSignal)=>void|Promise<unknown>;
  /** @default "Magic selection" */
  label?:string;
  className?:string;
  unstyled?:boolean;
}

/**
 * Settings for the magic wand and the selection edge tools (B-20): tolerance,
 * contiguous, sample source, then grow/shrink, feather and refine edge, each
 * with a {@linkcode PrecisionScrubber}. Edge buttons send one
 * `modifySelection` per press and stay visibly disabled, with the reason, when
 * nothing is selected. Pair with {@linkcode MagicWandCanvas} for the clicks.
 */
export function MagicSelectionControls({scope='magic-selection',revision=0,...props}:MagicSelectionControlsProps){
 validateWandSettings(props.settings);
 if(Object.values(props.radii).some(r=>!Number.isFinite(r)||r<0||r>MAX_SELECTION_RADIUS))throw new RangeError('Invalid selection radius');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.currentLayerName,props.hasSelection]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <MagicSelectionControlsBody key={owner} {...props} actionError={guard.error} busy={guard.pending}
  onSettingsChange={value=>guard.current()?.onSettingsChange(value)} onRadiiChange={value=>guard.current()?.onRadiiChange(value)}
  onModifySelection={value=>guard.run('modify',(host,signal)=>host.hasSelection?host.onModifySelection(value,signal):undefined)}
  {...(props.onRefineEdge?{onRefineEdge:(value:RefineEdgeRequest)=>guard.run('refine',(host,signal)=>host.hasSelection?host.onRefineEdge?.(value,signal):undefined)}:{})}/>;
}
function MagicSelectionControlsBody({
 settings,onSettingsChange,currentLayerName,hasSelection,radii,onRadiiChange,onModifySelection,onRefineEdge,
 actionError=null,busy=false,disabledReason,label="Magic selection",className,unstyled=false,...rest
}:MagicSelectionControlsProps&{actionError?:string|null;busy?:boolean}){
 validateWandSettings(settings);
 const styled=!unstyled;
 const unavailable=busy||disabledReason!==undefined;
 const set=(patch:Partial<MagicWandSettings>)=>onSettingsChange({...settings,...patch});
 const setRadius=(key:keyof SelectionEdgeRadii)=>(v:number)=>onRadiiChange({...radii,[key]:clampRadius(v)});
 const growProblem=unavailable?(disabledReason??"Selection change in progress"):modifyProblem(hasSelection,radii.grow);
 const featherProblem=unavailable?(disabledReason??"Selection change in progress"):modifyProblem(hasSelection,radii.feather);
 const refineProblem=unavailable?(disabledReason??"Selection change in progress"):onRefineEdge===undefined?"Refine edge needs a smoothing operation this editor does not offer"
  :!hasSelection?"Nothing is selected":radii.smooth<1&&radii.feather<1?"Set a smooth or feather radius":undefined;
 const heading=(text:string)=><Text role="heading" aria-level={3}
  {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}} style={{paddingTop:4}}>{text}</Text>;
 const reason=(text:string|undefined)=>text?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{text}</Text>:null;
 const radiusScrubber=(key:keyof SelectionEdgeRadii,name:string)=><PrecisionScrubber label={name} unit=" px"
  value={radii[key]} disabled={unavailable} min={0} max={MAX_SELECTION_RADIUS} step={1} unstyled={unstyled} onCommit={setRadius(key)}/>;

 return <View {...rest} role="group" aria-label={label}
  {...{className:joinClasses("gap-3",styled&&"rounded-card border border-border bg-surface-raised p-3",className)}}>
  {disabledReason?<Text accessibilityLiveRegion="polite">{disabledReason}</Text>:null}
  {busy?<Text accessibilityLiveRegion="polite">Selection change in progress</Text>:null}
  <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
  {heading("Magic wand")}
  <PrecisionScrubber label={`Tolerance (${formatTolerance(settings.tolerance)})`} value={settings.tolerance}
   disabled={unavailable} min={0} max={MAX_TOLERANCE} step={1} unstyled={unstyled} onCommit={v=>set({tolerance:Math.round(v)})}/>
  <SwitchRow label="Contiguous" {...(unavailable?{disabledReason:disabledReason??"Selection change in progress"}:{})} unstyled={unstyled} value={settings.contiguous}
   detail={settings.contiguous?"Only pixels connected to the one you click":"Every matching pixel in the image"}
   onValueChange={contiguous=>set({contiguous})}/>
  <View style={{gap:4}}>
   <Text nativeID="wand-sample-label" {...{className:joinClasses(styled&&"text-text text-sm font-medium")}}>Sample</Text>
   <SegmentedControl disabled={unavailable} aria-label="Sample" value={settings.sample} unstyled={unstyled}
    options={WAND_SAMPLES.map(o=>({value:o.value,label:o.value==="layer"&&currentLayerName?`Layer: ${currentLayerName}`:o.label,
     disabled:o.value==="layer"&&currentLayerName===undefined}))}
    onChange={(sample:WandSample)=>set({sample})}/>
   {reason(currentLayerName===undefined?"Current layer sampling needs a selected layer":undefined)}
  </View>
  {heading("Selection edge")}
  {!hasSelection?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(styled&&"text-text text-xs")}}>
   Make a selection first to grow, shrink, feather or refine it.</Text>:null}
  {radiusScrubber("grow","Grow or shrink by")}
  <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>
   <Button size="md" variant="secondary" title="Grow" unstyled={unstyled} disabled={growProblem!==undefined}
    accessibilityHint={growProblem} onPress={()=>onModifySelection(buildModifySelection("grow",radii.grow,hasSelection))}/>
   <Button size="md" variant="secondary" title="Shrink" unstyled={unstyled} disabled={growProblem!==undefined}
    accessibilityHint={growProblem} onPress={()=>onModifySelection(buildModifySelection("shrink",radii.grow,hasSelection))}/>
  </View>
  {hasSelection?reason(growProblem):null}
  {radiusScrubber("feather","Feather radius")}
  <Button size="md" variant="secondary" title="Feather" unstyled={unstyled} disabled={featherProblem!==undefined}
   accessibilityHint={featherProblem} style={{alignSelf:"flex-start"}}
   onPress={()=>onModifySelection(buildModifySelection("feather",radii.feather,hasSelection))}/>
  {hasSelection?reason(featherProblem):null}
  {heading("Refine edge")}
  {radiusScrubber("smooth","Smooth radius")}
  <Button size="md" variant="secondary" title="Refine edge" unstyled={unstyled} disabled={refineProblem!==undefined}
   accessibilityHint={refineProblem} style={{alignSelf:"flex-start"}}
   onPress={()=>onRefineEdge?.({smooth:clampRadius(radii.smooth),feather:clampRadius(radii.feather)})}/>
  {reason(refineProblem)}
 </View>;
}

/** Props for {@linkcode MagicWandCanvas}. */
export interface MagicWandCanvasProps extends Omit<ViewProps,"children">,ScopedControlProps {
  settings:MagicWandSettings;
  /** Combine mode; Shift, Alt or both override it per click like the marquee. */
  mode:SelectionMode;
  /** Id sent as `sample: {layer}` when sampling the current layer. */
  currentLayerId?:string|number|undefined;
  width:number;
  height:number;
  documentWidth:number;
  documentHeight:number;
  /** Committed selection bounds, drawn as a dashed outline. */
  selectionBounds?:DocRect|undefined;
  /** Exactly once per click or keyboard Enter. Maps to `magicWand`. */
  onMagicWand:(request:MagicWandRequest,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Why the wand is unavailable; clicks then show this instead. */
  disabledReason?:string;
  children?:ReactNode;
  /** @default "Magic wand canvas" */
  label?:string;
  className?:string;
  unstyled?:boolean;
}
type WandLocal={cursor:DocPoint|null;notice:string|undefined;held:{shift:boolean;alt:boolean}};

/**
 * Click target for the magic wand over a host canvas. A click (not a drag)
 * sends one `magicWand` request at that document pixel. Keyboard: focus it,
 * press Enter for a crosshair at the middle, move it with the arrows (Alt for
 * ten times the step) and press Enter to select there; Escape cancels.
 */
export function MagicWandCanvas({scope='magic-wand',revision=0,...props}:MagicWandCanvasProps){
 validateWandSettings(props.settings);
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.settings,props.mode,props.currentLayerId,props.width,props.height,props.documentWidth,props.documentHeight]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <MagicWandCanvasBody key={owner} {...props} actionError={guard.error} {...(guard.pending?{disabledReason:'Selection change in progress'}:{})}
  onMagicWand={value=>guard.run('wand',(host,signal)=>host.onMagicWand(value,signal))}/>;
}
function MagicWandCanvasBody({
 settings,mode,currentLayerId,width,height,documentWidth,documentHeight,selectionBounds,onMagicWand,disabledReason,
 actionError=null,children,label="Magic wand canvas",className,unstyled=false,style,...rest
}:MagicWandCanvasProps&{actionError?:string|null}){
 validateWandSettings(settings);
 const mapping:ViewMapping={viewWidth:width,viewHeight:height,docWidth:documentWidth,docHeight:documentHeight};
 validateMapping(mapping);
 const blocked=disabledReason??wandProblem(settings,currentLayerId);
 const latest=useRef({settings,mode,currentLayerId,mapping,blocked,onMagicWand});
 useLayoutEffect(()=>{latest.current={settings,mode,currentLayerId,mapping,blocked,onMagicWand};});
 const local=useRef<StoreApi<WandLocal>|null>(null);
 if(!local.current)local.current=createStore<WandLocal>(()=>({cursor:null,notice:undefined,held:{shift:false,alt:false}}));
 const store=local.current;
 const cursor=useStore(store,s=>s.cursor);
 const notice=useStore(store,s=>s.notice);
 const surface=useRef<ComponentRef<typeof View>|null>(null);
 const press=useRef<{view:DocPoint;moved:boolean;mods:{shift:boolean;alt:boolean}}|null>(null);
 const styled=!unstyled;

 const fire=(at:DocPoint,mods:{shift:boolean;alt:boolean})=>{
  const p=latest.current;
  if(p.blocked!==undefined){store.setState({notice:p.blocked});return;}
  const m=modeFromModifiers(p.mode,mods);
  store.setState({notice:`Selected similar pixels at ${Math.round(at[0])}, ${Math.round(at[1])}`,cursor:null});
  p.onMagicWand(buildMagicWand(at[0],at[1],p.settings,m,p.currentLayerId));
 };
 const pan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
 if(!pan.current)pan.current=createCanvasResponder({
  onStartShouldSetPanResponder:(_e,g)=>latest.current.blocked===undefined&&g.numberActiveTouches<=1,onMoveShouldSetPanResponder:()=>false,
  onPanResponderGrant:(e:GestureResponderEvent)=>{
   (surface.current as unknown as {focus?:()=>void}|null)?.focus?.();
   const n=e.nativeEvent as {shiftKey?:boolean;altKey?:boolean;locationX:number;locationY:number};
   const held=store.getState().held;
   press.current={view:[n.locationX,n.locationY],moved:false,mods:{shift:!!n.shiftKey||held.shift,alt:!!n.altKey||held.alt}};
  },
  onPanResponderMove:(_e,g)=>{if(press.current&&(g.numberActiveTouches>1||Math.hypot(g.dx,g.dy)>6))press.current.moved=true;},
  onPanResponderRelease:()=>{
   const p=press.current;press.current=null;
   if(!p||p.moved)return;
   fire(viewToDoc(latest.current.mapping,p.view[0],p.view[1]),p.mods);
  },
  onPanResponderTerminate:()=>{press.current=null;},
 });
 const onKeyDown=(event:SelectionKey&{preventDefault?:()=>void;nativeEvent?:SelectionKey})=>{
  const e:SelectionKey=event.key!==undefined?event:event.nativeEvent??{};
  if(e.key==="Shift"||e.key==="Alt"){
   store.setState(s=>({held:{shift:s.held.shift||e.key==="Shift",alt:s.held.alt||e.key==="Alt"}}));return;
  }
  const c=store.getState().cursor;
  const {docWidth:dw,docHeight:dh}=latest.current.mapping;
  if(e.key==="Enter"){
   event.preventDefault?.();
   if(c)fire(c,{shift:!!e.shiftKey,alt:!!e.altKey});
   else if(latest.current.blocked!==undefined)store.setState({notice:latest.current.blocked});
   else store.setState({cursor:[Math.round(dw/2),Math.round(dh/2)],notice:"Move the crosshair with the arrow keys, then press Enter"});
   return;
  }
  if(e.key==="Escape"&&c){event.preventDefault?.();store.setState({cursor:null,notice:"Wand cancelled"});return;}
  if(!c)return;
  const step=KEYBOARD_STEP*(e.altKey?10:1);
  const d=e.key==="ArrowLeft"?[-step,0]:e.key==="ArrowRight"?[step,0]:e.key==="ArrowUp"?[0,-step]:e.key==="ArrowDown"?[0,step]:null;
  if(!d)return;
  event.preventDefault?.();
  const next:DocPoint=[Math.min(Math.max(c[0]+d[0]!,0),dw-1),Math.min(Math.max(c[1]+d[1]!,0),dh-1)];
  store.setState({cursor:next,notice:`Crosshair at ${next[0]}, ${next[1]}`});
 };
 const onKeyUp=(event:SelectionKey&{nativeEvent?:SelectionKey})=>{
  const k=event.key??event.nativeEvent?.key;
  if(k==="Shift"||k==="Alt")store.setState(s=>({held:{shift:k==="Shift"?false:s.held.shift,alt:k==="Alt"?false:s.held.alt}}));
 };
 const a11y=(name:string)=>{
  const key={activate:"Enter",escape:"Escape",moveLeft:"ArrowLeft",moveRight:"ArrowRight",moveUp:"ArrowUp",moveDown:"ArrowDown"}[name];
  if(key)onKeyDown({key});
 };
 const cv=cursor?docToView(mapping,cursor):null;
 return <View {...rest} {...{className:joinClasses("gap-2",className)}} style={[{maxWidth:"100%"},style]}>
  <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
  <View ref={surface} collapsable={false} {...pan.current.panHandlers}
   {...{onKeyDown,onKeyUp,focusable:true,
    className:joinClasses("overflow-hidden",styled&&"rounded-control border border-border focus-visible:ring-2 focus-visible:ring-focus")}}
   accessible accessibilityLabel={`${label}. ${describeWand(settings)}`}
   accessibilityHint={blocked??"Click to select similar pixels, or press Enter to aim with the keyboard."}
   accessibilityActions={cursor?[{name:"activate",label:"Select here"},{name:"escape",label:"Cancel"},
    {name:"moveLeft",label:"Move left"},{name:"moveRight",label:"Move right"},{name:"moveUp",label:"Move up"},{name:"moveDown",label:"Move down"}]
    :[{name:"activate",label:"Aim with the keyboard"}]}
   onAccessibilityAction={e=>a11y(e.nativeEvent.actionName)}
   style={{width,height,position:"relative",opacity:blocked!==undefined?0.6:1,
    ...(Platform.OS==="web"?{cursor:blocked?"not-allowed":"crosshair",userSelect:"none"} as object:null)}}>
   <View pointerEvents="none" style={{position:"absolute",left:0,top:0,width,height}}>{children}</View>
   {selectionBounds?<MarchingAnts rect={docRectToView(mapping,selectionBounds)} styled={styled} testID="wand-ants"/>:null}
   {cv?<Crosshair x={cv[0]} y={cv[1]} styled={styled}/>:null}
  </View>
  <Text aria-live="polite" accessibilityLiveRegion="polite" numberOfLines={2}
   {...{className:joinClasses(styled&&"text-xs",styled&&(blocked||notice?"text-text":"text-text-muted"))}}
   style={{maxWidth:width}}>{notice??blocked??"Click the canvas to select similar pixels. Shift adds, Alt subtracts."}</Text>
 </View>;
}
