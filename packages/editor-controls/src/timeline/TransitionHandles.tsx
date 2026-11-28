import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
import {useEffect,useMemo,useRef} from "react";
import {Platform,Pressable,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {createValueGesture} from "@nyc-tron/ui/components/gestures/value-gesture";
import {formatTimecode,type FrameRate} from "../timebase.ts";
import {framesToSeconds} from "./time.ts";
import type {TimelineTrack} from "./edits.ts";
import {
  AUDIO_CROSSFADE,clampTransitionFrames,clipsOfCut,cutsOf,maxTransitionFrames,transitionAt,transitionRequest,transitionTarget,
  type TimelineCut,type TimelineTransition,type TransitionRequest,
} from "./transitions.ts";
import {frameToX,type TimelineViewport} from "./viewport.ts";
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";

/** Props for {@linkcode TransitionHandles}. */
export interface TransitionHandlesProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The lanes' tracks, in lane order. */
  readonly tracks:readonly TimelineTrack[];
  readonly transitions:readonly TimelineTransition[];
  readonly viewport:TimelineViewport;
  readonly rate:FrameRate;
  /** Match `TimelineClipLane` `laneHeight`. @default 56 */
  readonly laneHeight?:number;
  /** Kind a quick add uses on video and overlay cuts; audio cuts always get a crossfade. @default "cross_dissolve" */
  readonly defaultKind?:string;
  /** Length a quick add asks for, clamped to what the cut allows. @default 24 */
  readonly defaultFrames?:number;
  readonly onAdd:(request:TransitionRequest)=>void;
  /** Once per edge release, key press or screen-reader step. */
  readonly onChange:(id:string,change:{durationFrames:number;durationSeconds:number})=>void;
  readonly onRemove:(id:string)=>void;
  /** The selected cut, for `TransitionPresetBrowser`. Pressing a cut calls `onSelectCut`; without it, a press adds. */
  readonly selectedCut?:TimelineCut;
  readonly onSelectCut?:(cut:TimelineCut|undefined)=>void;
  readonly selectedTransitionId?:string;
  readonly onSelectTransition?:(id:string|undefined)=>void;
  /** Draws the cut targets. Hide them while trimming: they sit on the same edges as the trim handles. @default true */
  readonly showCutTargets?:boolean;
  readonly dropFrame?:boolean;
  readonly disabled?:boolean;
  unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const HIT=44;
const sameCut=(a?:TimelineCut,b?:TimelineCut)=>!!a&&!!b&&a.leftClipId===b.leftClipId&&a.rightClipId===b.rightClipId;

function Band({t,cut,max,top,height,viewport,rate,selected,onChange,onRemove,onSelect,dropFrame,disabled,styled}:{
  t:TimelineTransition;cut:TimelineCut;max:number;top:number;height:number;viewport:TimelineViewport;rate:FrameRate;selected:boolean;
  onChange:TransitionHandlesProps["onChange"];onRemove:(id:string)=>void;onSelect?:((id:string|undefined)=>void)|undefined;dropFrame:boolean;disabled:boolean;styled:boolean;
}){
  const [preview,store]=useLocalStore(()=>undefined as number|undefined);
  const latest=useRef({t,max,rate,onChange,disabled});
  latest.current={t,max,rate,onChange,disabled};
  const x0=useRef(0);
  const set=(frames:number)=>{
    const f=clampTransitionFrames(frames,latest.current.max);
    if(f!==undefined&&f!==latest.current.t.durationFrames)latest.current.onChange(latest.current.t.id,{durationFrames:f,durationSeconds:framesToSeconds(f,latest.current.rate)});
  };
  const gesture=useMemo(()=>createValueGesture<number>({
    disabled:()=>latest.current.disabled,equals:(a,b)=>a===b,
    preview:f=>store.set(f),commit:f=>{store.set(undefined);set(f);},
  }),[store]);
  useEffect(()=>()=>gesture.cancel(),[gesture]);
  // Two pointer hooks, always called in this order.
  const edgeHandlers=(side:-1|1)=>useLocalPointer({
    disabled,
    onBegin:pt=>{x0.current=pt.x;gesture.begin(t.durationFrames);},
    // The band is centered on the cut, so an edge moved by d frames changes the length by 2d.
    onMove:pt=>gesture.update(clampTransitionFrames(t.durationFrames+side*2*Math.round((pt.x-x0.current)/viewport.pxPerFrame),max)??t.durationFrames),
    onRelease:pt=>{gesture.update(clampTransitionFrames(t.durationFrames+side*2*Math.round((pt.x-x0.current)/viewport.pxPerFrame),max)??t.durationFrames);gesture.release();},
    onCancel:()=>{gesture.cancel();store.set(undefined);},
  });
  const left=edgeHandlers(-1),right=edgeHandlers(1);
  const frames=preview??t.durationFrames;
  const cx=frameToX(viewport,cut.frame);
  const w=Math.max(6,frames*viewport.pxPerFrame);
  const tc=formatTimecode(frames,rate,{dropFrame});
  const onKeyDown=(event:KeyEventLike)=>{
    const key=keyboardKey(event);
    if(key==="Escape"){gesture.cancel();store.set(undefined);return;}
    const d=key==="ArrowRight"||key==="ArrowUp"?2:key==="ArrowLeft"||key==="ArrowDown"?-2:0;
    if(key==="Delete"||key==="Backspace"){onRemove(t.id);}
    else if(d)set(t.durationFrames+d);
    else if(key==="Enter"||key===" ")onSelect?.(t.id);
    else return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
  };
  const edge=(side:-1|1)=><View {...(side<0?left:right)} pointerEvents={disabled?"none":"auto"}
    style={{position:"absolute",top:0,bottom:0,width:HIT,[side<0?"left":"right"]:-HIT/2,alignItems:"center",justifyContent:"center",...NO_SELECT}}>
    <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-accent")}} style={{width:tokens.spacing.fixedStack,height:Math.max(16,height-20),borderRadius:forgeHairlineRadius.tick}}/>
  </View>;
  return <View style={{position:"absolute",left:cx-w/2,top,width:w,height,zIndex:controlTokens.layer.handle}}>
    <View {...{onKeyDown,focusable:!disabled,className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
        styled&&(selected?"border-2 border-focus bg-accent/30":"border-accent bg-accent/20"))}}
      accessible accessibilityRole="adjustable"
      accessibilityLabel={`Transition ${t.kind.replace(/_/g," ")}, ${tc}`}
      accessibilityHint="Arrow keys change the length. Delete removes it."
      aria-valuemin={1} aria-valuemax={max} aria-valuenow={frames} aria-valuetext={tc} aria-disabled={disabled}
      accessibilityActions={[{name:"increment",label:"Longer"},{name:"decrement",label:"Shorter"},{name:"activate",label:"Select"},{name:"remove",label:"Remove transition"}]}
      onAccessibilityAction={e=>{
        const a=e.nativeEvent.actionName;
        if(a==="increment")set(t.durationFrames+2);else if(a==="decrement")set(t.durationFrames-2);
        else if(a==="activate")onSelect?.(t.id);else if(a==="remove")onRemove(t.id);
      }}
      style={{flex:1,...NO_SELECT}}>
      <Pressable accessible={false} disabled={disabled} onPress={()=>onSelect?.(selected?undefined:t.id)} style={{flex:1}}>
        {/* Two crossing lines: the outgoing and incoming clip. */}
        <View pointerEvents="none" style={{flex:1,justifyContent:"center",overflow:"hidden"}}>
          <View {...{className:joinClasses(styled&&"bg-accent")}} style={{height:tokens.spacing.off2,transform:[{rotate:"18deg"}]}}/>
          <View {...{className:joinClasses(styled&&"bg-accent")}} style={{height:tokens.spacing.off2,marginTop:-tokens.spacing.off2,transform:[{rotate:"-18deg"}]}}/>
        </View>
      </Pressable>
    </View>
    {edge(-1)}{edge(1)}
  </View>;
}

