import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
/*
 * Portions ported from FilmCraft for Android,
 * https://github.com/artcraft-android/filmcraft-android
 * apps/filmcraft-android/android/app/src/main/java/io/github/artcraftandroid/filmcraft/ui/editor/Timeline.kt
 * at commit c41b58467edd28d098336286528159b24c5203b5 (the trim drag: a handle on
 * each edge of the selected clip, the horizontal travel accumulated into a
 * delta, the edge previewed while dragging, and one trim committed on release,
 * snapped to a frame).
 *
 * Copyright (c) 2026 ArtCraft Team and the FilmCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/FilmCraft-LICENSE-MIT.txt, licenses/FilmCraft-LICENSE-APACHE.txt and
 * licenses/FilmCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from a Compose Canvas
 * gesture to two React Native responder views, with snapping to clip edges and
 * the playhead, overlap and media-length limits, keyboard and screen-reader
 * adjustment, Escape to cancel, and a `TimelineEdit` in place of the engine call.
 */
import {useEffect,useMemo,useRef} from "react";
import {Platform,View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {createValueGesture} from "@nyc-tron/ui/components/gestures/value-gesture";
import {formatTimecode,type FrameRate} from "../timebase.ts";
import {clipEnd,trimEdit,trimPreview,type EditPreview,type TimelineClip,type TimelineEdit,type TimelineTrack} from "./edits.ts";
import {exact} from '../exact-optional.ts';

/** Props for {@linkcode ClipTrimHandles}. */
export interface ClipTrimHandlesProps extends ScopedControlProps {
  readonly clip:TimelineClip;
  readonly track:TimelineTrack;
  readonly rate:FrameRate;
  readonly pxPerFrame:number;
  /** Layout height of the clip; the handles span it. */
  readonly height:number;
  /** Frames an edge snaps to. */
  readonly snapTargets:readonly number[];
  /** Snap distance in frames. 0 disables snapping. */
  readonly snapThreshold:number;
  /** The trim being dragged, to redraw the clip; `undefined` when it ends. */
  readonly onPreview:(edge:"head"|"tail",preview:EditPreview|undefined)=>void;
  /** One trim per release, key press or screen-reader step. */
  readonly onEdit:(edit:TimelineEdit)=>void;
  readonly dropFrame?:boolean;
  readonly disabled?:boolean;
  readonly unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const HIT=44;
const same=(a:EditPreview,b:EditPreview)=>a.startFrame===b.startFrame&&a.sourceIn===b.sourceIn&&a.sourceOut===b.sourceOut&&a.valid===b.valid;

function Handle({edge,...p}:ClipTrimHandlesProps&{edge:"head"|"tail"}){
  const {clip,track,rate,pxPerFrame,height,snapTargets,snapThreshold,onPreview,onEdit,dropFrame=false,disabled=false,unstyled=false}=p;
  const latest=useRef(p);
  latest.current=p;
  const edgeFrame=edge==="head"?clip.startFrame:clipEnd(clip);
  const startX=useRef(0);
  const start=useRef(edgeFrame);
  const gesture=useMemo(()=>createValueGesture<EditPreview>({
    disabled:()=>latest.current.disabled??false,
    equals:same,
    preview:v=>{
      const c=latest.current.clip;
      const unchanged=v.startFrame===c.startFrame&&v.sourceIn===c.sourceIn&&v.sourceOut===c.sourceOut;
      latest.current.onPreview(edge,unchanged?undefined:v);
    },
    commit:v=>{
      const e=trimEdit(latest.current.clip,latest.current.track.id,edge,v,latest.current.rate);
      latest.current.onPreview(edge,undefined);
      if(e)latest.current.onEdit(e);
    },
  }),[edge]);
  useEffect(()=>()=>gesture.cancel(),[gesture]);
  const preview=(raw:number)=>trimPreview(latest.current.track,latest.current.clip,edge,raw,
    {targets:latest.current.snapTargets,threshold:latest.current.snapThreshold});
  const origin={startFrame:clip.startFrame,sourceIn:clip.sourceIn,sourceOut:clip.sourceOut,valid:true};
  const handlers=useLocalPointer({
    disabled,
    onBegin:pt=>{startX.current=pt.x;start.current=edgeFrame;gesture.begin(origin);},
    onMove:pt=>gesture.update(preview(start.current+(pt.x-startX.current)/latest.current.pxPerFrame)),
    onRelease:pt=>{gesture.update(preview(start.current+(pt.x-startX.current)/latest.current.pxPerFrame));gesture.release();latest.current.onPreview(edge,undefined);},
    onCancel:()=>{gesture.cancel();latest.current.onPreview(edge,undefined);},
  });
  const nudge=(d:number)=>{
    if(disabled)return;
    const v=trimPreview(track,clip,edge,edgeFrame+d,{});
    const e=trimEdit(clip,track.id,edge,v,rate);
    if(e)onEdit(e);
  };
  const onKeyDown=(event:KeyEventLike)=>{
    const key=keyboardKey(event);
    if(key==="Escape"){gesture.cancel();onPreview(edge,undefined);return;}
    const d=key==="ArrowRight"?1:key==="ArrowLeft"?-1:0;
    if(!d)return;
    // Arrow keys here trim; keep them from reaching any ancestor that moves clips.
    const e=event as {preventDefault?:()=>void;stopPropagation?:()=>void};
    e.preventDefault?.();e.stopPropagation?.();
    nudge(d);
  };
  const label=`${edge==="head"?"Start":"End"} of ${clip.label??"clip"}`;
  const styled=!unstyled;
  return <View {...handlers}
    {...{onKeyDown,focusable:!disabled,className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
    accessible accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityHint="Drag to trim. Arrow keys move this edge one frame."
    aria-valuemin={0} aria-valuetext={formatTimecode(Math.max(0,Math.round(edgeFrame)),rate,{dropFrame})}
    aria-valuenow={Math.round(edgeFrame)} aria-disabled={disabled}
    accessibilityActions={[{name:"increment",label:"Later"},{name:"decrement",label:"Earlier"}]}
    onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="increment")nudge(1);if(e.nativeEvent.actionName==="decrement")nudge(-1);}}
    style={{position:"absolute",top:0,height:Math.max(HIT,height),width:HIT,
      ...(edge==="head"?{left:-HIT/2}:{right:-HIT/2}),alignItems:"center",justifyContent:"center",zIndex:2,...NO_SELECT}}>
    <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-focus")}}
      style={{width:8,height:Math.max(20,height-12),borderRadius:4,alignItems:"center",justifyContent:"center"}}>
      <View {...{className:joinClasses(styled&&"bg-surface-raised")}} style={{width:2,height:12,borderRadius:1}}/>
    </View>
  </View>;
}

/**
 * Head and tail trim handles for the selected clip (D-19). Each is a 44pt
 * target straddling its edge. A drag previews the trimmed clip through
 * `onPreview` (snapping to clip edges and the playhead, never past a
 * neighbour, the media's ends or a one-frame minimum) and release emits one
 * `trim` edit. The handles are adjustable: arrow keys and screen-reader steps
 * move the edge a frame and commit.
 */
export function ClipTrimHandles({scope='clip-trim',revision=0,...props}:ClipTrimHandlesProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,props.clip,props.track.locked,props.pxPerFrame,props.height,props.rate]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled||!!props.track.locked);
 return <EditorInteractionScope.Provider value={boundary}><ErrorMessage {...exact({message:guard.error??undefined,unstyled:props.unstyled})}/><ClipTrimHandlesBody {...props} disabled={!!props.disabled||props.disabledReason!==undefined||!!props.track.locked||guard.pending}
  onPreview={(edge,value)=>guard.current()?.onPreview(edge,value)} onEdit={value=>guard.run('trim',host=>host.onEdit(value))}/></EditorInteractionScope.Provider>;
}
function ClipTrimHandlesBody(props:ClipTrimHandlesProps){
  return <>
    <Handle edge="head" {...props}/>
    <Handle edge="tail" {...props}/>
  </>;
}
