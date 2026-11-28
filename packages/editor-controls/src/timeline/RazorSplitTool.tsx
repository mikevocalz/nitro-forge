import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import type {FrameRate} from "../timebase.ts";
import {splitEdit,type TimelineEdit,type TimelineTrack} from "./edits.ts";
import type {TimelineTool} from "./TimelineClipLane.tsx";
import {exact} from '../exact-optional.ts';

/** Props for {@linkcode RazorSplitTool}. */
export interface RazorSplitToolProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly tool:TimelineTool;
  readonly onToolChange:(tool:TimelineTool)=>void;
  readonly tracks:readonly TimelineTrack[];
  readonly selectedClipId?:string;
  readonly playheadFrame:number;
  readonly rate:FrameRate;
  /** The split, once per press. */
  readonly onEdit:(edit:TimelineEdit)=>void;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

/**
 * Razor controls (D-20): a toggle that turns clip presses in
 * `TimelineClipLane` into splits at the pressed frame, and Split at playhead
 * for the selected clip. The button is disabled, with the reason spoken and
 * shown, unless a selected clip spans the playhead. Ripple edits live in
 * `RollSlipSlideControls` (ripple trim) and `DragReorderAndRipple` (ripple
 * delete).
 */
export function RazorSplitTool({scope='RazorSplitTool',revision=0,...props}:RazorSplitToolProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const signature=useIdentityMemo(()=>timelineEditSignature(props.tracks),[props.tracks]);
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,signature,props.tool,props.selectedClipId,props.rate]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><RazorSplitToolBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onEdit={(value)=>guard.run('onEdit',host=>host.onEdit(value))}
  onToolChange={(value)=>guard.current()?.onToolChange(value)}/></EditorInteractionScope.Provider>;
}
function RazorSplitToolBody({
 actionError=null,disabledReason,
  tool,onToolChange,tracks,selectedClipId,playheadFrame,rate,onEdit,disabled=false,className,unstyled=false,testID,style,...rest
}:RazorSplitToolProps&{actionError?:string|null}){
  const styled=!unstyled;
  const found=tracks.flatMap(t=>t.clips.filter(c=>c.id===selectedClipId).map(c=>({track:t,clip:c})))[0];
  const edit=found?splitEdit(found.clip,found.track.id,playheadFrame,rate):undefined;
  const reason=!found?"Select a clip to split it":!edit?"Move the playhead inside the selected clip":undefined;
  const on=tool==="razor";
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-2",className)}}
    style={[{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    <Pressable accessibilityRole="switch" aria-checked={on} accessibilityState={{checked:on,disabled}} disabled={disabled}
      accessibilityLabel="Razor" accessibilityHint="When on, pressing a clip splits it at that point"
      onPress={()=>onToolChange(on?"select":"razor")} {...id("toggle")}
      {...{className:joinClasses(styled&&"rounded-control border-2 px-3 focus-visible:ring-2 focus-visible:ring-focus",
        styled&&(on?"border-focus bg-surface-sunken":"border-border bg-surface-raised"))}}
      style={{minHeight:44,justifyContent:"center",opacity:disabled?0.4:1}}>
      <Text {...{className:joinClasses(styled&&(on?"text-text font-semibold":"text-text"))}}>{on?"Razor on":"Razor"}</Text>
    </Pressable>
    <Button title="Split at playhead" variant="secondary" size="sm" disabled={disabled||!edit} {...id("split")}
      accessibilityHint={reason??"Split the selected clip at the playhead"} onPress={()=>{if(edit)onEdit(edit);}}/>
    {reason&&!disabled?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{reason}.</Text>:null}
  </View>;
}
