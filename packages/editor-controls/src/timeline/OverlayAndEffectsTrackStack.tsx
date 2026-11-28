import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
/*
 * Original implementation for NYC-Tron UI; no third-party source. Provenance
 * is recorded in docs/COMPONENT_OWNERSHIP.md.
 *
 * STRUCK 2026-11-05: effects and adjustment tracks. Forge has no video effects
 * pipeline (D-38 is deferred on the video-processing backend), so such a
 * track would hold clips nothing can render. No button adds one. The stack
 * gains that kind when Splice gets an effect track and a renderer for it.
 */
import type {ReactNode} from "react";
import {Pressable,Text,View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {TrackHeaders,type TrackFlag} from "./TrackHeaders.tsx";
import {TimelineClipLane,type TimelineClipLaneProps} from "./TimelineClipLane.tsx";
import {stackMoveTarget,stackOrder} from "./track-stack.ts";
import type {TrackKind} from "./edits.ts";

/** Props for {@linkcode OverlayAndEffectsTrackStack}. */
export interface OverlayAndEffectsTrackStackProps extends Omit<TimelineClipLaneProps,"tracks"> {
  /** The host's tracks in engine order; the stack groups them overlay, video, audio. */
  readonly tracks:TimelineClipLaneProps["tracks"];
  readonly onSetFlag:(trackId:string,flag:TrackFlag,value:boolean)=>void;
  readonly onRename:(trackId:string,name:string)=>void;
  /** Splice `moveTrack`: `toIndex` is a position in the host's list. */
  readonly onMoveTrack:(trackId:string,toIndex:number)=>void;
  /** Splice `addTrack`. */
  readonly onAddTrack:(kind:TrackKind)=>void;
  /** Header column width; the lanes take `viewport.widthPx`. @default 232, or 56 when `compactHeaders` */
  readonly headerWidth?:number;
  /**
   * Phone layout: headers shrink to track codes, and the opened track's full
   * row (name, switches, reorder) shows under the lanes.
   */
  readonly compactHeaders?:boolean;
  /**
   * Drawn over the lanes, in their coordinates, with the tracks in stack
   * order: `TransitionHandles`, `TimelinePlayhead`. Pass the same stack
   * order to them (`stackOrder(tracks)`).
   */
  readonly laneOverlay?:ReactNode;
}

/**
 * The track stack (D-31): `TrackHeaders` beside `TimelineClipLane`, with
 * overlay tracks above video tracks above audio tracks, Add video, Add
 * overlay and Add audio track, and a Reorder switch that turns the header
 * switches into move up and move down within each group. Overlay tracks are
 * picture over the video tracks and take the same clips. Every lane prop
 * passes through to `TimelineClipLane`.
 */
export function OverlayAndEffectsTrackStack({scope='OverlayAndEffectsTrackStack',revision=0,...props}:OverlayAndEffectsTrackStackProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const signature=useIdentityMemo(()=>timelineEditSignature(props.tracks),[props.tracks]);
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,signature,props.durationFrames,props.rate,props.laneHeight,props.tool,props.moveMode,props.rippleScope]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><OverlayAndEffectsTrackStackBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onSetFlag={(id,flag,value)=>guard.run('onSetFlag',host=>host.onSetFlag(id,flag,value))}
  onRename={(id,name)=>guard.run('onRename',host=>host.onRename(id,name))}
  onMoveTrack={(id,index)=>guard.run('onMoveTrack',host=>host.onMoveTrack(id,index))}
  onAddTrack={(kind)=>guard.run('onAddTrack',host=>host.onAddTrack(kind))}
  onEdit={(value)=>guard.run('onEdit',host=>host.onEdit(value))}
  onViewportChange={(value)=>guard.current()?.onViewportChange(value)}
  onSelect={(value)=>guard.current()?.onSelect(value)}
  {...(props.onToggleSelect?{onToggleSelect:(value:Parameters<NonNullable<OverlayAndEffectsTrackStackProps['onToggleSelect']>>[0])=>guard.current()?.onToggleSelect?.(value)}:{})}/></EditorInteractionScope.Provider>;
}
function OverlayAndEffectsTrackStackBody({
 actionError=null,disabledReason,
  tracks,onSetFlag,onRename,onMoveTrack,onAddTrack,compactHeaders=false,headerWidth=compactHeaders?56:232,laneOverlay,laneHeight=56,disabled=false,unstyled=false,testID,
  style,className,...lane
}:OverlayAndEffectsTrackStackProps&{actionError?:string|null}){
  const styled=!unstyled;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const shown=stackOrder(tracks);
  // Reorder mode is view state for this stack only.
  const [reorder,reorderStore]=useLocalStore(()=>false);
  const setReorder=(v:boolean)=>reorderStore.set(v);
  const [openId,openStore]=useLocalStore(()=>undefined as string|undefined);
  const opened=compactHeaders?shown.find(t=>t.id===openId):undefined;
  const headerProps={laneHeight,onSetFlag,onRename,onMove:onMoveTrack,moveTarget:(trackId:string,d:-1|1)=>stackMoveTarget(tracks,trackId,d),
    reorder,disabled,unstyled};
  return <View {...(testID?{testID}:{})} {...{className:joinClasses("gap-2",className)}} style={style}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}}>
      <Button title="Add video track" variant="secondary" size="sm" disabled={disabled} onPress={()=>onAddTrack("video")} {...id("add-video")}/>
      <Button title="Add overlay track" variant="secondary" size="sm" disabled={disabled} onPress={()=>onAddTrack("overlay")} {...id("add-overlay")}/>
      <Button title="Add audio track" variant="secondary" size="sm" disabled={disabled} onPress={()=>onAddTrack("audio")} {...id("add-audio")}/>
      <Pressable accessibilityRole="switch" aria-checked={reorder} accessibilityState={{checked:reorder,disabled:disabled||tracks.length<2}}
        disabled={disabled||tracks.length<2} accessibilityLabel="Reorder tracks" onPress={()=>setReorder(!reorder)} {...id("reorder")}
        {...{className:joinClasses(styled&&"rounded-control border-2 px-3 focus-visible:ring-2 focus-visible:ring-focus",
          styled&&(reorder?"border-focus bg-surface-sunken":"border-border bg-surface-raised"))}}
        style={{minHeight:44,justifyContent:"center",opacity:disabled||tracks.length<2?0.4:1}}>
        <Text {...{className:joinClasses(styled&&(reorder?"text-text font-semibold":"text-text"))}}>{reorder?"Done reordering":"Reorder"}</Text>
      </Pressable>
    </View>
    {/* Headers stay at the start of time, left, in RTL too: the lanes never mirror. */}
    {shown.length?<View style={{flexDirection:"row",direction:"ltr"}}>
      <TrackHeaders tracks={shown} {...headerProps} width={headerWidth} compact={compactHeaders}
        openTrackId={opened?.id} onOpenTrack={t=>openStore.set(t)} {...id("headers")}
        {...{className:joinClasses(styled&&"border-e border-border")}}/>
      <View>
        <TimelineClipLane {...lane} tracks={shown} laneHeight={laneHeight} disabled={disabled} unstyled={unstyled} {...id("lanes")}/>
        {laneOverlay??null}
      </View>
    </View>:<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{paddingVertical:12}}>
      No tracks yet. Add a video or audio track to start.</Text>}
    {opened?<View {...{className:joinClasses(styled&&"rounded-control border border-border")}} style={{overflow:"hidden"}}>
      {/* The full row for the opened track; moves still follow the stack order. */}
      <TrackHeaders tracks={[opened]} allTracks={tracks} {...headerProps} width="100%" moveTarget={(trackId,d)=>stackMoveTarget(tracks,trackId,d)}
        {...id("track-settings")}/>
    </View>:null}
  </View>;
}

