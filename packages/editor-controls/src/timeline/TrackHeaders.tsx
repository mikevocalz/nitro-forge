import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
import {useEffect,useRef} from "react";
import {Pressable,Text,TextInput,View,type DimensionValue,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {IconButton} from "@nyc-tron/ui/components/IconButton";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {trackSilenced,type TimelineTrack,type TrackKind} from "./edits.ts";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

/** A track switch Splice stores (`setTrackFlags`). */
export type TrackFlag="locked"|"hidden"|"muted"|"solo";

/** Props for {@linkcode TrackHeaders}. */
export interface TrackHeadersProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The same tracks, in the same order, as the lanes beside it. */
  readonly tracks:readonly TimelineTrack[];
  /** Match `TimelineClipLane` `laneHeight`. @default 56 */
  readonly laneHeight?:number;
  /** One call per toggle press. */
  readonly onSetFlag:(trackId:string,flag:TrackFlag,value:boolean)=>void;
  /** On Enter or blur with a changed, nonblank name. Escape restores the old one. */
  readonly onRename:(trackId:string,name:string)=>void;
  /** Move to `toIndex` in the host's track list (Splice `moveTrack`). */
  readonly onMove?:(trackId:string,toIndex:number)=>void;
  /**
   * Where a track goes when moved up (`-1`) or down (`1`). Defaults to its
   * neighbour in `tracks`; `OverlayAndEffectsTrackStack` keeps moves inside
   * a kind's group.
   */
  readonly moveTarget?:(trackId:string,direction:-1|1)=>number|undefined;
  /** Shows up/down buttons in place of the switches. */
  readonly reorder?:boolean;
  /** Header width. @default 232, or 56 when `compact` */
  readonly width?:DimensionValue;
  /**
   * Phone layout: each row is one 44pt button with the track's code (V1, O1,
   * A2) and its state, which calls `onOpenTrack`. The host shows that track's
   * full row elsewhere, as `OverlayAndEffectsTrackStack` does under the lanes.
   */
  readonly compact?:boolean;
  readonly openTrackId?:string|undefined;
  /** Every track, when `tracks` is a subset: solo on a track not shown still silences these. @default tracks */
  readonly allTracks?:readonly TimelineTrack[];
  readonly onOpenTrack?:(trackId:string|undefined)=>void;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

export const TRACK_KIND_LABEL:Readonly<Record<TrackKind,string>>={video:"Video",overlay:"Overlay",audio:"Audio"};
/** Which switches a kind of track has: hide on picture tracks, mute and solo on audio, lock on all. */
/** A short code per track: kind letter and position among tracks of that kind ("V1", "O2", "A1"). */
export function trackCode(track:TimelineTrack,tracks:readonly TimelineTrack[]):string{
  const same=tracks.filter(t=>t.kind===track.kind);
  return {video:"V",overlay:"O",audio:"A"}[track.kind]+(same.indexOf(track)+1);
}
export const trackFlags=(kind:TrackKind):readonly TrackFlag[]=>kind==="audio"?["locked","muted","solo"]:["locked","hidden"];

function LockGlyph({open,styled}:{open:boolean;styled:boolean}){
  const ink=styled?"border-text":"";
  return <View style={{alignItems:"center",width:tokens.spacing.fixedGroup,height:tokens.spacing.off18}}>
    <View {...{className:ink}} style={{width:tokens.spacing.off10,height:tokens.spacing.fixedElement,borderWidth:tokens.borderWidth.strong,borderBottomWidth:0,borderTopLeftRadius:forgeRadius.sm,borderTopRightRadius:forgeRadius.sm,
      marginLeft:open?tokens.spacing.fixedElement:0}}/>
    <View {...{className:styled?"bg-text":""}} style={{width:tokens.spacing.off14,height:tokens.spacing.fixedElement,borderRadius:forgeHairlineRadius.tick}}/>
  </View>;
}
function EyeGlyph({off,styled}:{off:boolean;styled:boolean}){
  return <View style={{width:tokens.spacing.off20,height:tokens.spacing.fixedGroup,alignItems:"center",justifyContent:"center"}}>
    <View {...{className:styled?"border-text":""}} style={{width:tokens.spacing.off18,height:tokens.spacing.fixedInset,borderWidth:tokens.borderWidth.strong,borderRadius:forgeRadius.sm,alignItems:"center",justifyContent:"center"}}>
      <View {...{className:styled?"bg-text":""}} style={{width:tokens.spacing.off5,height:tokens.spacing.off5,borderRadius:forgeHairlineRadius.tick}}/>
    </View>
    {off?<View {...{className:styled?"bg-text":""}} style={{position:"absolute",width:tokens.spacing.off22,height:tokens.spacing.off2,transform:[{rotate:"-35deg"}]}}/>:null}
  </View>;
}
function Letter({ch,styled}:{ch:string;styled:boolean}){
  return <Text {...{className:joinClasses(styled&&"text-text font-semibold")}}>{ch}</Text>;
}
function Chevron({up,styled}:{up:boolean;styled:boolean}){
  return <View {...{className:styled?(up?"border-b-text":"border-t-text"):""}} style={{width:0,height:0,borderLeftWidth:tokens.spacing.off7,borderRightWidth:tokens.spacing.off7,
    borderLeftColor:"transparent",borderRightColor:"transparent",...(up?{borderBottomWidth:tokens.spacing.fixedElement}:{borderTopWidth:tokens.spacing.fixedElement})}}/>;
}

function NameField({track,onRename,disabled,styled}:{track:TimelineTrack;onRename:(id:string,name:string)=>void;disabled:boolean;styled:boolean}){
  const [draft,store]=useLocalStore(()=>track.label);
  const editing=useRef(false);
  const dirty=useRef(false);
  // A rename from elsewhere (undo, another view) replaces the draft unless the user is typing.
  useEffect(()=>{if(!editing.current)store.set(track.label);},[track.label,store]);
  const commit=()=>{
    editing.current=false;
    if(!dirty.current)return;
    dirty.current=false;
    const name=store.get().trim();
    if(!name){store.set(track.label);return;}
    if(name!==track.label)onRename(track.id,name);
  };
  return <TextInput value={draft} editable={!disabled} accessibilityLabel={`Name of ${TRACK_KIND_LABEL[track.kind].toLowerCase()} track ${track.label}`}
    onFocus={()=>{editing.current=true;}} onChangeText={t=>{dirty.current=true;store.set(t);}} onSubmitEditing={commit} onBlur={commit}
    onKeyPress={e=>{if(e.nativeEvent.key==="Escape"){editing.current=false;dirty.current=false;store.set(track.label);}}}
    {...{className:joinClasses(styled&&"rounded-control text-text text-sm font-semibold px-1 focus-visible:ring-2 focus-visible:ring-focus")}}
    style={{minHeight:tokens.spacing.fixedStatus,minWidth:0,flexShrink:1,paddingVertical:tokens.spacing.off2}}/>;
}

/**
 * Track headers (D-18): one row per track, the height of its lane. Each row
 * has the track's name (edit in place; Enter or leaving the field renames,
 * Escape restores), its kind, and 44pt switches: lock on every track, hide
 * on video and overlay tracks, mute and solo on audio tracks. Solo silences
 * every audio track that is not soloed, and the header says so. In `reorder`
 * mode the switches give way to move up and move down buttons.
 */
export function TrackHeaders({scope='TrackHeaders',revision=0,...props}:TrackHeadersProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const signature=useIdentityMemo(()=>timelineEditSignature(props.tracks),[props.tracks]);
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,signature,props.laneHeight,props.compact,props.reorder]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><TrackHeadersBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onSetFlag={(id,flag,value)=>guard.run('onSetFlag',host=>host.onSetFlag(id,flag,value))}
  onRename={(id,name)=>guard.run('onRename',host=>host.onRename(id,name))}
  {...(props.onMove?{onMove:(id:Parameters<NonNullable<TrackHeadersProps['onMove']>>[0],index:Parameters<NonNullable<TrackHeadersProps['onMove']>>[1])=>guard.run('onMove',host=>host.onMove?.(id,index))}:{})}
  {...(props.onOpenTrack?{onOpenTrack:(value:Parameters<NonNullable<TrackHeadersProps['onOpenTrack']>>[0])=>guard.current()?.onOpenTrack?.(value)}:{})}/></EditorInteractionScope.Provider>;
}
function TrackHeadersBody({
 actionError=null,disabledReason,
  tracks,laneHeight=56,onSetFlag,onRename,onMove,moveTarget,reorder=false,compact=false,openTrackId,onOpenTrack,allTracks,width=compact?56:232,disabled=false,
  className,unstyled=false,testID,style,...rest
}:TrackHeadersProps&{actionError?:string|null}){
  if(!Number.isFinite(laneHeight)||laneHeight<44)throw new RangeError("laneHeight must be at least 44");
  const styled=!unstyled;
  const target=moveTarget??((id:string,d:-1|1)=>{const i=tracks.findIndex(t=>t.id===id);const j=i+d;return i<0||j<0||j>=tracks.length?undefined:j;});
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  return <View {...rest} {...(testID?{testID}:{})} accessibilityRole="list" accessibilityLabel="Track headers"
    {...{className:joinClasses(className)}} style={[{width},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {tracks.map(track=>{
      const silenced=trackSilenced(track,allTracks??tracks);
      const soloedAway=track.kind==="audio"&&!track.muted&&silenced;
      const status=track.locked?"Locked":soloedAway?"Silent: another track is soloed":silenced?(track.kind==="audio"?"Muted":"Hidden"):TRACK_KIND_LABEL[track.kind];
      const flagButton=(flag:TrackFlag)=>{
        const on=track[flag]===true;
        const label={locked:on?"Unlock":"Lock",hidden:on?"Show":"Hide",muted:on?"Unmute":"Mute",solo:on?"Unsolo":"Solo"}[flag];
        const icon=flag==="locked"?<LockGlyph open={!on} styled={styled}/>:flag==="hidden"?<EyeGlyph off={on} styled={styled}/>
          :<Letter ch={flag==="muted"?"M":"S"} styled={styled}/>;
        return <IconButton key={flag} size="sm" variant="ghost" selected={on} disabled={disabled} unstyled={unstyled}
          aria-label={`${label} ${track.label}`} icon={icon} onPress={()=>onSetFlag(track.id,flag,!on)} {...id(track.id+"-"+flag)}/>;
      };
      if(compact){
        const open=track.id===openTrackId;
        const marks=[track.locked&&"locked",track.hidden&&"hidden",track.muted&&"muted",track.solo&&"solo"].filter(Boolean).join(", ");
        return <View key={track.id} {...{className:joinClasses(styled&&"bg-surface-raised border-b border-border")}}
          style={{height:laneHeight,alignItems:"center",justifyContent:"center"}}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${track.label} track settings${marks?", "+marks:""}`}
            accessibilityState={{expanded:open,disabled}} aria-expanded={open} disabled={disabled}
            onPress={()=>onOpenTrack?.(open?undefined:track.id)} {...id(track.id+"-open")}
            {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
              styled&&(open?"border-focus bg-surface-sunken":"border-transparent"))}}
            style={{width:tokens.spacing.fixedTarget,minHeight:tokens.spacing.fixedTarget,alignItems:"center",justifyContent:"center",gap:tokens.borderWidth.hairline}}>
            <Text {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>{trackCode(track,tracks)}</Text>
            {status!==TRACK_KIND_LABEL[track.kind]?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>
              {track.locked?"Locked":silenced?(track.kind==="audio"?"Silent":"Hidden"):""}</Text>:null}
          </Pressable>
        </View>;
      }
      const up=target(track.id,-1),down=target(track.id,1);
      return <View key={track.id} accessibilityLabel={`${track.label}, ${status}`}
        {...{className:joinClasses(styled&&"bg-surface-raised border-b border-border")}}
        style={{height:laneHeight,flexDirection:"row",alignItems:"center",gap:tokens.spacing.fixedStack,paddingStart:tokens.spacing.fixedElement,paddingEnd:tokens.spacing.off2}}>
        <View style={{flex:1,minWidth:0,gap:tokens.borderWidth.hairline}}>
          <NameField track={track} onRename={onRename} disabled={disabled} styled={styled}/>
          <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text-muted text-xs px-1")}}>{status}</Text>
        </View>
        {reorder&&onMove?<>
          <IconButton size="sm" variant="ghost" disabled={disabled||up===undefined} unstyled={unstyled} aria-label={`Move ${track.label} up`}
            icon={<Chevron up styled={styled}/>} onPress={()=>{if(up!==undefined)onMove(track.id,up);}} {...id(track.id+"-up")}/>
          <IconButton size="sm" variant="ghost" disabled={disabled||down===undefined} unstyled={unstyled} aria-label={`Move ${track.label} down`}
            icon={<Chevron up={false} styled={styled}/>} onPress={()=>{if(down!==undefined)onMove(track.id,down);}} {...id(track.id+"-down")}/>
        </>:trackFlags(track.kind).map(flagButton)}
      </View>;
    })}
  </View>;
}
