import {useLayoutEffect,useRef} from 'react';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Platform,Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {formatTimecode,type FrameRate} from "../timebase.ts";
import type {InOutRange} from "./edits.ts";
import {frameForKey} from "./frame-keys.ts";
import {loopCommit,loopFromMarks,setLoopEdge,type LoopCommit,type LoopRange} from "./loop-range.ts";
import {frameToX,xToFrame,type TimelineViewport} from "./viewport.ts";
import {useFrameScrub} from "./useFrameScrub.ts";

/** Props for {@linkcode LoopRangeBar}. */
export interface LoopRangeBarProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly viewport:TimelineViewport;
  /** The stored loop (Splice `setLoopRange`), or none. */
  readonly range:LoopRange|undefined;
  readonly durationFrames:number;
  readonly rate:FrameRate;
  /** Whether the player loops: player state, separate from the stored range. */
  readonly looping:boolean;
  readonly onLoopingChange:(looping:boolean)=>void;
  /** The in/out marks, for "Loop marked range". */
  readonly marks?:InOutRange;
  /** Drag preview of the range. */
  readonly onPreview?:(range:LoopRange)=>void;
  /** One commit per handle release, key press or button; `undefined` clears the loop (`clearLoopRange`). */
  readonly onCommit:(range:LoopCommit|undefined)=>void;
  readonly dropFrame?:boolean;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const HIT=44;

