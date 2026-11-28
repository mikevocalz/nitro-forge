import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
import {useEffect,useLayoutEffect,useRef,type ReactNode} from "react";
import {Platform,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import type {LocalStore} from "@nyc-tron/ui/components/local-store";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {formatTimecode,type FrameRate} from "../timebase.ts";
import {ClipTrimHandles} from "./ClipTrimHandles.tsx";
import {ModeEdgeHandles} from "./ModeEdgeHandles.tsx";
import {
  clipLength,movePreview,snapTargets,splitEdit,trackSilenced,visibleClips,
  type MoveMode,type RippleScope,type TimelineClip,type TimelineEdit,type TimelineTrack,
} from "./edits.ts";
import {placementEdit,placementPreview,trackAtOffset,type Placement} from "./placement.ts";
import {
  TRIM_MODE_PROBLEM_TEXT,slideEdit,slidePreview,slipEdit,slipLimits,slipPreview,
  type ClipGeometry,type TrimModePreview,
} from "./trim-modes.ts";
import {positionToSeconds} from "./time.ts";
import {frameToX,scrollBy,visibleRange,zoomAt,type TimelineViewport} from "./viewport.ts";

/**
 * What a press or drag on a clip does. `razor` splits at the pressed frame
 * (D-20). `slip` and `slide` drag the selected clip's media or position
 * against its neighbours; `roll` and `ripple` turn its edges into roll and
 * ripple-trim handles (D-21).
 */
export type TimelineTool="select"|"razor"|"slip"|"slide"|"roll"|"ripple";

/** Props for {@linkcode TimelineClipLane}. */
export interface TimelineClipLaneProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** Tracks top to bottom. Map the engine's timeline read (Splice `timeline`) to this shape. */
  readonly tracks:readonly TimelineTrack[];
  readonly viewport:TimelineViewport;
  /** Pan, pinch and Ctrl/Cmd-wheel zoom. View state, not an edit. */
  readonly onViewportChange:(viewport:TimelineViewport)=>void;
  readonly rate:FrameRate;
  readonly durationFrames:number;
  readonly playheadFrame:number;
  readonly selectedClipId?:string;
  readonly onSelect:(clipId:string|undefined)=>void;
  /**
   * A multi-selection the host owns (D-41), drawn with the selection border.
   * Shift, Ctrl or Cmd with a press, or Shift with Enter, calls
   * `onToggleSelect`; without that callback those presses select as usual.
   */
  readonly selectedClipIds?:readonly string[];
  readonly onToggleSelect?:(clipId:string)=>void;
  /** One edit per finished gesture. */
  readonly onEdit:(edit:TimelineEdit)=>void;
  /** @default "select" */
  readonly tool?:TimelineTool;
  /**
   * How a dragged clip lands on others (D-22). Without it a move that would
   * overlap is refused. With it, dragging up or down onto another compatible
   * unlocked track moves the clip there.
   */
  readonly moveMode?:MoveMode;
  /** Ripple scope for insert moves and the ripple tool. @default "track" */
  readonly rippleScope?:RippleScope;
  /** Snap moves and trims to clip edges and the playhead within 8 layout units. @default true */
  readonly snapping?:boolean;
  /** Lane height, at least 44. @default 56 */
  readonly laneHeight?:number;
  /** Thumbnails, waveforms or other region content for a clip, drawn under its label. */
  readonly renderClipContent?:(clip:TimelineClip,track:TimelineTrack,size:{width:number;height:number})=>ReactNode;
  readonly dropFrame?:boolean;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

/** A drag in progress: the geometry it would give each clip it changes, and where a moved clip lands. */
type Drag={
  clipId:string;clips:Readonly<Record<string,ClipGeometry>>;valid:boolean;problem?:string;
  snappedTo?:number;target?:{trackId:string;startFrame:number;insert:boolean};
}|undefined;
type Pan={pan:(dx:number)=>void;panStart:()=>void};
const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const SNAP_PX=8;
const TAP_PX=4;
const PLACEMENT_TEXT:Readonly<Record<NonNullable<Placement["problem"]>,string>>={
  overlap:"Overlaps another clip",locked:"Track locked",kind:"Audio and video tracks do not mix",
};
const fromTrimMode=(clipId:string,p:TrimModePreview):Drag=>({clipId,clips:p.clips,valid:p.valid,
  ...(p.problem?{problem:TRIM_MODE_PROBLEM_TEXT[p.problem]}:{})});

interface ClipViewProps {
  clip:TimelineClip;track:TimelineTrack;tracks:readonly TimelineTrack[];viewport:TimelineViewport;rate:FrameRate;
  laneHeight:number;selected:boolean;inSet:boolean;tool:TimelineTool;playheadFrame:number;snapping:boolean;disabled:boolean;styled:boolean;
  dropFrame:boolean;drag:LocalStore<Drag>;dragState:Drag;pan:Pan;moveMode?:MoveMode;rippleScope:RippleScope;
  modifier:{current:boolean};
  onSelect:(id:string|undefined)=>void;onToggleSelect?:(id:string)=>void;onEdit:(e:TimelineEdit)=>void;
  renderClipContent?:TimelineClipLaneProps["renderClipContent"];
}

function ClipView(p:ClipViewProps){
  const {clip,track,viewport,rate,laneHeight,selected,inSet,tool,playheadFrame,snapping,styled,dropFrame,drag,dragState}=p;
  const locked=track.locked===true;
  const disabled=p.disabled;
  const latest=useRef(p);
  latest.current=p;
  const session=useRef<{x0:number;y0:number;moved:boolean;moving:boolean}|undefined>(undefined);
  useLayoutEffect(()=>{if(session.current?.moving){session.current=undefined;drag.set(undefined);}},[viewport.startFrame,viewport.pxPerFrame,viewport.widthPx]);
  const targets=()=>snapping?snapTargets(latest.current.tracks,clip.id,[latest.current.playheadFrame]):[];
  const threshold=snapping?SNAP_PX/viewport.pxPerFrame:0;
  const override=dragState?.clips[clip.id];
  const mine=dragState?.clipId===clip.id?dragState:undefined;
  // A clip moving to another lane stays drawn where it was, dimmed; the target lane draws the ghost.
  const leaving=mine?.target!==undefined&&mine.target.trackId!==track.id;
  const geometry={...clip,...(override&&!leaving?override:{})};
  const left=frameToX(viewport,geometry.startFrame);
  const width=Math.max(2,clipLength(geometry)*viewport.pxPerFrame);
  const invalid=mine!==undefined&&!mine.valid;
  const clear=()=>drag.set(undefined);
  const dragTool=(c:ClipViewProps)=>c.selected&&!c.track.locked&&(c.tool==="select"||c.tool==="slip"||c.tool==="slide");
  const handlers=useLocalPointer({
    disabled,
    onBegin:pt=>{
      const c=latest.current;
      session.current={x0:pt.x,y0:pt.y,moved:false,moving:dragTool(c)};
      if(!session.current.moving)c.pan.panStart();
    },
    onMove:pt=>{
      const s=session.current;
      if(!s)return;
      if(latest.current.disabled){session.current=undefined;clear();return;}
      const dx=pt.x-s.x0,dy=pt.y-s.y0;
      if(Math.abs(dx)>TAP_PX||Math.abs(dy)>TAP_PX)s.moved=true;
      if(!s.moved)return;
      const c=latest.current;
      if(!s.moving){c.pan.pan(dx);return;}
      const frames=Math.round(dx/c.viewport.pxPerFrame);
      if(c.tool==="slip"){
        const lim=slipLimits(c.clip);
        drag.set(fromTrimMode(c.clip.id,slipPreview(c.track,c.clip,Math.min(lim.max,Math.max(lim.min,frames)))));
        return;
      }
      if(c.tool==="slide"){drag.set(fromTrimMode(c.clip.id,slidePreview(c.track,c.clip,frames)));return;}
      // Select tool: a move, onto another lane when a move mode is set.
      const target=c.moveMode?trackAtOffset(c.tracks,c.track.id,dy/c.laneHeight)??c.track:c.track;
      const raw=c.clip.startFrame+dx/c.viewport.pxPerFrame;
      const snapped=movePreview(target,c.clip,raw,{targets:targets(),threshold});
      const place=placementPreview(c.track,target,c.clip,snapped.startFrame,c.moveMode);
      drag.set({clipId:c.clip.id,clips:{[c.clip.id]:{...c.clip,startFrame:place.startFrame}},valid:place.valid,
        ...(place.problem?{problem:PLACEMENT_TEXT[place.problem]}:{}),
        ...(snapped.snappedTo===undefined?{}:{snappedTo:snapped.snappedTo}),
        target:{trackId:target.id,startFrame:place.startFrame,insert:c.moveMode==="insert"}});
    },
    onRelease:pt=>{
      const s=session.current;
      session.current=undefined;
      const c=latest.current;
      if(c.disabled){clear();return;}
      if(s&&!s.moved){
        clear();
        if(c.modifier.current&&c.onToggleSelect){c.onToggleSelect(c.clip.id);return;}
        if(c.tool==="razor"){
          if(c.track.locked)return;
          const e=splitEdit(c.clip,c.track.id,c.clip.startFrame+pt.x/c.viewport.pxPerFrame,c.rate);
          if(e)c.onEdit(e);
        }else c.onSelect(c.clip.id);
        return;
      }
      if(s?.moving){
        const d=drag.get();
        clear();
        if(d?.clipId!==c.clip.id||!d.valid)return;
        const delta=(d.clips[c.clip.id]?.sourceIn??c.clip.sourceIn)-c.clip.sourceIn;
        if(c.tool==="slip"){
          const e=slipEdit(c.clip,c.track.id,{delta:Math.round(delta),clips:d.clips,valid:true},c.rate);
          if(e)c.onEdit(e);
        }else if(c.tool==="slide"){
          const moved=(d.clips[c.clip.id]?.startFrame??c.clip.startFrame)-c.clip.startFrame;
          const e=slideEdit(c.clip,c.track.id,{delta:moved,clips:d.clips,valid:true},c.rate);
          if(e)c.onEdit(e);
        }else if(d.target){
          const target=c.tracks.find(t=>t.id===d.target!.trackId)??c.track;
          const e=placementEdit(c.clip,c.track,placementPreview(c.track,target,c.clip,d.target.startFrame,c.moveMode),c.rate,c.moveMode,c.rippleScope);
          if(e)c.onEdit(e);
        }
      }
    },
    onCancel:()=>{session.current=undefined;clear();},
  });
  useEffect(()=>()=>{if(drag.get()?.clipId===clip.id)drag.set(undefined);},[drag,clip.id]);
  const nudge=(d:number)=>{
    if(disabled||locked)return;
    const target=movePreview(track,clip,clip.startFrame+d,{});
    const e=placementEdit(clip,track,placementPreview(track,track,clip,target.startFrame),rate);
    if(e)p.onEdit(e);
  };
  const split=()=>{
    if(disabled||locked)return;
    const e=splitEdit(clip,track.id,playheadFrame,rate);
    if(e)p.onEdit(e);
  };
  const onKeyDown=(event:KeyEventLike)=>{
    const key=keyboardKey(event);
    const shift=(event as {shiftKey?:boolean}).shiftKey===true;
    if(key==="Escape"){session.current=undefined;clear();return;}
    if((key==="Enter"||key===" ")&&shift&&p.onToggleSelect)p.onToggleSelect(clip.id);
    else if(key==="Enter"||key===" ")p.onSelect(clip.id);
    else if(selected&&(key==="ArrowLeft"||key==="ArrowRight"))nudge(key==="ArrowLeft"?-1:1);
    else if(key==="s"||key==="S")split();
    else return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
  };
  const tc=(f:number)=>formatTimecode(Math.max(0,Math.round(f)),rate,{dropFrame});
  const seconds=positionToSeconds(clipLength(geometry),rate);
  const name=clip.label??"Clip";
  const height=laneHeight-8;
  const hint=locked?"Track locked":tool==="razor"?"Press to split here"
    :tool==="slip"&&selected?"Drag to slip the media inside the clip"
    :tool==="slide"&&selected?"Drag to slide the clip between its neighbours"
    :selected?"Drag to move. Arrow keys nudge one frame.":"Press to select";
  const marked=selected||inSet;
  return <>
    {mine?.snappedTo!==undefined?<View pointerEvents="none" {...{className:joinClasses(styled&&"bg-focus")}}
      style={{position:"absolute",left:frameToX(viewport,mine.snappedTo)-0.5,top:0,bottom:0,width:1,zIndex:3}}/>:null}
    <View {...handlers}
      {...{onKeyDown,focusable:!disabled,className:joinClasses(
        styled&&"rounded-control bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus",
        styled&&(invalid?"border-2 border-danger":marked?"border-2 border-focus":"border border-border"),
        styled&&leaving&&"opacity-40")}}
      accessible accessibilityRole="button"
      accessibilityLabel={`${name}, ${track.label}, starts ${tc(clip.startFrame)}, ${seconds.toFixed(1)} seconds${selected||inSet?", selected":""}`}
      accessibilityHint={hint}
      accessibilityState={{selected:marked,disabled:disabled||locked}}
      accessibilityActions={[
        {name:"activate",label:"Select"},{name:"moveEarlier",label:"Move one frame earlier"},
        {name:"moveLater",label:"Move one frame later"},{name:"split",label:"Split at playhead"},
        ...(p.onToggleSelect?[{name:"toggleSelect",label:inSet?"Remove from selection":"Add to selection"}]:[]),
      ]}
      onAccessibilityAction={e=>{
        const a=e.nativeEvent.actionName;
        if(a==="activate")p.onSelect(clip.id);
        else if(a==="moveEarlier")nudge(-1);
        else if(a==="moveLater")nudge(1);
        else if(a==="split")split();
        else if(a==="toggleSelect")p.onToggleSelect?.(clip.id);
      }}
      style={{position:"absolute",left,top:4,width,height,zIndex:selected?2:1,overflow:"visible",...NO_SELECT}}>
      <View pointerEvents="none" style={{flex:1,overflow:"hidden",paddingHorizontal:6,paddingVertical:4,gap:2}}>
        <View style={{flexDirection:"row",justifyContent:"space-between",gap:6}}>
          <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-xs font-semibold")}} style={{flexShrink:1}}>{name}</Text>
          {selected&&width>96?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{fontVariant:["tabular-nums"]}}>{seconds.toFixed(1)+" s"}</Text>:null}
        </View>
        {invalid?<Text {...{className:joinClasses(styled&&"text-danger text-xs")}} numberOfLines={1}>{mine?.problem??"Overlaps another clip"}</Text>
          :p.renderClipContent?.(clip,track,{width,height:height-24})??null}
      </View>
    </View>
    {/* Siblings, not children: an accessible clip hides its children from
        VoiceOver and TalkBack, so the adjustable edges sit beside it. */}
    {selected&&!locked&&tool==="select"?<View pointerEvents="box-none" style={{position:"absolute",left,top:4,width,height,zIndex:3}}>
      <ClipTrimHandles clip={clip} track={track} rate={rate} pxPerFrame={viewport.pxPerFrame} height={height}
        snapTargets={snapping?snapTargets(p.tracks,clip.id,[playheadFrame]):[]} snapThreshold={threshold}
        dropFrame={dropFrame} disabled={disabled} unstyled={!styled}
        onPreview={(_,preview)=>drag.set(preview?{clipId:clip.id,clips:{[clip.id]:preview},valid:preview.valid,
          ...(preview.snappedTo===undefined?{}:{snappedTo:preview.snappedTo})}:undefined)} onEdit={p.onEdit}/>
    </View>:null}
    {selected&&!locked&&(tool==="roll"||tool==="ripple")?<View pointerEvents="box-none" style={{position:"absolute",left,top:4,width,height,zIndex:3}}>
      <ModeEdgeHandles mode={tool} clip={clip} track={track} tracks={p.tracks} rate={rate} pxPerFrame={viewport.pxPerFrame}
        height={height} scope={p.rippleScope} disabled={disabled} unstyled={!styled}
        onPreview={preview=>drag.set(preview?fromTrimMode(clip.id,preview):undefined)} onEdit={p.onEdit}/>
    </View>:null}
  </>;
}

