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
import {TextField} from "@nyc-tron/ui/components/TextField";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import type {FrameRate} from "../timebase.ts";
import type {RippleScope,TimelineTrack} from "./edits.ts";
import {
  SPEED_RANGE,batchRemove,batchRippleDelete,batchShift,batchSpeed,selectedClips,type BatchEdit,type BatchResult,
} from "./batch.ts";

/** Props for {@linkcode BatchEditPanel}. */
export interface BatchEditPanelProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly tracks:readonly TimelineTrack[];
  /** The host's multi-selection (`TimelineClipLane` `selectedClipIds`). */
  readonly selectedClipIds:readonly string[];
  readonly rate:FrameRate;
  /** Scope for Ripple delete. @default "track" */
  readonly rippleScope?:RippleScope;
  /**
   * The whole batch, once per action. Send it to the engine as one
   * transaction (Splice `batch {ops}`): it applies all or nothing and undoes
   * as one step.
   */
  readonly onApply:(edits:readonly BatchEdit[])=>void;
  readonly onClearSelection?:()=>void;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

/**
 * Edits for several clips at once (D-41): shift by a number of frames, set
 * speed (the clip speed control the timeline core left out), remove, and
 * ripple delete. Each action checks the result first (no overlaps, no start
 * before 0, speeds Splice accepts, no locked track) and, when it passes,
 * emits the whole list once. A failed check disables the action and says
 * which clip is in the way.
 */
export function BatchEditPanel({scope='BatchEditPanel',revision=0,...props}:BatchEditPanelProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const signature=useIdentityMemo(()=>timelineEditSignature(props.tracks),[props.tracks]);
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,signature,props.selectedClipIds,props.rate,props.rippleScope]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><BatchEditPanelBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onApply={(edits)=>guard.run('onApply',host=>host.onApply(edits))}
  {...(props.onClearSelection?{onClearSelection:()=>guard.current()?.onClearSelection?.()}:{})}/></EditorInteractionScope.Provider>;
}
function BatchEditPanelBody({
 actionError=null,disabledReason,
  tracks,selectedClipIds,rate,rippleScope="track",onApply,onClearSelection,disabled=false,
  className,unstyled=false,testID,style,...rest
}:BatchEditPanelProps&{actionError?:string|null}){
  const [form,store]=useLocalStore(()=>({shift:"1",speed:"2"}));
  const styled=!unstyled;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const sel=selectedClips(tracks,selectedClipIds);
  const shiftFrames=/^[+\-−]?\d+$/.test(form.shift.trim())?Number(form.shift.trim().replace("−","-")):Number.NaN;
  const speed=Number(form.speed.trim().replace(/x$/i,""));
  const later=batchShift(tracks,selectedClipIds,Math.abs(shiftFrames)||0,rate);
  const earlier=batchShift(tracks,selectedClipIds,-(Math.abs(shiftFrames)||0),rate);
  const speedResult=batchSpeed(tracks,selectedClipIds,speed);
  const remove=batchRemove(tracks,selectedClipIds);
  const ripple=batchRippleDelete(tracks,selectedClipIds,rippleScope);
  const run=(r:BatchResult)=>{if(r.valid&&!disabled)onApply(r.edits);};
  const why=(r:BatchResult)=>r.valid?undefined:r.reason;
  const n=sel.length;
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-3",className)}} style={style}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}}>
      <Text accessibilityLiveRegion="polite" {...id("count")} {...{className:joinClasses(styled&&"text-text font-semibold")}}>
        {n?`${n} clip${n===1?"":"s"} selected`:"No clips selected"}</Text>
      {n&&onClearSelection?<Button title="Clear selection" variant="ghost" size="sm" onPress={onClearSelection} {...id("clear")}/>:null}
    </View>
    {!n?<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>
      Shift-click clips, or use Shift+Enter on a focused clip, to select several.</Text>:null}
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"flex-end",gap:8}}>
      <TextField id={(testID??"batch")+"-shift"} label="Shift by frames" value={form.shift} keyboardType="number-pad" editable={!disabled}
        onChangeText={shift=>store.set(f=>({...f,shift}))} style={{width:88}} errorText={Number.isNaN(shiftFrames)?"Whole frames":undefined}/>
      <View style={{flexDirection:"row",gap:8,direction:"ltr"}}>
      <Button title="Earlier" variant="secondary" size="sm" disabled={disabled||!earlier.valid} {...id("earlier")}
        accessibilityHint={why(earlier)??"Move every selected clip earlier"} onPress={()=>run(earlier)}/>
      <Button title="Later" variant="secondary" size="sm" disabled={disabled||!later.valid} {...id("later")}
        accessibilityHint={why(later)??"Move every selected clip later"} onPress={()=>run(later)}/>
      </View>
    </View>
    {n&&!earlier.valid&&!later.valid?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{why(later)}.</Text>
      :n&&(!earlier.valid||!later.valid)?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>
        {(!earlier.valid?"Earlier: "+why(earlier):"Later: "+why(later))+"."}</Text>:null}
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"flex-end",gap:8}}>
      <TextField id={(testID??"batch")+"-speed"} label={`Speed (${SPEED_RANGE.min}x to ${SPEED_RANGE.max}x)`} value={form.speed}
        keyboardType="decimal-pad" editable={!disabled} onChangeText={speed=>store.set(f=>({...f,speed}))} style={{width:88}}/>
      <Button title="Set speed" variant="secondary" size="sm" disabled={disabled||!speedResult.valid} {...id("speed")}
        accessibilityHint={why(speedResult)??"Set every selected clip to this speed"} onPress={()=>run(speedResult)}/>
    </View>
    {n&&!speedResult.valid?<Text {...id("speed-reason")} {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{why(speedResult)}.</Text>:null}
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}}>
      <Button title="Remove" variant="secondary" size="sm" disabled={disabled||!remove.valid} {...id("remove")}
        accessibilityHint={why(remove)??"Remove the selected clips and leave gaps"} onPress={()=>run(remove)}/>
      <Button title="Ripple delete" variant="secondary" size="sm" disabled={disabled||!ripple.valid} {...id("ripple")}
        accessibilityHint={why(ripple)??`Remove the selected clips and close the gaps on ${rippleScope==="all"?"every unlocked track":"their tracks"}`}
        onPress={()=>run(ripple)}/>
    </View>
  </View>;
}
