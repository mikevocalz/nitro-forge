/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/ReferenceUi.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (the reference window: a
 * title bar that drags it, a close button, a bottom corner handle that sizes it,
 * and an "Import" call to action when it has no picture).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Compose to a controlled
 * React Native component on theme tokens; several host-owned references with
 * fit/crop, opacity, lock, pin and float/side/overlay placement; keyboard moves.
 */
import {useEffect,useLayoutEffect,useRef,type ReactNode} from "react";
import {PanResponder,Platform,Pressable,ScrollView,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {Button} from "@nyc-tron/ui/components/Button";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {SwitchRow} from "../selection/switch-row.tsx";
import {
 REFERENCE_BAR_HEIGHT,REFERENCE_FITS,REFERENCE_PLACEMENTS,clampFrame,formatReferenceOpacity,moveFrame,pictureRect,
 referenceA11yLabel,referenceEditProblem,resizeFrame,resolveReferenceKey,stepReferenceOpacity,validateReferences,
 type BoardRect,type ReferenceEdit,type ReferenceFit,type ReferenceImage,type ReferencePatch,type ReferencePlacement,
} from "./reference-board-model.ts";
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";

/** Props for {@linkcode ReferenceImageBoard}. The reference list is host state, kept apart from the document. */
export interface ReferenceImageBoardProps extends Omit<ViewProps,"children">,ScopedControlProps {
 references:readonly ReferenceImage[];
 /** The reference whose settings the inspector shows. */
 selectedId?:string|undefined;
 onSelect:(id:string)=>void;
 /** One call per drag release, key press or control change. */
 onUpdate:(id:string,patch:ReferencePatch,signal?:AbortSignal)=>void|Promise<unknown>;
 /** The frame drawn during a drag, then `undefined` on release or cancel. */
 onPreview?:(id:string,frame:BoardRect|undefined)=>void;
 /** Ask the host to pick an image and add it. */
 onAdd:(signal?:AbortSignal)=>void|Promise<unknown>;
 onRemove:(id:string,signal?:AbortSignal)=>void|Promise<unknown>;
 /** Draws a reference's picture. The node should fill its parent; the board sizes and clips it. */
 renderImage:(reference:ReferenceImage)=>ReactNode;
 /** Board (canvas area) size in layout units. Floating windows stay inside it. */
 width:number;
 height:number;
 /**
  * Width of the side column that holds `side` references.
  * @default 168
  */
 sideWidth?:number;
 /** The host's canvas, drawn under overlays and floating windows. */
 children?:ReactNode;
 /** @default "Reference images" */
 label?:string;
 className?:string;
 unstyled?:boolean;
}

type Local={preview:{id:string;frame:BoardRect}|null;notice:string|undefined};

/**
 * Reference images (B-31) pinned beside or floating over the canvas, or laid
 * over it for tracing. Floating windows drag by their title bar and size from
 * the bottom-right grip; one `onUpdate` per release. A focused window moves with
 * the arrows (Alt for ten times the step), resizes with Shift+arrows and is removed
 * with Delete; Escape cancels a drag. Locked references refuse every change and
 * pinned ones refuse moving, each saying why. Overlays never take pointer input,
 * so drawing reaches the canvas under them.
 */
export function ReferenceImageBoard({scope='reference-board',revision=0,...props}:ReferenceImageBoardProps&{actionError?:string|null;busy?:boolean}){
 validateReferences(props.references,props.selectedId);
 if(![props.width,props.height,props.sideWidth??168].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('Invalid reference board dimensions');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.width,props.height,props.references.map(r=>[r.id,r.locked,r.pinned,r.placement])]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <ReferenceImageBoardBody key={owner} {...props} actionError={guard.error} busy={guard.pending}
  onSelect={id=>guard.current()?.onSelect(id)} onPreview={(id,frame)=>guard.current()?.onPreview?.(id,frame)}
  onUpdate={(id,patch)=>guard.run('update',(host,signal)=>host.onUpdate(id,patch,signal))}
  onAdd={()=>guard.run('add',(host,signal)=>host.onAdd(signal))} onRemove={id=>guard.run('remove',(host,signal)=>host.onRemove(id,signal))}/>;
}
function ReferenceImageBoardBody({
 references,selectedId,onSelect,onUpdate,onPreview,onAdd,onRemove,renderImage,width,height,sideWidth=168,children,
 actionError=null,busy=false,disabledReason,label="Reference images",className,unstyled=false,style,...rest
}:ReferenceImageBoardProps&{actionError?:string|null;busy?:boolean}){
 validateReferences(references,selectedId);
 const styled=!unstyled;
 const latest=useRef({references,width,height,onUpdate,onPreview,onRemove,onSelect});
 useLayoutEffect(()=>{latest.current={references,width,height,onUpdate,onPreview,onRemove,onSelect};});
 const local=useRef<StoreApi<Local>|null>(null);
 if(!local.current)local.current=createStore<Local>(()=>({preview:null,notice:undefined}));
 const store=local.current;
 const preview=useStore(store,s=>s.preview);
 const notice=useStore(store,s=>s.notice);
 useEffect(()=>()=>{const p=store.getState().preview;if(p)latest.current.onPreview?.(p.id,undefined);},[store]);

 const find=(id:string)=>latest.current.references.find(r=>r.id===id);
 const refuse=(ref:ReferenceImage,edit:ReferenceEdit)=>{
  const problem=disabledReason??(busy?"Reference change in progress":referenceEditProblem(ref,edit));
  if(problem)store.setState({notice:problem});
  return problem!==undefined;
 };
 const update=(ref:ReferenceImage,edit:ReferenceEdit,patch:ReferencePatch)=>{
  if(refuse(ref,edit))return;
  store.setState({notice:undefined});
  latest.current.onUpdate(ref.id,patch);
 };
 const remove=(ref:ReferenceImage)=>{
  if(refuse(ref,"remove"))return;
  store.setState({notice:`${ref.label} removed`});
  latest.current.onRemove(ref.id);
 };
 const showPreview=(id:string,frame:BoardRect)=>{store.setState({preview:{id,frame}});latest.current.onPreview?.(id,frame);};
 const cancelPreview=()=>{
  const p=store.getState().preview;
  if(!p)return;
  store.setState({preview:null});
  latest.current.onPreview?.(p.id,undefined);
 };
 const commitPreview=()=>{
  const p=store.getState().preview;
  if(!p)return;
  store.setState({preview:null});
  latest.current.onPreview?.(p.id,undefined);
  const ref=find(p.id);
  if(!ref||refuse(ref,"move"))return;
  const {x,y,width:w,height:h}=p.frame;
  if(x!==ref.x||y!==ref.y||w!==ref.width||h!==ref.height)latest.current.onUpdate(ref.id,{x,y,width:w,height:h});
 };
 const onWindowKey=(ref:ReferenceImage)=>(event:{key?:string;shiftKey?:boolean;altKey?:boolean;preventDefault?:()=>void;nativeEvent?:{key?:string}})=>{
  const command=resolveReferenceKey({...event,key:event.key??event.nativeEvent?.key});
  if(!command)return;
  if(command.type==="cancel"){if(store.getState().preview){event.preventDefault?.();cancelPreview();store.setState({notice:"Move cancelled"});}return;}
  event.preventDefault?.();
  if(command.type==="remove"){remove(ref);return;}
  const {width:bw,height:bh}=latest.current;
  const frame=command.type==="move"?moveFrame(ref,command.dx,command.dy,bw,bh):resizeFrame(ref,command.dw,command.dh,bw,bh);
  update(ref,command.type,{x:frame.x,y:frame.y,width:frame.width,height:frame.height});
 };

 const floating=references.filter(r=>r.placement==="float");
 const side=references.filter(r=>r.placement==="side");
 const overlays=references.filter(r=>r.placement==="overlay");
 const selected=references.find(r=>r.id===selectedId);
 const picture=(ref:ReferenceImage,frameW:number,frameH:number)=>{
  const p=pictureRect(ref.fit,frameW,frameH,ref.imageWidth,ref.imageHeight);
  return <View pointerEvents="none" style={{position:"absolute",left:p.x,top:p.y,width:p.width,height:p.height}}>{renderImage(ref)}</View>;
 };

 return <View {...rest} role="group" aria-label={label} {...{className:joinClasses("gap-3",className)}} style={[{maxWidth:"100%"},style]}>
  <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
  {disabledReason||busy?<Text accessibilityLiveRegion="polite">{disabledReason??"Reference change in progress"}</Text>:null}
  <View style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.fixedInset,alignItems:"flex-start"}}>
   <View testID="reference-board" {...{className:joinClasses("overflow-hidden",styled&&"rounded-control border border-border")}}
    style={{width,height,position:"relative"}}>
    <View pointerEvents="none" style={{position:"absolute",left:0,top:0,width,height}}>{children}</View>
    {overlays.map(ref=><View key={ref.id} pointerEvents="none" importantForAccessibility="no-hide-descendants"
     accessibilityElementsHidden style={{position:"absolute",left:0,top:0,width,height,opacity:ref.opacity,overflow:"hidden"}}>
     {picture(ref,width,height)}
    </View>)}
    {floating.map(ref=>{
     const frame=preview?.id===ref.id?preview.frame:clampFrame(ref,width,height);
     return <FloatingWindow key={ref.id} reference={ref} frame={frame} selected={ref.id===selectedId} styled={styled}
      picture={picture(ref,frame.width,frame.height-REFERENCE_BAR_HEIGHT)}
      onSelect={()=>{store.setState({notice:undefined});onSelect(ref.id);}}
      onKeyDown={onWindowKey(ref)}
      onRemove={()=>remove(ref)}
      onDrag={(kind,dx,dy)=>{
       const live=find(ref.id);
       if(!live||refuse(live,kind))return false;
       const base=clampFrame(live,latest.current.width,latest.current.height);
       showPreview(ref.id,kind==="move"?moveFrame(base,dx,dy,latest.current.width,latest.current.height)
        :resizeFrame(base,dx,dy,latest.current.width,latest.current.height));
       return true;
      }}
      onRelease={commitPreview} onCancel={cancelPreview}/>;
    })}
   </View>
   {side.length>0?<View testID="reference-side" {...{className:joinClasses("overflow-hidden",styled&&"rounded-control border border-border bg-surface-raised")}}
    style={{width:sideWidth,maxHeight:height}}><ScrollView contentContainerStyle={{paddingVertical:tokens.spacing.off2}}>
    {side.map(ref=><Pressable key={ref.id} role="button" aria-label={referenceA11yLabel(ref)}
     aria-selected={ref.id===selectedId} onPress={()=>onSelect(ref.id)} {...{onKeyDown:onWindowKey(ref)}}
     {...{className:joinClasses(styled&&"rounded-control border-2 focus-visible:ring-2 focus-visible:ring-focus",
      styled&&(ref.id===selectedId?"border-accent":"border-transparent"))}}
     style={{margin:tokens.spacing.off6,height:Math.round((sideWidth-12)*0.75),overflow:"hidden",position:"relative",opacity:ref.opacity}}>
     {picture(ref,sideWidth-16,Math.round((sideWidth-12)*0.75)-4)}
    </Pressable>)}
   </ScrollView></View>:null}
  </View>
  {references.length===0?<View style={{gap:tokens.spacing.fixedElement,alignItems:"flex-start"}}>
   <Text {...{className:joinClasses(styled&&"text-text text-sm")}}>No reference images yet. Add one to keep it beside your canvas.</Text>
   <Button title="Add reference image" unstyled={unstyled} onPress={()=>onAdd()}/>
  </View>:<Inspector reference={selected} styled={styled} unstyled={unstyled}
   onAdd={onAdd} onRemove={()=>selected&&remove(selected)}
   onChange={(edit,patch)=>selected&&update(selected,edit,patch)}
   onToggleLock={()=>{if(selected){store.setState({notice:undefined});onUpdate(selected.id,{locked:!selected.locked});}}}/>}
  <Text aria-live="polite" accessibilityLiveRegion="polite" numberOfLines={2}
   {...{className:joinClasses(styled&&"text-text text-xs")}} style={notice?undefined:{height:0,overflow:"hidden"}}>{notice??""}</Text>
 </View>;
}