function Edge({boundary,restorePreview,edge,range,viewport,durationFrames,rate,onPreview,onCommit,dropFrame,disabled,styled}:{
  boundary:string;restorePreview?:LoopRangeBarProps["onPreview"];edge:"in"|"out";range:LoopRange;viewport:TimelineViewport;durationFrames:number;rate:FrameRate;
  onPreview?:(r:LoopRange)=>void;onCommit:(r:LoopCommit)=>void;dropFrame:boolean;disabled:boolean;styled:boolean;
}){
  const committed=useRef(boundary);
  useLayoutEffect(()=>{committed.current=boundary;},[boundary]);
  const admitted=()=>committed.current===boundary&&!disabled;
  const frame=edge==="in"?range.inFrame:range.outFrame;
  const left=frameToX(viewport,frame)-HIT/2;
  const commit=(f:number)=>{if(!admitted())return;const r=setLoopEdge(range,edge,f,durationFrames);if(r.inFrame!==range.inFrame||r.outFrame!==range.outFrame)onCommit(loopCommit(r,rate));};
  const scrub=useFrameScrub({frame,disabled,boundary,onRestore:()=>restorePreview?.(range),
    onScrub:f=>onPreview?.(setLoopEdge(range,edge,f,durationFrames)),onCommit:commit,
    frameAt:p=>Math.min(durationFrames,Math.max(0,Math.round(xToFrame(viewport,left+p.x)))),
    grabPxPerFrame:viewport.pxPerFrame,durationFrames});
  const shown=setLoopEdge(range,edge,scrub.shown,durationFrames);
  const shownFrame=edge==="in"?shown.inFrame:shown.outFrame;
  const x=frameToX(viewport,shownFrame);
  const onKeyDown=(event:KeyEventLike)=>{
    if(!admitted())return;
    const key=keyboardKey(event);
    if(key==="Escape"){scrub.cancel();return;}
    const next=frameForKey(key,frame,durationFrames,rate);
    if(next===undefined||disabled)return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
    commit(next);
  };
  const offscreen=x<-HIT||x>viewport.widthPx+HIT;
  return <View {...scrub.handlers}
    {...{onKeyDown,focusable:!disabled&&!offscreen,className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
    pointerEvents={offscreen?"none":undefined} accessibilityElementsHidden={offscreen} importantForAccessibility={offscreen?"no-hide-descendants":"auto"}
    accessible={!offscreen} accessibilityRole="adjustable" accessibilityLabel={edge==="in"?"Loop start":"Loop end"}
    aria-valuemin={0} aria-valuemax={durationFrames} aria-valuenow={shownFrame}
    aria-valuetext={formatTimecode(shownFrame,rate,{dropFrame})} aria-disabled={disabled}
    accessibilityActions={[{name:"increment",label:"Later"},{name:"decrement",label:"Earlier"}]}
    onAccessibilityAction={e=>{
      if(!admitted())return;
      const d=e.nativeEvent.actionName==="increment"?1:e.nativeEvent.actionName==="decrement"?-1:0;
      if(d&&!disabled)commit(frame+d);
    }}
    style={{position:"absolute",left:x-HIT/2,top:0,width:HIT,height:HIT,alignItems:"center",justifyContent:"center",...NO_SELECT}}>
    {/* A bracket that opens toward the loop. */}
    <View pointerEvents="none" {...{className:joinClasses(styled&&"border-info")}}
      style={{width:10,height:28,borderTopWidth:3,borderBottomWidth:3,
        ...(edge==="in"?{borderLeftWidth:3,marginLeft:10}:{borderRightWidth:3,marginRight:10})}}/>
  </View>;
}

/**
 * The playback loop (D-13): a Loop switch for the player, "Loop marked range"
 * to take the in/out marks, Clear, and a 44pt band (place it over the ruler)
 * with the loop filled and a draggable, keyboard-adjustable bracket at each
 * end. The range is never empty: an end pushed past the other stops a frame
 * short. Each release, key press or button commits once.
 */
export function LoopRangeBar({scope='LoopRangeBar',revision=0,...props}:LoopRangeBarProps){
 const signature=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.disabled,props.viewport,props.durationFrames,props.rate,props.range,props.marks]);
 const owner=useEditorBoundary([signature]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined||!!props.disabled);
 return <LoopRangeBarBody boundary={owner} restorePreview={props.onPreview} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onCommit={(value)=>guard.run('onCommit',host=>host.onCommit(value))}
  onLoopingChange={(value)=>guard.run('onLoopingChange',host=>host.onLoopingChange(value))}
  {...(props.onPreview?{onPreview:(value:Parameters<NonNullable<LoopRangeBarProps['onPreview']>>[0])=>guard.current()?.onPreview?.(value)}:{})}/>;
}
function LoopRangeBarBody({
  boundary,restorePreview,actionError=null,disabledReason,
  viewport,range,durationFrames,rate,looping,onLoopingChange,marks,onPreview,onCommit,dropFrame=false,disabled=false,
  className,unstyled=false,testID,style,...rest
}:LoopRangeBarProps&{boundary:string;restorePreview?:LoopRangeBarProps["onPreview"];actionError?:string|null}){
  const useBoundary=useEditorBoundary([boundary,disabled]);
  const latestLooping=useRef(looping);
  useLayoutEffect(()=>{latestLooping.current=looping;});
  const styled=!unstyled;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const tc=(f:number)=>formatTimecode(f,rate,{dropFrame});
  const fromMarks=marks&&durationFrames>0?loopFromMarks(marks,durationFrames):undefined;
  const marksReason=!marks||(marks.inFrame===undefined&&marks.outFrame===undefined)?"Set in and out marks to loop them":!fromMarks?"The marked range is empty":undefined;
  const startX=range?Math.max(0,frameToX(viewport,range.inFrame)):0;
  const endX=range?Math.min(viewport.widthPx,frameToX(viewport,range.outFrame)):0;
  const off=disabled||durationFrames<1;
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-2",className)}} style={style}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}}>
      <Pressable accessibilityRole="switch" aria-checked={looping} accessibilityState={{checked:looping,disabled:off||!range}}
        disabled={off||!range} accessibilityLabel="Loop playback"
        accessibilityHint={range?"Repeats the loop range while playing":"Set a loop range first"}
        onPress={()=>onLoopingChange(!latestLooping.current)} {...id("toggle")}
        {...{className:joinClasses(styled&&"rounded-control border-2 px-3 focus-visible:ring-2 focus-visible:ring-focus",
          styled&&(looping?"border-focus bg-surface-sunken":"border-border bg-surface-raised"))}}
        style={{minHeight:44,justifyContent:"center",opacity:off||!range?0.4:1}}>
        <Text {...{className:joinClasses(styled&&(looping?"text-text font-semibold":"text-text"))}}>{looping?"Loop on":"Loop off"}</Text>
      </Pressable>
      <Button title="Loop marked range" variant="secondary" size="sm" disabled={off||!fromMarks} {...id("from-marks")}
        accessibilityHint={marksReason??"Loop between the in and out marks"}
        onPress={()=>{if(fromMarks)onCommit(loopCommit(fromMarks,rate));}}/>
      <Button title="Clear" variant="ghost" size="sm" disabled={off||!range} {...id("clear")}
        accessibilityHint={range?"Remove the loop range":"No loop range to clear"} onPress={()=>onCommit(undefined)}/>
      <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{fontVariant:["tabular-nums"]}}>
        {range?`Loop ${tc(range.inFrame)} to ${tc(range.outFrame)}`:"No loop range"}
      </Text>
    </View>
    <View accessibilityLabel="Loop range" {...{className:joinClasses(styled&&"bg-surface-sunken border-b border-border")}}
      style={{height:HIT,width:viewport.widthPx,overflow:"hidden",direction:"ltr"}}>
      {range&&endX>startX?<View pointerEvents="none" {...{className:joinClasses(styled&&(looping?"bg-info/20 border-y border-info":"bg-info/10 border-y border-info/50"))}}
        style={{position:"absolute",top:10,bottom:10,left:startX,width:endX-startX}}/>:null}
      {range?<>
        <Edge boundary={useBoundary} restorePreview={restorePreview} edge="in" range={range} viewport={viewport} durationFrames={durationFrames} rate={rate} onPreview={onPreview}
          onCommit={onCommit} dropFrame={dropFrame} disabled={off} styled={styled}/>
        <Edge boundary={useBoundary} restorePreview={restorePreview} edge="out" range={range} viewport={viewport} durationFrames={durationFrames} rate={rate} onPreview={onPreview}
          onCommit={onCommit} dropFrame={dropFrame} disabled={off} styled={styled}/>
      </>:null}
    </View>
  </View>;
}
