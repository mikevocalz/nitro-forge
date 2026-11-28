import {useEffect,useLayoutEffect,useRef,type ComponentRef,type ReactNode} from "react";
import {PanResponder,Platform,Text,View,type GestureResponderEvent,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {Button} from "@nyc-tron/ui/components/Button";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {createCanvasResponder} from "@nyc-tron/ui/components/gestures/canvas-responder";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import type {Rect2D} from '@nyc-tron/ui/components/overlays/popover-position';
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {DraftBox,DraftPath,MarchingAnts} from "./selection-overlay.tsx";
import {
 LASSO_MAX_POINTS,SELECTION_MODES,SELECTION_TOOLS,appendLassoPoint,boxFromCorners,buildSelectRegion,closesPolygon,describeSelection,
 describeShape,docRectToView,docToView,initialKeyboardRect,modeFromModifiers,modeLabel,moveKeyboardRect,
 resizeKeyboardRect,resolveSelectionKey,toolHint,validateMapping,validateSelectionProps,viewToDoc,
 type DocPoint,type DocRect,type SelectRegionRequest,type SelectionKey,type SelectionMode,type SelectionShape,
 type SelectionTool,type ViewMapping,
} from "./selection-model.ts";

/** Props for {@linkcode SelectionMarquee}. The selection itself lives in the host's editor. */
export interface SelectionMarqueeProps extends Omit<ViewProps,"children"> {
 scope?:string;revision?:string|number;
 /** Canvas-local usable panes. The app positions its toolbar through its existing layout owner. */
 usableRegions?:readonly Rect2D[];
 renderToolbar?:(controls:ReactNode)=>ReactNode;
 /** The active marquee tool. */
 tool:SelectionTool;
 onToolChange:(tool:SelectionTool)=>void;
 /** The toolbar's combine mode. Shift, Alt or both override it for one gesture. */
 mode:SelectionMode;
 onModeChange:(mode:SelectionMode)=>void;
 /** Feather radius sent with each region, in document pixels (0..250). */
 feather:number;
 /** Size of the canvas surface in layout units. The host draws its canvas at this size. */
 width:number;
 height:number;
 /** Document size in pixels; regions are reported in document pixels. */
 documentWidth:number;
 documentHeight:number;
 /** Bounds of the committed selection (from the editor's `getSelection`), or `undefined` when empty. */
 selectionBounds?:DocRect|undefined;
 /** Exactly once per completed gesture or keyboard commit. Maps to `selectRegion`. */
 onSelectRegion:(request:SelectRegionRequest,signal?:AbortSignal)=>void|Promise<unknown>;
 /** The in-progress shape during a gesture, then `undefined` on commit or cancel. Never persist it. */
 onPreview?:(shape:SelectionShape|undefined)=>void;
 /** Maps to `selectAll`. */
 onSelectAll:(signal?:AbortSignal)=>void|Promise<unknown>;
 /** Maps to `deselect`. */
 onDeselect:(signal?:AbortSignal)=>void|Promise<unknown>;
 /** Maps to `invertSelection`. */
 onInvertSelection:(signal?:AbortSignal)=>void|Promise<unknown>;
 /**
  * Why selecting is unavailable right now (for example "The active layer is hidden").
  * The surface then refuses gestures and shows this text.
  */
 disabledReason?:string;
 /** The host's canvas, drawn under the marquee. */
 children?:ReactNode;
 /** @default "Selection" */
 label?:string;
 className?:string;
 unstyled?:boolean;
}

type Draft=
 |{kind:"box";a:DocPoint;b:DocPoint;mode:SelectionMode;shiftAtStart:boolean;constrain:boolean}
 |{kind:"lasso";points:readonly DocPoint[];mode:SelectionMode}
 |{kind:"polygon";points:readonly DocPoint[];mode:SelectionMode}
 |{kind:"keyboard";rect:DocRect};
type Local={draft:Draft|null;notice:string|undefined;held:{shift:boolean;alt:boolean}};
type Mods={shiftKey?:boolean;altKey?:boolean};

/**
 * Marquee selection over a host canvas (B-19): rectangle, ellipse, polygon
 * (click points; click the first point or press Enter to close) and freehand
 * lasso. Each gesture commits one `onSelectRegion` on release; Escape cancels.
 * Shift adds, Alt subtracts and Shift+Alt intersects for that gesture, and the
 * mode control does the same for touch. Shift pressed after a box drag starts
 * constrains it to a square or circle.
 *
 * Keyboard: focus the canvas and press Enter for a marquee over the middle of
 * the document, arrows to move it (Alt for ten times the step), Shift+arrows to
 * resize, Enter to select and Escape to cancel. Ctrl/Cmd+A, Ctrl/Cmd+D and
 * Ctrl/Cmd+Shift+I select all, deselect and invert. Canvas geometry stays
 * left-to-right in RTL layouts; the toolbar mirrors.
 */
export function SelectionMarquee({scope='selection',revision=0,...props}:SelectionMarqueeProps){
 validateSelectionProps({tool:props.tool,mode:props.mode,feather:props.feather,bounds:props.selectionBounds});
 validateMapping({viewWidth:props.width,viewHeight:props.height,docWidth:props.documentWidth,docHeight:props.documentHeight});
 const regions=props.usableRegions??[{x:0,y:0,width:props.width,height:props.height}];
 if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512||!(props.label??'Selection').trim()||(props.label??'Selection').length>512||props.disabledReason!==undefined&&(!props.disabledReason.trim()||props.disabledReason.length>1024)||regions.length>256||regions.some(r=>![r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<0||r.height<0||r.x+r.width>props.width||r.y+r.height>props.height))throw new RangeError('Invalid selection identity or usable panes');
 const usable=regions.filter(r=>r.width>0&&r.height>0),owner=JSON.stringify([scope,revision,props.tool,props.mode,props.feather,props.width,props.height,props.documentWidth,props.documentHeight,props.disabledReason,usable]),boundary=JSON.stringify([owner,props.selectionBounds]);
 const action=useOwnedAction(owner),pending=action.pending!==null,request=useRef<symbol|null>(null),committed=useRef<null|{boundary:string;pending:boolean;props:typeof props}>(null);
 useLayoutEffect(()=>{committed.current={boundary,pending,props};});useLayoutEffect(()=>{request.current=null;},[owner]);useLayoutEffect(()=>()=>{committed.current=null;},[]);
 const current=()=>{const p=committed.current;return p&&p.boundary===boundary&&!p.pending&&!request.current&&p.props.disabledReason===undefined?p.props:null;};
 const run=(name:string,operation:(p:typeof props,signal:AbortSignal)=>void|Promise<unknown>)=>{const p=current();if(!p)return;const token=Symbol();request.current=token;return action.run(name,signal=>operation(p,signal),undefined,{pendingForAsyncOnly:true}).finally(()=>{if(request.current===token)request.current=null;});};
 return <SelectionMarqueeBody key={owner} {...props} usableRegions={usable} pending={pending} actionError={action.error} {...(pending?{disabledReason:'Selection change in progress'}:{})}
  onToolChange={tool=>{const p=current();if(p)p.onToolChange(tool);}} onModeChange={mode=>{const p=current();if(p)p.onModeChange(mode);}}
  onPreview={shape=>current()?.onPreview?.(shape)} onSelectRegion={value=>run('region',(host,signal)=>host.onSelectRegion(value,signal))}
  onSelectAll={()=>run('all',(p,signal)=>p.onSelectAll(signal))} onDeselect={()=>run('clear',(p,signal)=>p.onDeselect(signal))} onInvertSelection={()=>run('invert',(p,signal)=>p.onInvertSelection(signal))}/>;
}

function SelectionMarqueeBody({
 usableRegions,renderToolbar,pending=false,actionError=null,tool,onToolChange,mode,onModeChange,feather,width,height,documentWidth,documentHeight,selectionBounds,
 onSelectRegion,onPreview,onSelectAll,onDeselect,onInvertSelection,disabledReason,children,label="Selection",
 className,unstyled=false,style,...rest
}:SelectionMarqueeProps&{pending?:boolean;actionError?:string|null}){
 validateSelectionProps({tool,mode,feather,bounds:selectionBounds});
 const mapping:ViewMapping={viewWidth:width,viewHeight:height,docWidth:documentWidth,docHeight:documentHeight};
 validateMapping(mapping);
 const regions=usableRegions??[{x:0,y:0,width,height}];
 const latest=useRef({tool,mode,feather,mapping,regions,disabledReason,onSelectRegion,onPreview});
 useLayoutEffect(()=>{latest.current={tool,mode,feather,mapping,regions,disabledReason,onSelectRegion,onPreview};});
 const local=useRef<StoreApi<Local>|null>(null);
 if(!local.current)local.current=createStore<Local>(()=>({draft:null,notice:undefined,held:{shift:false,alt:false}}));
 const store=local.current;
 const draft=useStore(store,s=>s.draft);
 const notice=useStore(store,s=>s.notice);
 const surface=useRef<ComponentRef<typeof View>|null>(null);
 const gesture=useRef<{start:DocPoint;startView:DocPoint;moved:boolean;cancelled:boolean;pane:Rect2D}|null>(null);
 const styled=!unstyled;

 const shapeOf=(d:Draft):SelectionShape=>{
  if(d.kind==="box"){
   const r=boxFromCorners(d.a,d.b,d.constrain);
   return {kind:latest.current.tool==="ellipse"?"ellipse":"rect",...r};
  }
  if(d.kind==="keyboard")return {kind:latest.current.tool==="ellipse"?"ellipse":"rect",...d.rect};
  return {kind:"polygon",points:d.points};
 };
 const setDraft=(d:Draft|null)=>{
  store.setState({draft:d});
  latest.current.onPreview?.(d?shapeOf(d):undefined);
 };
 const cancel=()=>{
  if(gesture.current)gesture.current.cancelled=true;
  if(store.getState().draft)setDraft(null);
 };
 const commit=(d:Draft,modeOverride?:SelectionMode)=>{
  const p=latest.current;
  const m=modeOverride??(d.kind==="keyboard"?p.mode:d.mode);
  const request=buildSelectRegion(shapeOf(d),m,p.feather);
  setDraft(null);
  if(!request){store.setState({notice:d.kind==="polygon"?"A polygon needs at least three points":"The selection is too small"});return;}
  store.setState({notice:undefined});
  p.onSelectRegion(request);
 };
 const modsFrom=(e:Mods|undefined)=>{
  const held=store.getState().held;
  return {shift:!!e?.shiftKey||held.shift,alt:!!e?.altKey||held.alt};
 };
 const viewPoint=(e:GestureResponderEvent):DocPoint=>[e.nativeEvent.locationX,e.nativeEvent.locationY];

 // A tool change abandons a half-drawn polygon or keyboard marquee.
 useEffect(()=>{if(store.getState().draft)cancel();},[tool]);
 useEffect(()=>()=>{if(store.getState().draft)latest.current.onPreview?.(undefined);},[]);

 const pan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
 if(!pan.current)pan.current=createCanvasResponder({
  onStartShouldSetPanResponder:(event,state)=>{const p=latest.current,v=viewPoint(event);return p.disabledReason===undefined&&state.numberActiveTouches<=1&&p.regions.some(r=>v[0]>=r.x&&v[1]>=r.y&&v[0]<=r.x+r.width&&v[1]<=r.y+r.height);},onMoveShouldSetPanResponder:()=>false,
  onPanResponderTerminationRequest:()=>false,
  onPanResponderGrant:e=>{
   const p=latest.current;
   (surface.current as unknown as {focus?:()=>void}|null)?.focus?.();
   if(p.disabledReason!==undefined){store.setState({notice:p.disabledReason});gesture.current=null;return;}
   const v=viewPoint(e);
   const pane=p.regions.find(r=>v[0]>=r.x&&v[1]>=r.y&&v[0]<=r.x+r.width&&v[1]<=r.y+r.height);if(!pane){gesture.current=null;return;}
   const start=viewToDoc(p.mapping,v[0],v[1]);
   gesture.current={start,startView:v,moved:false,cancelled:false,pane};
   const mods=modsFrom(e.nativeEvent as Mods);
   const m=modeFromModifiers(p.mode,mods);
   const d=store.getState().draft;
   if(p.tool==="polygon")return;
   if(d?.kind==="keyboard")setDraft(null);
   if(p.tool==="lasso")setDraft({kind:"lasso",points:[start],mode:m});
   else setDraft({kind:"box",a:start,b:start,mode:m,shiftAtStart:mods.shift,constrain:false});
  },
  onPanResponderMove:(e,g)=>{
   const gs=gesture.current;
   if(!gs||gs.cancelled)return;
   if(g.numberActiveTouches>1){cancel();return;}
   if(Math.hypot(g.dx,g.dy)>4)gs.moved=true;
   const p=latest.current;
   const x=gs.startView[0]+g.dx,y=gs.startView[1]+g.dy;if(x<gs.pane.x||y<gs.pane.y||x>gs.pane.x+gs.pane.width||y>gs.pane.y+gs.pane.height){cancel();return;}
   const at=viewToDoc(p.mapping,x,y);
   const d=store.getState().draft;
   if(d?.kind==="box"){
    const shift=!!(e.nativeEvent as Mods).shiftKey||store.getState().held.shift;
    setDraft({...d,b:at,constrain:shift&&!d.shiftAtStart});
   }else if(d?.kind==="lasso"){
    const next=appendLassoPoint(d.points,at);
    if(next!==d.points)setDraft({...d,points:next});
   }
  },
  onPanResponderRelease:(e,g)=>{
   const gs=gesture.current;
   gesture.current=null;
   if(!gs||gs.cancelled)return;
   const p=latest.current;
   const d=store.getState().draft;
   const x=gs.startView[0]+g.dx,y=gs.startView[1]+g.dy;
   if(x<gs.pane.x||y<gs.pane.y||x>gs.pane.x+gs.pane.width||y>gs.pane.y+gs.pane.height){cancel();return;}
   if(p.tool==="polygon"){
    if(gs.moved)return;
    const v:DocPoint=[gs.startView[0]+g.dx,gs.startView[1]+g.dy];
    const at=viewToDoc(p.mapping,v[0],v[1]);
    if(d?.kind==="polygon"){
     const viewPts=d.points.map(pt=>docToView(p.mapping,pt));
     if(closesPolygon(viewPts,v)){commit(d);return;}
     if(d.points.length>=LASSO_MAX_POINTS){store.setState({notice:"Polygon point limit reached"});return;}
     setDraft({...d,points:[...d.points,at]});
    }else{
     setDraft({kind:"polygon",points:[at],mode:modeFromModifiers(p.mode,modsFrom(e.nativeEvent as Mods))});
    }
    store.setState({notice:undefined});
    return;
   }
   if(d?.kind==="box")commit({...d,b:viewToDoc(p.mapping,x,y),constrain:(!!(e.nativeEvent as Mods).shiftKey||store.getState().held.shift)&&!d.shiftAtStart});
   else if(d?.kind==="lasso")commit({...d,points:appendLassoPoint(d.points,viewToDoc(p.mapping,x,y),0)});
  },
  onPanResponderTerminate:()=>{gesture.current=null;cancel();},
 });

 const onKeyDown=(event:SelectionKey&{preventDefault?:()=>void;nativeEvent?:SelectionKey})=>{
  const e:SelectionKey=event.key!==undefined?event:event.nativeEvent??{};
  if(e.key==="Shift"||e.key==="Alt"){
   store.setState(s=>({held:{shift:s.held.shift||e.key==="Shift",alt:s.held.alt||e.key==="Alt"}}));
   return;
  }
  const command=resolveSelectionKey(e);
  if(!command)return;
  const p=latest.current;
  const d=store.getState().draft;
  const {docWidth:dw,docHeight:dh}=p.mapping;
  const consume=()=>event.preventDefault?.();
  if(p.disabledReason!==undefined&&command.type!=="cancel"){consume();store.setState({notice:p.disabledReason});return;}
  switch(command.type){
   case "selectAll":consume();cancel();onSelectAll();return;
   case "deselect":consume();cancel();
    if(selectionBounds)onDeselect();else store.setState({notice:"Nothing is selected"});
    return;
   case "invert":consume();cancel();onInvertSelection();return;
   case "cancel":if(d){consume();cancel();store.setState({notice:"Selection cancelled"});}return;
   case "undoPoint":
    if(d?.kind==="polygon"){consume();setDraft(d.points.length>1?{...d,points:d.points.slice(0,-1)}:null);}
    return;
   case "commit":
    consume();
    if(d?.kind==="polygon"){commit(d);return;}
    if(d?.kind==="keyboard"){commit(d,modeFromModifiers(p.mode,modsFrom(e)));return;}
    if(!d){setDraft({kind:"keyboard",rect:initialKeyboardRect(dw,dh)});store.setState({notice:undefined});}
    return;
   case "move":
    if(d?.kind!=="keyboard")return;
    consume();setDraft({kind:"keyboard",rect:moveKeyboardRect(d.rect,command.dx,command.dy,dw,dh)});return;
   case "resize":
    if(d?.kind!=="keyboard")return;
    consume();setDraft({kind:"keyboard",rect:resizeKeyboardRect(d.rect,command.dw,command.dh,dw,dh)});return;
   default:return;
  }
 };
 const onKeyUp=(event:SelectionKey&{nativeEvent?:SelectionKey})=>{
  const k=event.key??event.nativeEvent?.key;
  if(k==="Shift"||k==="Alt")store.setState(s=>({held:{shift:k==="Shift"?false:s.held.shift,alt:k==="Alt"?false:s.held.alt}}));
 };
 const a11yAction=(name:string)=>{
  const d=store.getState().draft;
  const key={activate:"Enter",escape:"Escape",moveLeft:"ArrowLeft",moveRight:"ArrowRight",moveUp:"ArrowUp",
   moveDown:"ArrowDown",increment:"ArrowRight",decrement:"ArrowLeft"}[name];
  if(name==="grow"&&d?.kind==="keyboard"){onKeyDown({key:"ArrowRight",shiftKey:true});onKeyDown({key:"ArrowDown",shiftKey:true});return;}
  if(name==="shrink"&&d?.kind==="keyboard"){onKeyDown({key:"ArrowLeft",shiftKey:true});onKeyDown({key:"ArrowUp",shiftKey:true});return;}
  if(key)onKeyDown({key});
 };

 const viewDraft=draft?shapeOf(draft):undefined;
 const viewRect=(r:DocRect)=>docRectToView(mapping,r);
 const keyboardActive=draft?.kind==="keyboard";
 const status=notice??(draft?`${describeShape(shapeOf(draft))}, ${modeLabel(draft.kind==="keyboard"?mode:draft.mode)}`
  :disabledReason??toolHint(tool));

 const controls=<>
  <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"center"}}>
   <SegmentedControl disabled={disabledReason!==undefined} aria-label="Selection tool" value={tool} unstyled={unstyled}
    options={SELECTION_TOOLS.map(t=>({value:t.tool,label:t.label}))} onChange={onToolChange}/>
   <SegmentedControl disabled={disabledReason!==undefined} aria-label="Selection mode" value={mode} unstyled={unstyled}
    options={SELECTION_MODES.map(m=>({value:m.mode,label:m.label}))} onChange={onModeChange}/>
  </View>
  <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"center"}}>
   <Button size="sm" variant="secondary" title="Select all" unstyled={unstyled}
    disabled={disabledReason!==undefined} onPress={()=>{cancel();onSelectAll();}}/>
   <Button size="sm" variant="secondary" title="Deselect" unstyled={unstyled}
    disabled={!selectionBounds||disabledReason!==undefined}
    accessibilityHint={selectionBounds?undefined:"Nothing is selected"} onPress={()=>{cancel();onDeselect();}}/>
   <Button size="sm" variant="secondary" title="Invert" unstyled={unstyled}
    disabled={disabledReason!==undefined} onPress={()=>{cancel();onInvertSelection();}}/>
   {!selectionBounds?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>Nothing is selected</Text>:null}
  </View>
 </>;
 return <View {...rest} {...{className:joinClasses("gap-2",className)}} style={[{maxWidth:"100%"},style]}>
  {renderToolbar?renderToolbar(controls):controls}
  {pending?<Text accessibilityLiveRegion="polite">Selection change in progress</Text>:null}
  <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
  <View ref={surface} collapsable={false} {...pan.current.panHandlers}
   {...{onKeyDown,onKeyUp,focusable:true,
    className:joinClasses("overflow-hidden",styled&&"rounded-control border border-border focus-visible:ring-2 focus-visible:ring-focus")}}
   accessible accessibilityLabel={`${label} canvas, ${describeSelection(selectionBounds)}`}
   accessibilityHint={keyboardActive?"Arrows move the marquee, Shift and arrows resize it, Enter selects, Escape cancels.":
    "Press Enter for a keyboard marquee. "+toolHint(tool)}
   accessibilityActions={keyboardActive?[
    {name:"activate",label:"Select this area"},{name:"escape",label:"Cancel"},
    {name:"moveLeft",label:"Move left"},{name:"moveRight",label:"Move right"},
    {name:"moveUp",label:"Move up"},{name:"moveDown",label:"Move down"},
    {name:"grow",label:"Enlarge"},{name:"shrink",label:"Shrink"},
   ]:[{name:"activate",label:"Start keyboard marquee"}]}
   onAccessibilityAction={e=>a11yAction(e.nativeEvent.actionName)}
   style={{width,height,position:"relative",...(Platform.OS==="web"?{cursor:disabledReason?"not-allowed":"crosshair",userSelect:"none"} as object:null),
    opacity:disabledReason!==undefined?0.6:1}}>
   <View pointerEvents="none" style={{position:"absolute",left:0,top:0,width,height}}>{children}</View>
   {regions.map((region,index)=><View key={index} pointerEvents="none" style={{position:'absolute',left:region.x,top:region.y,width:region.width,height:region.height,overflow:'hidden'}}><View pointerEvents="none" style={{position:'absolute',left:-region.x,top:-region.y,width,height}}>
   {selectionBounds?<MarchingAnts rect={viewRect(selectionBounds)} styled={styled} testID="selection-ants"/>:null}
   {viewDraft&&viewDraft.kind!=="polygon"?<DraftBox rect={viewRect(viewDraft)} ellipse={viewDraft.kind==="ellipse"} styled={styled}/>:null}
   {viewDraft?.kind==="polygon"?<DraftPath points={viewDraft.points.map(pt=>docToView(mapping,pt))}
    closed={draft?.kind==="lasso"} vertices={draft?.kind==="polygon"} closable={viewDraft.points.length>=3} styled={styled}/>:null}
   </View></View>)}
  </View>
  <Text aria-live="polite" accessibilityLiveRegion="polite" numberOfLines={2}
   {...{className:joinClasses(styled&&"text-xs",styled&&(notice||disabledReason?"text-text":"text-text-muted"))}}
   style={{fontVariant:["tabular-nums"],maxWidth:width}}>{status}</Text>
 </View>;
}