function FloatingWindow({reference:ref,frame,selected,styled,picture,onSelect,onKeyDown,onRemove,onDrag,onRelease,onCancel}:{
 reference:ReferenceImage;frame:BoardRect;selected:boolean;styled:boolean;picture:ReactNode;
 onSelect:()=>void;onKeyDown:(e:{key?:string;shiftKey?:boolean;altKey?:boolean;preventDefault?:()=>void;nativeEvent?:{key?:string}})=>void;onRemove:()=>void;
 onDrag:(kind:"move"|"resize",dx:number,dy:number)=>boolean;onRelease:()=>void;onCancel:()=>void;
}){
 const latest=useRef({onSelect,onDrag,onRelease,onCancel});
 latest.current={onSelect,onDrag,onRelease,onCancel};
 const responder=(kind:"move"|"resize")=>{
  let live=false;
  return PanResponder.create({
   onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,
   onPanResponderTerminationRequest:()=>false,
   onPanResponderGrant:()=>{live=true;latest.current.onSelect();},
   onPanResponderMove:(_e,g)=>{
    if(!live)return;
    if(g.numberActiveTouches>1){live=false;latest.current.onCancel();return;}
    if(Math.hypot(g.dx,g.dy)<3)return;
    if(!latest.current.onDrag(kind,g.dx,g.dy))live=false;
   },
   onPanResponderRelease:()=>{if(live)latest.current.onRelease();live=false;},
   onPanResponderTerminate:()=>{live=false;latest.current.onCancel();},
  });
 };
 const handlers=useRef<{bar:ReturnType<typeof PanResponder.create>;grip:ReturnType<typeof PanResponder.create>}|null>(null);
 if(!handlers.current)handlers.current={bar:responder("move"),grip:responder("resize")};
 const bar={current:handlers.current.bar},grip={current:handlers.current.grip};
 const stuck=ref.locked||ref.pinned;
 const web=Platform.OS==="web";
 return <View testID={"reference-window-"+ref.id} accessible role="group" aria-label={referenceA11yLabel(ref)}
  accessibilityHint={stuck?undefined:"Arrows move, Shift and arrows resize, Delete removes."}
  {...{onKeyDown,focusable:true,className:joinClasses("overflow-hidden",
   styled&&"rounded-card border-2 bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus",styled&&(selected?"border-accent":"border-border"))}}
  style={{position:"absolute",left:frame.x,top:frame.y,width:frame.width,height:frame.height}}>
  <View {...bar.current.panHandlers} testID={"reference-bar-"+ref.id}
   {...{className:joinClasses(styled&&"bg-surface-sunken border-b border-border")}}
   style={{height:REFERENCE_BAR_HEIGHT,flexDirection:"row",alignItems:"center",paddingStart:12,gap:tokens.spacing.off6,
    ...(web?{cursor:stuck?"default":"move",userSelect:"none",touchAction:"none"} as object:null)}}>
   <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}} style={{flex:1,minWidth:0}}>
    {ref.label}</Text>
   {ref.pinned||ref.locked?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>
    {ref.locked?"Locked":"Pinned"}</Text>:null}
   <Pressable role="button" aria-label={ref.locked?`Remove ${ref.label}, unavailable`:`Remove ${ref.label}`}
    onPress={onRemove} {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
    style={{width:tokens.spacing.fixedTarget,height:tokens.spacing.fixedTarget,alignItems:"center",justifyContent:"center",opacity:ref.locked?tokens.opacity.disabled:1}}>
    <View pointerEvents="none" style={{width:tokens.spacing.off14,height:tokens.spacing.off14}}>
     <View {...{className:joinClasses(styled&&"bg-text")}} style={{position:"absolute",left:tokens.spacing.off6,top:-tokens.spacing.off2,width:tokens.spacing.off2,height:tokens.spacing.off18,transform:[{rotate:"45deg"}]}}/>
     <View {...{className:joinClasses(styled&&"bg-text")}} style={{position:"absolute",left:tokens.spacing.off6,top:-tokens.spacing.off2,width:tokens.spacing.off2,height:tokens.spacing.off18,transform:[{rotate:"-45deg"}]}}/>
    </View>
   </Pressable>
  </View>
  <Pressable onPress={onSelect} accessible={false} style={{flex:1,overflow:"hidden",position:"relative",opacity:ref.opacity}}>
   {picture}
  </Pressable>
  {/* Resize grip: drag-only (keyboard and screen readers resize with Shift+arrows). */}
  <View {...grip.current.panHandlers} testID={"reference-grip-"+ref.id}
   importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
   style={{position:"absolute",right:0,bottom:0,width:tokens.spacing.fixedTarget,height:tokens.spacing.fixedTarget,alignItems:"flex-end",justifyContent:"flex-end",padding:tokens.spacing.off6,
    ...(web?{cursor:stuck?"default":"nwse-resize",touchAction:"none"} as object:null)}}>
   <View pointerEvents="none" {...{className:joinClasses(styled&&"border-text-muted")}}
    style={{width:tokens.spacing.fixedInset,height:tokens.spacing.fixedInset,borderRightWidth:tokens.borderWidth.strong,borderBottomWidth:tokens.borderWidth.strong,opacity:stuck?controlTokens.opacity.faint:1}}/>
  </View>
 </View>;
}