/**
 * Clip lanes (D-15): one lane per track, clips positioned by frame, only the
 * visible ones mounted. Press a clip to select it; drag the selected clip to
 * move it (snapping to edges and the playhead, refusing overlaps unless a
 * `moveMode` lets the engine resolve them, D-22), drag its edges to trim
 * (D-19). With the razor tool a press splits there (D-20); slip, slide, roll
 * and ripple drag as D-21 describes. Locked tracks take no edits; hidden,
 * muted and solo-silenced tracks are dimmed. Dragging empty lane space or an
 * unselected clip pans; two fingers pinch-zoom around their midpoint; on web,
 * Ctrl/Cmd + wheel zooms at the pointer and Shift + wheel scrolls. Every
 * finished gesture emits one `TimelineEdit`.
 */
export function TimelineClipLane({scope='TimelineClipLane',revision=0,...props}:TimelineClipLaneProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const signature=useIdentityMemo(()=>timelineEditSignature(props.tracks),[props.tracks]);
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,signature,props.durationFrames,props.rate,props.laneHeight,props.tool,props.moveMode,props.rippleScope]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><TimelineClipLaneBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onEdit={(value)=>guard.run('onEdit',host=>host.onEdit(value))}
  onViewportChange={(value)=>guard.current()?.onViewportChange(value)}
  onSelect={(value)=>guard.current()?.onSelect(value)}
  {...(props.onToggleSelect?{onToggleSelect:(value:Parameters<NonNullable<TimelineClipLaneProps['onToggleSelect']>>[0])=>guard.current()?.onToggleSelect?.(value)}:{})}/></EditorInteractionScope.Provider>;
}
function TimelineClipLaneBody({
 actionError=null,disabledReason,
  tracks,viewport,onViewportChange,rate,durationFrames,playheadFrame,selectedClipId,onSelect,selectedClipIds,onToggleSelect,onEdit,
  tool="select",moveMode,rippleScope="track",snapping=true,laneHeight=56,renderClipContent,dropFrame=false,disabled=false,
  className,unstyled=false,testID,style,...rest
}:TimelineClipLaneProps&{actionError?:string|null}){
  if(!Number.isFinite(laneHeight)||laneHeight<44)throw new RangeError("laneHeight must be at least 44");
  const [dragState,drag]=useLocalStore(()=>undefined as Drag);
  const latest=useRef({viewport,onViewportChange,durationFrames,rate});
  latest.current={viewport,onViewportChange,durationFrames,rate};
  const base=useRef(viewport);
  const modifier=useRef(false);
  const pan:Pan={
    panStart:()=>{base.current=latest.current.viewport;},
    pan:dx=>{const l=latest.current;l.onViewportChange(scrollBy(base.current,-dx,l.durationFrames));},
  };
  const press=useRef({x0:0,moved:false});
  const handlers=useLocalPointer({
    disabled,
    onBegin:pt=>{press.current={x0:pt.x,moved:false};pan.panStart();},
    onMove:pt=>{
      const dx=pt.x-press.current.x0;
      if(Math.abs(dx)>TAP_PX)press.current.moved=true;
      if(press.current.moved)pan.pan(dx);
    },
    onRelease:()=>{if(!press.current.moved)onSelect(undefined);},
    // A second finger cancels the pan; the pinch then zooms from where the pan left off.
    onCancel:()=>{press.current.moved=true;base.current=latest.current.viewport;},
    onPinch:(scale,center)=>{const l=latest.current;l.onViewportChange(zoomAt(base.current,center.x,scale,l.durationFrames,l.rate));},
    onPinchEnd:()=>{},
  });
  const container=useRef<unknown>(null);
  useEffect(()=>{
    if(Platform.OS!=="web")return;
    const el=container.current as HTMLElement|null;
    if(!el?.addEventListener)return;
    const onWheel=(e:WheelEvent)=>{
      const l=latest.current;
      if(e.ctrlKey||e.metaKey){
        e.preventDefault();
        const x=e.clientX-el.getBoundingClientRect().left;
        l.onViewportChange(zoomAt(l.viewport,x,Math.exp(-e.deltaY/300),l.durationFrames,l.rate));
      }else if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)){
        e.preventDefault();
        // Chrome on macOS reports Shift+wheel as deltaX; Firefox as deltaY.
        l.onViewportChange(scrollBy(l.viewport,Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY,l.durationFrames));
      }
    };
    // The responder events carry no modifier keys, so read them as the pointer goes down.
    const onDown=(e:PointerEvent)=>{modifier.current=e.shiftKey||e.ctrlKey||e.metaKey;};
    el.addEventListener("wheel",onWheel,{passive:false});
    el.addEventListener("pointerdown",onDown,{capture:true});
    return ()=>{el.removeEventListener("wheel",onWheel);el.removeEventListener("pointerdown",onDown,{capture:true});};
  },[]);
  const styled=!unstyled;
  const range=visibleRange(viewport);
  const inSet=new Set(selectedClipIds??[]);
  const dragged=dragState?.target;
  const draggedClip=dragState?tracks.flatMap(t=>t.clips).find(c=>c.id===dragState.clipId):undefined;
  const originId=draggedClip?tracks.find(t=>t.clips.includes(draggedClip))?.id:undefined;
  return <View {...rest} ref={container as never} {...(testID?{testID}:{})} accessibilityRole="list" accessibilityLabel="Timeline tracks"
    {...{className:joinClasses(className)}} style={[{width:viewport.widthPx,direction:"ltr"},style]}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    {tracks.map(track=>{
      const clips=visibleClips(track,{start:range.start-1,end:range.end+1});
      const sel=track.clips.find(c=>c.id===selectedClipId);
      if(sel&&!clips.includes(sel))clips.push(sel);
      const ghost=dragged&&draggedClip&&dragged.trackId===track.id?{target:dragged,clip:draggedClip}:undefined;
      const foreign=ghost!==undefined&&track.id!==originId;
      const silenced=trackSilenced(track,tracks);
      return <View key={track.id} {...handlers}
        {...{className:joinClasses(styled&&"bg-surface-sunken border-b border-border",styled&&foreign&&"bg-surface-raised")}}
        accessibilityLabel={track.label+(track.locked?", locked":"")+(silenced?", "+(track.kind==="audio"?"silent":"hidden"):"")}
        style={{height:laneHeight,overflow:"hidden",...NO_SELECT}}>
        <Text pointerEvents="none" numberOfLines={1} {...{className:joinClasses(styled&&"text-text-muted text-xs")}}
          style={{position:"absolute",left:6,bottom:2,zIndex:0}}>{track.label+(track.locked?" (locked)":"")}</Text>
        <View pointerEvents="box-none" {...{className:joinClasses(styled&&silenced&&"opacity-50")}} style={{position:"absolute",left:0,top:0,right:0,bottom:0}}>
          {clips.map(clip=><ClipView key={clip.id} clip={clip} track={track} tracks={tracks} viewport={viewport} rate={rate}
            laneHeight={laneHeight} selected={clip.id===selectedClipId} inSet={inSet.has(clip.id)} tool={tool} playheadFrame={playheadFrame}
            snapping={snapping} disabled={disabled} styled={styled} dropFrame={dropFrame} drag={drag} dragState={dragState}
            pan={pan} moveMode={moveMode} rippleScope={rippleScope} modifier={modifier}
            onSelect={onSelect} onToggleSelect={onToggleSelect} onEdit={onEdit} renderClipContent={renderClipContent}/>)}
        </View>
        {ghost?<>
          {foreign?<View pointerEvents="none"
            {...{className:joinClasses(styled&&"rounded-control border-2",styled&&(dragState?.valid?"border-focus":"border-danger"))}}
            style={{position:"absolute",left:frameToX(viewport,ghost.target.startFrame),top:4,height:laneHeight-8,
              width:Math.max(2,clipLength(ghost.clip)*viewport.pxPerFrame),borderStyle:"dashed",zIndex:4}}/>:null}
          {ghost.target.insert?<View pointerEvents="none" {...{className:joinClasses(styled&&"bg-focus")}}
            style={{position:"absolute",left:frameToX(viewport,ghost.target.startFrame)-1,top:0,bottom:0,width:3,zIndex:5}}/>:null}
        </>:null}
      </View>;
    })}
  </View>;
}
