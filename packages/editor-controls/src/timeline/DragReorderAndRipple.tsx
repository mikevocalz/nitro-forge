import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
/*
 * Original implementation for NYC-Tron UI; no third-party source. Provenance
 * is recorded in docs/COMPONENT_OWNERSHIP.md.
 */
import {Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {rippleDeleteEdit,type MoveMode,type RippleScope,type TimelineEdit,type TimelineTrack} from "./edits.ts";
import {TRIM_MODE_PROBLEM_TEXT,rippleDeletePreview} from "./trim-modes.ts";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

/** Props for {@linkcode DragReorderAndRipple}. */
export interface DragReorderAndRippleProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** Pass the same value to `TimelineClipLane` `moveMode`. `undefined` is a strict move. */
  readonly moveMode:MoveMode|undefined;
  readonly onMoveModeChange:(mode:MoveMode|undefined)=>void;
  /** Pass the same value to `TimelineClipLane` `rippleScope`. */
  readonly rippleScope:RippleScope;
  readonly onRippleScopeChange:(scope:RippleScope)=>void;
  readonly tracks:readonly TimelineTrack[];
  readonly selectedClipId?:string;
  /** The ripple delete, once per press. */
  readonly onEdit:(edit:TimelineEdit)=>void;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type ModeValue="strict"|MoveMode;
const MODES:readonly {value:ModeValue;label:string}[]=[
  {value:"strict",label:"No overlap"},{value:"overwrite",label:"Overwrite"},{value:"insert",label:"Insert"},
];
const MODE_HELP:Readonly<Record<ModeValue,string>>={
  strict:"A move that would cover another clip is refused.",
  overwrite:"A dropped clip replaces what it covers. Drag up or down to change track.",
  insert:"A dropped clip pushes later clips right. Drag up or down to change track.",
};

/**
 * Move and ripple settings (D-22): how a dragged clip lands on others
 * (refuse, overwrite, insert), which tracks a ripple shifts (this track or
 * every unlocked track), and Ripple delete for the selected clip, which
 * removes it and closes the gap as one edit. Ripple delete is disabled, with
 * the reason shown, when there is no selection, the track is locked, or
 * closing the gap would overlap a clip on another track.
 */
export function DragReorderAndRipple({scope='DragReorderAndRipple',revision=0,...props}:DragReorderAndRippleProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const signature=useIdentityMemo(()=>timelineEditSignature(props.tracks),[props.tracks]);
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,signature,props.selectedClipId,props.moveMode,props.rippleScope]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><DragReorderAndRippleBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onEdit={(value)=>guard.run('onEdit',host=>host.onEdit(value))}
  onMoveModeChange={(value)=>guard.current()?.onMoveModeChange(value)}
  onRippleScopeChange={(value)=>guard.current()?.onRippleScopeChange(value)}/></EditorInteractionScope.Provider>;
}
function DragReorderAndRippleBody({
 actionError=null,disabledReason,
  moveMode,onMoveModeChange,rippleScope,onRippleScopeChange,tracks,selectedClipId,onEdit,disabled=false,
  className,unstyled=false,testID,style,...rest
}:DragReorderAndRippleProps&{actionError?:string|null}){
  const styled=!unstyled;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const found=tracks.flatMap(t=>t.clips.filter(c=>c.id===selectedClipId).map(clip=>({track:t,clip})))[0];
  const preview=found?rippleDeletePreview(tracks,found.track,found.clip,rippleScope):undefined;
  const reason=!found?"Select a clip to ripple delete it":preview&&!preview.valid&&preview.problem?TRIM_MODE_PROBLEM_TEXT[preview.problem]:undefined;
  const mode:ModeValue=moveMode??"strict";
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-2",className)}} style={style}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    <SegmentedControl aria-label="When a moved clip meets another" options={MODES} value={mode} disabled={disabled}
      onChange={v=>onMoveModeChange(v==="strict"?undefined:v)} unstyled={unstyled} {...id("mode")}/>
    <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{MODE_HELP[mode]}</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:tokens.spacing.fixedElement}}>
      <SegmentedControl aria-label="Ripple affects" value={rippleScope} onChange={onRippleScopeChange} disabled={disabled}
        options={[{value:"track",label:"This track"},{value:"all",label:"All tracks"}]} unstyled={unstyled} {...id("scope")}/>
      <Button title="Ripple delete" variant="secondary" size="sm" disabled={disabled||!found||!preview?.valid} {...id("ripple-delete")}
        accessibilityHint={reason??"Remove the selected clip and close the gap"}
        onPress={()=>{if(found&&preview?.valid)onEdit(rippleDeleteEdit(found.clip.id,found.track.id,rippleScope));}}/>
    </View>
    {reason&&!disabled?<Text {...id("reason")} {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{reason}.</Text>:null}
  </View>;
}