function Inspector({reference:ref,styled,unstyled,onAdd,onRemove,onChange,onToggleLock}:{
 reference:ReferenceImage|undefined;styled:boolean;unstyled:boolean;onAdd:(signal?:AbortSignal)=>void|Promise<unknown>;onRemove:()=>void;
 onChange:(edit:ReferenceEdit,patch:ReferencePatch)=>void;onToggleLock:()=>void;
}){
 if(!ref)return <View style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.fixedElement,alignItems:"center"}}>
  <Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{flexShrink:1}}>Select a reference to change it.</Text>
  <Button title="Add reference image" variant="secondary" unstyled={unstyled} onPress={()=>onAdd()}/>
 </View>;
 const lockedReason=ref.locked?`${ref.label} is locked. Unlock it to change it.`:undefined;
 const step=(d:-1|1)=>{
  const next=stepReferenceOpacity(ref.opacity,d);
  if(next!==ref.opacity)onChange("opacity",{opacity:next});
 };
 return <View role="group" aria-label={`${ref.label} settings`}
  {...{className:joinClasses("gap-2",styled&&"rounded-card border border-border bg-surface-raised p-3")}}>
  <Text role="heading" aria-level={3} numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>{ref.label}</Text>
  <View style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.fixedElement,alignItems:"center"}}>
   <SegmentedControl aria-label="Placement" value={ref.placement} disabled={ref.locked} unstyled={unstyled}
    options={REFERENCE_PLACEMENTS} onChange={(placement:ReferencePlacement)=>onChange("placement",{placement})}/>
   <SegmentedControl aria-label="Fit" value={ref.fit} disabled={ref.locked} unstyled={unstyled}
    options={REFERENCE_FITS} onChange={(fit:ReferenceFit)=>onChange("fit",{fit})}/>
  </View>
  <View style={{flexDirection:"row",alignItems:"center",gap:tokens.spacing.fixedStack}}
   {...{className:joinClasses(styled&&"self-start rounded-control bg-surface-sunken")}}>
   <StepButton label="Decrease opacity" text="−" styled={styled} onPress={()=>step(-1)}/>
   <View accessible accessibilityRole="adjustable" aria-label="Opacity" aria-valuetext={formatReferenceOpacity(ref.opacity)}
    aria-valuenow={Math.round(ref.opacity*100)} aria-valuemin={10} aria-valuemax={100}
    accessibilityActions={[{name:"increment",label:"Increase"},{name:"decrement",label:"Decrease"}]}
    onAccessibilityAction={e=>step(e.nativeEvent.actionName==="increment"?1:-1)}
    style={{minWidth:tokens.spacing.off96,minHeight:tokens.spacing.fixedTarget,alignItems:"center",justifyContent:"center"}}>
    <Text {...{className:joinClasses(styled&&"text-text text-sm")}} style={{fontVariant:["tabular-nums"]}}>
     Opacity {formatReferenceOpacity(ref.opacity)}</Text>
   </View>
   <StepButton label="Increase opacity" text="+" styled={styled} onPress={()=>step(1)}/>
  </View>
  <SwitchRow label="Pin in place" unstyled={unstyled} value={ref.pinned}
   detail={ref.placement==="float"?"Keeps the window from being dragged":"Applies when the reference floats"}
   {...(lockedReason===undefined?{}:{disabledReason:lockedReason})} onValueChange={pinned=>onChange("pin",{pinned})}/>
  <SwitchRow label="Lock" unstyled={unstyled} value={ref.locked} detail="Blocks every change until unlocked"
   onValueChange={onToggleLock}/>
  <View style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.fixedElement,alignItems:"center"}}>
   <Button title="Add reference image" variant="secondary" unstyled={unstyled} onPress={()=>onAdd()}/>
   <Button title="Remove" variant="danger" unstyled={unstyled} disabled={ref.locked}
    accessibilityHint={lockedReason} onPress={onRemove}/>
  </View>
  {lockedReason?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{lockedReason}</Text>:null}
 </View>;
}

function StepButton({label,text,styled,onPress}:{label:string;text:string;styled:boolean;onPress:()=>void}){
 return <Pressable role="button" aria-label={label} onPress={onPress}
  {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
  style={{width:tokens.spacing.fixedTarget,height:tokens.spacing.fixedTarget,alignItems:"center",justifyContent:"center"}}>
  <Text {...{className:joinClasses(styled&&"text-text")}} style={{fontSize:tokens.text.title}}>{text}</Text>
 </Pressable>;
}