/**
 * Transitions on the timeline (D-23), placed over the lanes like
 * `TimelinePlayhead`. Every cut (two touching clips) gets a 44pt target;
 * pressing it selects the cut for `TransitionPresetBrowser`, or adds the
 * default transition when there is no `onSelectCut`. A transition draws as a
 * band centered on its cut with an edge on each side: dragging an edge, or
 * the arrow keys, change its length, kept within what both clips' spare media
 * allows (`maxTransitionFrames`). Delete removes it. Audio cuts take a
 * crossfade. The engine drops a transition on its own when an edit separates
 * its clips; the band disappears with the next read.
 */
export function TransitionHandles({scope='TransitionHandles',revision=0,...props}:TransitionHandlesProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const signature=useIdentityMemo(()=>timelineEditSignature(props.tracks),[props.tracks]);
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,signature,props.viewport,props.rate,props.laneHeight,props.transitions]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><TransitionHandlesBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onAdd={(value)=>guard.run('onAdd',host=>host.onAdd(value))}
  onChange={(id,value)=>guard.run('onChange',host=>host.onChange(id,value))}
  onRemove={(id)=>guard.run('onRemove',host=>host.onRemove(id))}
  {...(props.onSelectCut?{onSelectCut:(value:Parameters<NonNullable<TransitionHandlesProps['onSelectCut']>>[0])=>guard.current()?.onSelectCut?.(value)}:{})}
  {...(props.onSelectTransition?{onSelectTransition:(value:Parameters<NonNullable<TransitionHandlesProps['onSelectTransition']>>[0])=>guard.current()?.onSelectTransition?.(value)}:{})}/></EditorInteractionScope.Provider>;
}
function TransitionHandlesBody({
 actionError=null,disabledReason,
  tracks,transitions,viewport,rate,laneHeight=56,defaultKind="cross_dissolve",defaultFrames=24,onAdd,onChange,onRemove,
  selectedCut,onSelectCut,selectedTransitionId,onSelectTransition,showCutTargets=true,dropFrame=false,disabled=false,
  unstyled=false,testID,style,...rest
}:TransitionHandlesProps&{actionError?:string|null}){
  if(!Number.isFinite(laneHeight)||laneHeight<44)throw new RangeError("laneHeight must be at least 44");
  const styled=!unstyled;
  return <View {...rest} pointerEvents="box-none" {...(testID?{testID}:{})}
    style={[{position:"absolute",left:0,top:0,width:viewport.widthPx,height:laneHeight*tracks.length,overflow:"hidden",direction:"ltr"},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {tracks.flatMap((track,i)=>{
      const top=i*laneHeight;
      return cutsOf(track).flatMap(cut=>{
        const pair=clipsOfCut(tracks,cut);
        if(!pair)return [];
        const max=maxTransitionFrames(pair.left,pair.right);
        const x=frameToX(viewport,cut.frame);
        if(x<-HIT||x>viewport.widthPx+HIT)return [];
        const existing=transitionAt(transitions,cut);
        const key=cut.leftClipId+"|"+cut.rightClipId;
        if(existing)return [<Band key={key} t={existing} cut={cut} max={max} top={top+laneHeight/2-14} height={tokens.spacing.fixedStatus}
          viewport={viewport} rate={rate} selected={existing.id===selectedTransitionId} onChange={onChange} onRemove={onRemove}
          onSelect={onSelectTransition} dropFrame={dropFrame} disabled={disabled||track.locked===true} styled={styled}/>];
        if(!showCutTargets)return [];
        const kind=transitionTarget(track)==="audio"?AUDIO_CROSSFADE:defaultKind;
        const request=transitionRequest(cut,tracks,kind,defaultFrames,rate);
        const off=disabled||track.locked===true||!request;
        const chosen=sameCut(cut,selectedCut);
        const at=formatTimecode(Math.max(0,Math.round(cut.frame)),rate,{dropFrame});
        return [<Pressable key={key} accessibilityRole="button" disabled={off}
          accessibilityLabel={`Cut between ${pair.left.label??"clip"} and ${pair.right.label??"clip"} at ${at}${chosen?", selected":""}`}
          accessibilityHint={track.locked?"Track locked":!request?"Not enough media past these clips for a transition"
            :onSelectCut?"Select this cut to add a transition":"Add a transition"}
          accessibilityState={{disabled:off,selected:chosen}}
          accessibilityActions={request?[{name:"add",label:kind===AUDIO_CROSSFADE?"Add crossfade":"Add transition"}]:[]}
          onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="add"&&request&&!off)onAdd(request);}}
          onPress={()=>{if(off)return;if(onSelectCut)onSelectCut(chosen?undefined:cut);else if(request)onAdd(request);}}
          {...(testID?{testID:testID+"-cut-"+key}:{})}
          {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
          style={{position:"absolute",left:x-HIT/2,top:top+(laneHeight-HIT)/2,width:HIT,height:HIT,alignItems:"center",justifyContent:"center",zIndex:controlTokens.layer.indicator,opacity:off?tokens.opacity.disabled:1}}>
          {/* A diamond on the cut. */}
          <View pointerEvents="none" {...{className:joinClasses(styled&&(chosen?"bg-focus border-2 border-focus":"bg-surface-raised border-2 border-accent"))}}
            style={{width:tokens.spacing.off14,height:tokens.spacing.off14,borderRadius:forgeRadius.sm,transform:[{rotate:"45deg"}]}}/>
        </Pressable>];
      });
    })}
  </View>;
}
