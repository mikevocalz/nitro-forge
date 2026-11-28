/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/ColorDropUi.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (the chip that is tapped or
 * dragged out, the dot under the pointer, and the band that reads the target).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Compose to a controlled
 * React Native component on theme tokens; fills are reported to the host as one
 * `onFill` instead of running in a view model; keyboard targeting added.
 */
import {useEffect,useLayoutEffect,useRef,type ComponentRef,type ReactNode} from "react";
import {PanResponder,Platform,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {createCanvasResponder} from '@nyc-tron/ui/components/gestures/canvas-responder';
import {Crosshair} from "../selection/selection-overlay.tsx";
import {
 DROP_DOT_SIZE,buildFill,classifyPress,clampToTarget,describeDropTarget,dropKeyMove,dropToDocument,
 thresholdLabel,validateDrop,type DropPoint,type DropRect,type FillRequest,
} from "./color-drop-model.ts";
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";

/** Props for {@linkcode ColorDropCanvasTarget}. */
export interface ColorDropCanvasTargetProps extends Omit<ViewProps,"children">,ScopedControlProps {
 /** The colour on the chip, in any form the platform draws and the host's fill accepts. */
 color:string;
 /** Spoken and shown name of the colour, e.g. "Coral". */
 colorLabel:string;
 /** Fill tolerance 0..255 sent with each drop. */
 tolerance:number;
 /** Fill only the connected region, or every matching pixel. */
 contiguous:boolean;
 /** Size of the canvas target in layout units; the host draws its canvas at this size. */
 width:number;
 height:number;
 /** Document size in pixels; drops are reported in document pixels. */
 documentWidth:number;
 documentHeight:number;
 /** Exactly once per drop on the canvas. Maps to `floodFill` on the host's current layer. */
 onFill:(request:FillRequest,signal?:AbortSignal)=>void|Promise<unknown>;
 /** Live target in document pixels during a drag or keyboard aim; `undefined` when off the canvas or ended. */
 onPreview?:(target:DropPoint|undefined)=>void;
 /** A tap on the chip without dragging, e.g. to open the colour picker. */
 onChipPress?:()=>void;
 /** Why filling is unavailable (for example "Fill needs a pixel layer"). Drags are refused and this is shown. */
 disabledReason?:string;
 /** The host's canvas, drawn inside the target. */
 children?:ReactNode;
 className?:string;
 unstyled?:boolean;
}

type Drag={pointer:DropPoint;over:DropPoint|undefined};
type Local={drag:Drag|null;aim:DropPoint|null;notice:string|undefined};
type Geometry={chip:DropRect;target:DropRect};
type Measurable={measureLayout?:(relativeTo:unknown,ok:(x:number,y:number,w:number,h:number)=>void,fail?:()=>void)=>void};

/**
 * ColorDrop (B-30): drag the colour chip onto the canvas to flood-fill there.
 * While dragging, a dot follows the pointer, the canvas highlights when the
 * pointer is over it and a band reads the document pixel and threshold.
 * Releasing over the canvas sends one `onFill`; releasing elsewhere or pressing
 * Escape puts the colour back. A tap that stays inside the slop is a press, not
 * a drag. Keyboard: focus the chip, press Enter to aim at the canvas centre,
 * move with the arrows (Alt for ten times the step), Enter to fill, Escape to cancel.
 */
export function ColorDropCanvasTarget({scope='color-drop',revision=0,...props}:ColorDropCanvasTargetProps&{actionError?:string|null}){
 validateDrop(props);
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.color,props.tolerance,props.contiguous,props.width,props.height,props.documentWidth,props.documentHeight]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <ColorDropCanvasTargetBody key={owner} {...props} actionError={guard.error} {...(guard.pending?{disabledReason:'Fill in progress'}:{})}
  onFill={value=>guard.run('fill',(host,signal)=>host.onFill(value,signal))}
  onChipPress={()=>guard.current()?.onChipPress?.()} onPreview={value=>guard.current()?.onPreview?.(value)}/>;
}
function ColorDropCanvasTargetBody({
 color,colorLabel,tolerance,contiguous,width,height,documentWidth,documentHeight,onFill,onPreview,onChipPress,
 actionError=null,disabledReason,children,className,unstyled=false,style,...rest
}:ColorDropCanvasTargetProps&{actionError?:string|null}){
 validateDrop({color,tolerance,width,height,documentWidth,documentHeight});
 const latest=useRef({color,colorLabel,tolerance,contiguous,width,height,documentWidth,documentHeight,onFill,onPreview,onChipPress,disabledReason});
 useLayoutEffect(()=>{latest.current={color,colorLabel,tolerance,contiguous,width,height,documentWidth,documentHeight,onFill,onPreview,onChipPress,disabledReason};});
 const local=useRef<StoreApi<Local>|null>(null);
 if(!local.current)local.current=createStore<Local>(()=>({drag:null,aim:null,notice:undefined}));
 const store=local.current;
 const drag=useStore(store,s=>s.drag);
 const aim=useStore(store,s=>s.aim);
 const notice=useStore(store,s=>s.notice);
 const root=useRef<ComponentRef<typeof View>|null>(null);
 const chip=useRef<ComponentRef<typeof View>|null>(null);
 const target=useRef<ComponentRef<typeof View>|null>(null);
 const geometry=useRef<Geometry|null>(null);
 const press=useRef<{local:DropPoint;dragging:boolean;cancelled:boolean}|null>(null);
 const styled=!unstyled;

 const measurement=useRef(0);
 useEffect(()=>()=>{measurement.current++;},[]);
 const measure=()=>{
  const ticket=++measurement.current;geometry.current=null;
  const r=root.current,c=chip.current as unknown as Measurable|null,t=target.current as unknown as Measurable|null;
  if(!r||!c?.measureLayout||!t?.measureLayout)return;
  let chipRect:DropRect|undefined;
  c.measureLayout(r,(x,y,w,h)=>{if(ticket!==measurement.current)return;chipRect={x,y,width:w,height:h};
   t.measureLayout!(r,(tx,ty,tw,th)=>{if(ticket!==measurement.current||![x,y,w,h,tx,ty,tw,th].every(Number.isFinite)||w<=0||h<=0||tw<=0||th<=0)return;geometry.current={chip:chipRect!,target:{x:tx,y:ty,width:tw,height:th}};});
  });
 };
 const docAt=(pointer:DropPoint)=>{
  const g=geometry.current,p=latest.current;
  return g?dropToDocument(pointer,g.target,p.documentWidth,p.documentHeight):undefined;
 };
 const endDrag=(message:string|undefined)=>{
  store.setState({drag:null,notice:message});
  latest.current.onPreview?.(undefined);
 };
 const cancelAll=(message:string)=>{
  if(press.current)press.current.cancelled=true;
  const s=store.getState();
  if(s.drag||s.aim){store.setState({drag:null,aim:null,notice:message});latest.current.onPreview?.(undefined);}
 };
 const fill=(at:DropPoint)=>{
  const p=latest.current;if(p.disabledReason!==undefined)return;
  store.setState({drag:null,aim:null,notice:`Filled at ${at.x}, ${at.y} with ${p.colorLabel}`});
  p.onPreview?.(undefined);
  p.onFill(buildFill(at,p.color,p.tolerance,p.contiguous));
 };
 useEffect(()=>()=>{const s=store.getState();if(s.drag||s.aim)latest.current.onPreview?.(undefined);},[store]);

 const pan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
 if(!pan.current)pan.current=createCanvasResponder({
  onStartShouldSetPanResponder:(_e,g)=>latest.current.disabledReason===undefined&&g.numberActiveTouches<=1,onMoveShouldSetPanResponder:()=>false,
  onPanResponderTerminationRequest:()=>false,
  onPanResponderGrant:e=>{
   (chip.current as unknown as {focus?:()=>void}|null)?.focus?.();
   measure();
   if(store.getState().aim)store.setState({aim:null});
   press.current={local:{x:e.nativeEvent.locationX,y:e.nativeEvent.locationY},dragging:false,cancelled:false};
  },
  onPanResponderMove:(_e,g)=>{
   const p=press.current;
   if(!p||p.cancelled)return;
   if(g.numberActiveTouches>1){cancelAll("Colour put back");return;}
   if(!p.dragging){
    if(classifyPress(g.dx,g.dy)!=="drag")return;
    if(latest.current.disabledReason!==undefined){p.cancelled=true;store.setState({notice:latest.current.disabledReason});return;}
    p.dragging=true;
   }
   const chipRect=geometry.current?.chip;
   if(!chipRect)return;
   const pointer={x:chipRect.x+p.local.x+g.dx,y:chipRect.y+p.local.y+g.dy};
   const over=docAt(pointer);
   const prev=store.getState().drag?.over;
   store.setState({drag:{pointer,over},notice:undefined});
   if(prev?.x!==over?.x||prev?.y!==over?.y)latest.current.onPreview?.(over);
  },
  onPanResponderRelease:(_e,g)=>{
   const p=press.current;press.current=null;
   if(!p||p.cancelled)return;
   if(!p.dragging){latest.current.onChipPress?.();return;}
   const c=geometry.current?.chip;
   const over=c?docAt({x:c.x+p.local.x+g.dx,y:c.y+p.local.y+g.dy}):undefined;
   if(over)fill(over);else endDrag("Dropped outside the canvas. Nothing was filled.");
  },
  onPanResponderTerminate:()=>{press.current=null;if(store.getState().drag)endDrag("Colour put back");},
 });

 const onKeyDown=(event:KeyEventLike&{preventDefault?:()=>void;altKey?:boolean;nativeEvent?:{key?:string;altKey?:boolean}})=>{
  const key=keyboardKey(event);
  const p=latest.current;
  const a=store.getState().aim;
  if(key==="Escape"){
   if(press.current?.dragging||store.getState().drag||a){event.preventDefault?.();cancelAll("Colour put back");}
   return;
  }
  if(key==="Enter"||key===" "){
   event.preventDefault?.();
   if(a){fill(dropToDocument({x:a.x,y:a.y},{x:0,y:0,width:p.width,height:p.height},p.documentWidth,p.documentHeight)!);return;}
   if(p.disabledReason!==undefined){store.setState({notice:p.disabledReason});return;}
   const start={x:p.width/2,y:p.height/2};
   store.setState({aim:start,notice:undefined});
   p.onPreview?.(dropToDocument(start,{x:0,y:0,width:p.width,height:p.height},p.documentWidth,p.documentHeight));
   return;
  }
  if(!a)return;
  const d=dropKeyMove(key,!!(event.altKey??event.nativeEvent?.altKey));
  if(!d)return;
  event.preventDefault?.();
  const next=clampToTarget({x:a.x+d.x,y:a.y+d.y},p.width,p.height);
  store.setState({aim:next});
  p.onPreview?.(dropToDocument(next,{x:0,y:0,width:p.width,height:p.height},p.documentWidth,p.documentHeight));
 };
 const a11y=(name:string)=>{
  const key={activate:"Enter",escape:"Escape",moveLeft:"ArrowLeft",moveRight:"ArrowRight",moveUp:"ArrowUp",moveDown:"ArrowDown"}[name];
  if(key)onKeyDown({key});
 };

 const aimDoc=aim?dropToDocument(aim,{x:0,y:0,width,height},documentWidth,documentHeight):undefined;
 const active=drag!==null||aim!==null;
 const targetDoc=drag?drag.over:aimDoc;
 const over=targetDoc!==undefined&&active;
 const band=active?describeDropTarget(targetDoc,colorLabel,tolerance)
  :notice??disabledReason??`Drag ${colorLabel} onto the canvas to fill. ${thresholdLabel(tolerance)}, ${contiguous?"connected area":"every match"}.`;

 return <View ref={root} collapsable={false} {...rest} {...{className:joinClasses("gap-2",className)}}
  style={[{position:"relative",maxWidth:"100%"},style]}>
  <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
  <View style={{flexDirection:"row",alignItems:"center",gap:tokens.spacing.off10,minHeight:tokens.spacing.fixedTarget}}>
   <View ref={chip} collapsable={false} {...pan.current.panHandlers}
    {...{onKeyDown,focusable:true}} accessible role="button"
    aria-label={disabledReason!==undefined?`${colorLabel} fill colour, unavailable`:`${colorLabel} fill colour`}
    accessibilityState={{disabled:disabledReason!==undefined}}
    accessibilityHint={disabledReason??(aim?"Arrows move the target, Enter fills, Escape cancels.":"Drag onto the canvas to fill, or press Enter to aim with the keyboard.")}
    accessibilityActions={aim?[{name:"activate",label:"Fill here"},{name:"escape",label:"Cancel"},
     {name:"moveLeft",label:"Move left"},{name:"moveRight",label:"Move right"},{name:"moveUp",label:"Move up"},{name:"moveDown",label:"Move down"}]
     :[{name:"activate",label:"Aim at the canvas"}]}
    onAccessibilityAction={e=>a11y(e.nativeEvent.actionName)}
    {...{className:joinClasses(styled&&"rounded-full border focus-visible:ring-2 focus-visible:ring-focus" /* radius-exempt: colour-well */,styled&&(active?"border-accent":"border-border"))}}
    style={{width:tokens.spacing.fixedTarget,height:tokens.spacing.fixedTarget,borderRadius:tokens.spacing.fixedTarget / 2, /* radius-exempt: colour-well */borderWidth:active?tokens.borderWidth.strong:tokens.borderWidth.hairline,alignItems:"center",justifyContent:"center",
     opacity:disabledReason!==undefined?tokens.opacity.disabled:1,...(Platform.OS==="web"?{cursor:disabledReason?"not-allowed":"grab",touchAction:"none",userSelect:"none"} as object:null)}}>
    <View pointerEvents="none" style={{width:tokens.spacing.off33,height:tokens.spacing.off33,borderRadius:tokens.spacing.off33 / 2, /* radius-exempt: colour-well */backgroundColor:color}}/>
   </View>
   <View style={{flex:1,minWidth:0}}>
    <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>ColorDrop: {colorLabel}</Text>
    <Text testID="color-drop-band" aria-live="polite" accessibilityLiveRegion="polite" numberOfLines={2}
     {...{className:joinClasses(styled&&"text-xs",styled&&(active||notice?"text-text":"text-text-muted"))}}
     style={{fontVariant:["tabular-nums"]}}>{band}</Text>
   </View>
  </View>
  <View ref={target} collapsable={false} testID="color-drop-target" accessible
   accessibilityLabel={`Canvas, ${documentWidth} by ${documentHeight} pixels${over?", fill target":""}`}
   {...{className:joinClasses("overflow-hidden",styled&&"rounded-control border-2",styled&&(over?"border-accent":active?"border-focus":"border-border"))}}
   style={{width,height,position:"relative"}}>
   <View pointerEvents="none" style={{position:"absolute",left:0,top:0,width,height}}>{children}</View>
   {over?<View pointerEvents="none" {...{className:joinClasses(styled&&"bg-accent/10")}}
    style={{position:"absolute",left:0,top:0,right:0,bottom:0}}/>:null}
   {aim?<Crosshair x={aim.x} y={aim.y} styled={styled}/>:null}
  </View>
  {drag?<View pointerEvents="none" testID="color-drop-dot" {...{className:joinClasses(styled&&"border-surface-raised")}}
   style={{position:"absolute",left:drag.pointer.x-DROP_DOT_SIZE/2,top:drag.pointer.y-DROP_DOT_SIZE/2,width:DROP_DOT_SIZE,
    height:DROP_DOT_SIZE,borderRadius:DROP_DOT_SIZE/2, /* radius-exempt: colour-well */borderWidth:tokens.borderWidth.off3,backgroundColor:color,zIndex:controlTokens.layer.floating}}/>:null}
 </View>;
}
