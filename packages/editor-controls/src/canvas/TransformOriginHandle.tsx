import {forgeRadius} from "../radius.ts";
import {useLayoutEffect,useRef} from "react";
import {Platform,Text,View,type ViewProps} from "react-native";
import {SelectionOutline} from "../selection/SelectionOutline.tsx";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {webKey} from "@nyc-tron/ui/components/forms/choice-keys";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {docPointToScreen,screenPointToDoc,tidy,validateViewport,type CanvasViewport,type DocPoint} from "./canvas-viewport.ts";
import {
  ANCHOR_SNAP_RADIUS,ORIGIN_ANCHORS,ORIGIN_ANCHOR_LABELS,anchorPoint,currentAnchor,cycleAnchor,nearestAnchor,
  originAccessibilityValue,originKeyCommand,originPayload,pivotInDoc,validateTransform,
  type BoundsCorners,type LayerTransform,type OriginAnchor,
} from "./transform-origin-model.ts";
import { controlTokens, tokens } from "../tokens.ts";

/** Props for {@linkcode TransformOriginHandle}. */
export interface TransformOriginHandleProps extends Omit<ViewProps,"children"> {
  /** Hide the shared outline/anchor ink when composing with SelectionBounds. */
  readonly showBounds?:boolean;
  readonly scope?:string;
  readonly revision?:string|number;
  readonly viewport:CanvasViewport;
  /** Document corners of the selection's transformed bounds (`layerBounds` `corners`, or `rectCorners` of its box). */
  readonly corners:BoundsCorners;
  /** The one selected layer's transform. Omit, with `unavailableReason`, when the pivot cannot be edited. */
  readonly transform?:LayerTransform;
  /**
   * Shown at the selection's centre instead of a handle, e.g. "Select one
   * layer to move its pivot" for a multi-selection or "Unlock the layer to
   * move its pivot". Required when `transform` is omitted.
   */
  readonly unavailableReason?:string;
  /**
   * The pivot was dropped or stepped to a new spot. `ox`/`oy` are content
   * coordinates, ready for `setTransformOrigin {id, ox, oy}`. One call per
   * release or key press.
   */
  readonly onSetOrigin:(ox:number,oy:number)=>void;
  /** Document point under the dragged pivot on each move, then `undefined` when the drag ends or is cancelled. */
  readonly onPreview?:(point:DocPoint|undefined)=>void;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type Local={drag:{at:DocPoint;anchor:OriginAnchor|undefined}|undefined};
const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const HIT=44;

/**
 * Pivot editor for one layer (B-08). Draws the selection's bounds with its
 * nine anchors and a draggable pivot; within 12 units of an anchor the pivot
 * lands on it exactly. Release commits once through `onSetOrigin` in content
 * coordinates, and Prism shifts the translation so the layer does not move.
 * With keyboard focus, arrows move the pivot one document pixel (ten with
 * Shift) and keys 1 to 9 jump to the anchors in numeric-keypad layout;
 * screen readers step through the anchors. Escape cancels a drag. For
 * rotation drags around the pivot, use `rotationFromDrag` from the model,
 * which snaps to 15° with Shift.
 */
export function TransformOriginHandle({
  showBounds=true,scope="canvas-pivot",revision=0,viewport,corners,transform,unavailableReason,onSetOrigin:commitOrigin,onPreview:previewOrigin,disabled=false,className,unstyled=false,style,...rest
}:TransformOriginHandleProps){
  validateViewport(viewport);
  if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid pivot identity');
  if(corners.length!==4||corners.some(c=>c.length!==2||!c.every(Number.isFinite)))throw new RangeError('Pivot bounds need four finite corners');
  const boundary=JSON.stringify([scope,revision,viewport,corners,transform,disabled]);
  const mounted=useRef(false),committed=useRef(boundary);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useLayoutEffect(()=>{committed.current=boundary;});
  const valid=()=>mounted.current&&committed.current===boundary&&!disabled;
  const onSetOrigin=(ox:number,oy:number)=>{if(valid())commitOrigin(ox,oy);};
  const onPreview=(point:DocPoint|undefined)=>{if(valid())previewOrigin?.(point);};
  if(transform)validateTransform(transform);
  else if(!unavailableReason?.trim())throw new RangeError("TransformOriginHandle needs a transform, or an unavailableReason saying why there is none");
  const [state,store]=useLocalStore<Local>(()=>({drag:undefined}));
  useLayoutEffect(()=>{store.set({drag:undefined});},[boundary]);
  const styled=!unstyled;
  const screenCorners=corners.map(c=>docPointToScreen(viewport,{x:c[0],y:c[1]}));
  const center=docPointToScreen(viewport,anchorPoint(corners,"center"));
  const pivotDoc=state.drag?.at??(transform?pivotInDoc(transform):anchorPoint(corners,"center"));
  const pivot=docPointToScreen(viewport,pivotDoc);
  const handleLeft=pivot.x-HIT/2,handleTop=pivot.y-HIT/2;
  // The handle moves under the pointer while dragging; local points are measured
  // from where it was when the press began.
  const start=useRef({left:handleLeft,top:handleTop});
  const commitAt=(doc:DocPoint)=>{
    if(!valid()||!transform)return;
    const now=pivotInDoc(transform);
    if(Math.abs(now.x-doc.x)<1e-6&&Math.abs(now.y-doc.y)<1e-6)return;
    const {ox,oy}=originPayload(transform,doc);
    onSetOrigin(ox,oy);
  };
  const place=(local:{x:number;y:number})=>{
    const doc=screenPointToDoc(viewport,{x:start.current.left+local.x,y:start.current.top+local.y});
    const anchor=nearestAnchor(corners,doc,ANCHOR_SNAP_RADIUS/viewport.zoom);
    return {at:anchor?anchorPoint(corners,anchor):{x:tidy(doc.x,2),y:tidy(doc.y,2)},anchor};
  };
  const cancel=()=>{if(store.get().drag){store.set({drag:undefined});onPreview?.(undefined);}};
  const handlers=useLocalPointer({
    disabled:disabled||!transform,
    onBegin:p=>{if(!valid())return;start.current={left:handleLeft,top:handleTop};
      const d=place(p);store.set({drag:d});onPreview?.(d.at);},
    onMove:p=>{if(!valid()||!store.get().drag)return;const d=place(p);store.set({drag:d});onPreview?.(d.at);},
    onRelease:p=>{if(!valid()||!store.get().drag)return;const d=place(p);store.set({drag:undefined});onPreview?.(undefined);commitAt(d.at);},
    onCancel:cancel,
  });
  const onKeyDown=(event:unknown)=>{
    const k=webKey(event);
    if(k.key==="Escape"){cancel();return;}
    if(!valid()||!transform)return;
    const cmd=originKeyCommand(k.key,k.shiftKey===true);
    if(!cmd)return;
    k.preventDefault();
    if(cmd.kind==="anchor")commitAt(anchorPoint(corners,cmd.anchor));
    else{const p=pivotInDoc(transform);commitAt({x:tidy(p.x+cmd.dx),y:tidy(p.y+cmd.dy)});}
  };
  const anchorNow=transform?currentAnchor(corners,transform):undefined;
  const step=(direction:1|-1)=>commitAt(anchorPoint(corners,cycleAnchor(anchorNow,direction)));
  const dragAnchor=state.drag?.anchor;
  return <View {...rest} pointerEvents="box-none" {...{className:joinClasses(className)}}
    style={[{position:"absolute",left:0,top:0,width:viewport.width,height:viewport.height,overflow:"hidden",direction:"ltr"},style]}>
    {showBounds?<View pointerEvents="none" style={{position:"absolute",left:0,top:0,right:0,bottom:0}}>
      <SelectionOutline points={screenCorners} width={viewport.width} height={viewport.height} unstyled={unstyled}/>
      {ORIGIN_ANCHORS.map(anchor=>{
        const p=docPointToScreen(viewport,anchorPoint(corners,anchor));
        const hot=dragAnchor===anchor;
        return <View key={anchor} {...{className:joinClasses(styled&&"border",styled&&(hot?"bg-primary border-primary":"bg-surface-raised border-primary"))}}
          style={{position:"absolute",left:p.x-(hot?tokens.spacing.off5:tokens.spacing.fixedStack),top:p.y-(hot?tokens.spacing.off5:tokens.spacing.fixedStack),width:hot?tokens.spacing.off10:tokens.spacing.fixedElement,height:hot?tokens.spacing.off10:tokens.spacing.fixedElement}}/>;
      })}
    </View>:null}
    {transform?<View {...handlers} collapsable={false}
      accessible accessibilityRole="adjustable" accessibilityLabel="Pivot"
      accessibilityHint="Drag to move the point the layer rotates and scales around. Arrow keys nudge it; keys 1 to 9 jump to the anchors."
      aria-valuetext={state.drag?(state.drag.anchor?`Pivot at ${ORIGIN_ANCHOR_LABELS[state.drag.anchor]}`:"Pivot moving"):originAccessibilityValue(corners,transform)}
      accessibilityActions={disabled?[]:[{name:"increment",label:"Next anchor"},{name:"decrement",label:"Previous anchor"},{name:"center",label:"Center the pivot"}]}
      onAccessibilityAction={e=>{
        const a=e.nativeEvent.actionName;
        if(a==="increment")step(1);else if(a==="decrement")step(-1);else if(a==="center")commitAt(anchorPoint(corners,"center"));
      }}
      aria-disabled={disabled}
      {...{onKeyDown,focusable:!disabled,className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
      style={{position:"absolute",left:handleLeft,top:handleTop,width:HIT,height:HIT,alignItems:"center",justifyContent:"center",
        opacity:disabled?tokens.opacity.disabled:1,...NO_SELECT}}>
      <View pointerEvents="none" style={{width:tokens.spacing.off22,height:tokens.spacing.off22,alignItems:"center",justifyContent:"center"}}>
        <View {...{className:joinClasses(styled&&"bg-primary")}} style={{position:"absolute",width:tokens.spacing.off22,height:tokens.spacing.off2}}/>
        <View {...{className:joinClasses(styled&&"bg-primary")}} style={{position:"absolute",width:tokens.spacing.off2,height:tokens.spacing.off22}}/>
        <View {...{className:joinClasses(styled&&"border-2",styled&&(state.drag?"border-accent bg-surface-raised":"border-primary bg-surface-raised"))}}
          style={{width:tokens.spacing.fixedInset,height:tokens.spacing.fixedInset,borderRadius:forgeRadius.sm}}/>
      </View>
    </View>:null}
    {!transform&&unavailableReason?<View pointerEvents="none" style={{position:"absolute",left:Math.max(4,Math.min(center.x-110,viewport.width-224)),top:center.y-tokens.spacing.off14,width:controlTokens.extent.preview,alignItems:"center"}}>
      <Text accessibilityLiveRegion="polite"
        {...{className:joinClasses(styled&&"bg-surface-raised border border-border rounded-control text-text text-xs")}}
        style={{paddingHorizontal:tokens.spacing.fixedElement,paddingVertical:tokens.spacing.fixedStack,textAlign:"center"}}>{unavailableReason}</Text>
    </View>:null}
  </View>;
}
