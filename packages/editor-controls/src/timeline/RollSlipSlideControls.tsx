import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
import {Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import type {FrameRate} from "../timebase.ts";
import type {RippleScope,TimelineEdit,TimelineTrack} from "./edits.ts";
import {
  TRIM_MODE_PROBLEM_TEXT,rippleTrimEdit,rippleTrimPreview,rollEdit,rollPair,rollPreview,
  slideEdit,slidePreview,slipEdit,slipPreview,type TrimModePreview,
} from "./trim-modes.ts";
import type {TimelineTool} from "./TimelineClipLane.tsx";
import {exact} from '../exact-optional.ts';

/** Props for {@linkcode RollSlipSlideControls}. */
export interface RollSlipSlideControlsProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly tool:TimelineTool;
  readonly onToolChange:(tool:TimelineTool)=>void;
  readonly tracks:readonly TimelineTrack[];
  readonly selectedClipId?:string;
  readonly rate:FrameRate;
  /** Ripple scope for the ripple tool. @default "track" */
  readonly rippleScope?:RippleScope;
  /** One edit per nudge press. */
  readonly onEdit:(edit:TimelineEdit)=>void;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type Mode="slip"|"slide"|"roll"|"ripple";
const MODES:readonly {value:TimelineTool;label:string}[]=[
  {value:"select",label:"Select"},{value:"slip",label:"Slip"},{value:"slide",label:"Slide"},
  {value:"roll",label:"Roll"},{value:"ripple",label:"Ripple"},
];
const HELP:Readonly<Record<Mode,string>>={
  slip:"Shifts the media inside the clip; the clip stays put.",
  slide:"Moves the clip; touching neighbours give or take media.",
  roll:"Moves the cut at one edge; the clip next to it follows.",
  ripple:"Trims one edge; later clips move to keep the gaps.",
};
const isMode=(t:TimelineTool):t is Mode=>t==="slip"||t==="slide"||t==="roll"||t==="ripple";

/**
 * Trim tools (D-21): a picker for select, slip, slide, roll and ripple, which
 * sets `tool` on `TimelineClipLane` for drag editing, and nudge buttons (one
 * and ten frames each way) that apply the chosen tool to the selected clip,
 * which is the keyboard and screen-reader path. Roll and ripple act on the
 * edge chosen here. A nudge the engine would refuse is disabled, and the
 * reason is shown.
 */
export function RollSlipSlideControls({scope='RollSlipSlideControls',revision=0,...props}:RollSlipSlideControlsProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const signature=useIdentityMemo(()=>timelineEditSignature(props.tracks),[props.tracks]);
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,signature,props.tool,props.selectedClipId,props.rate,props.rippleScope]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><RollSlipSlideControlsBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onEdit={(value)=>guard.run('onEdit',host=>host.onEdit(value))}
  onToolChange={(value)=>guard.current()?.onToolChange(value)}/></EditorInteractionScope.Provider>;
}
function RollSlipSlideControlsBody({
 actionError=null,disabledReason,
  tool,onToolChange,tracks,selectedClipId,rate,rippleScope="track",onEdit,disabled=false,className,unstyled=false,testID,style,...rest
}:RollSlipSlideControlsProps&{actionError?:string|null}){
  const [edge,edgeStore]=useLocalStore(()=>"tail" as "head"|"tail");
  const styled=!unstyled;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const found=tracks.flatMap(t=>t.clips.filter(c=>c.id===selectedClipId).map(clip=>({track:t,clip})))[0];
  const attempt=(delta:number):{preview?:TrimModePreview;edit?:TimelineEdit|undefined}=>{
    if(!found||!isMode(tool))return {};
    const {track,clip}=found;
    if(tool==="slip"){const p=slipPreview(track,clip,delta);return {preview:p,edit:slipEdit(clip,track.id,p,rate)};}
    if(tool==="slide"){const p=slidePreview(track,clip,delta);return {preview:p,edit:slideEdit(clip,track.id,p,rate)};}
    if(tool==="roll"){
      const pair=rollPair(track,clip,edge);
      if(!pair)return {};
      const p=rollPreview(track,pair.left,pair.right,delta);
      return {preview:p,edit:rollEdit(pair.left,pair.right,track.id,p,rate)};
    }
    const p=rippleTrimPreview(tracks,track,clip,edge,delta,rippleScope);
    return {preview:p,edit:rippleTrimEdit(clip,track.id,edge,rippleScope,p,rate)};
  };
  const steps=[-10,-1,1,10];
  const results=steps.map(d=>attempt(d));
  const reason=!isMode(tool)?"Pick slip, slide, roll or ripple to nudge the selected clip"
    :!found?"Select a clip first"
    :found.track.locked?"Track locked"
    :tool==="roll"&&!rollPair(found.track,found.clip,edge)?`No clip touches the ${edge==="head"?"start":"end"} of this clip`
    :results.every(r=>!r.edit)?TRIM_MODE_PROBLEM_TEXT[results[2]?.preview?.problem??"media"]
    :undefined;
  const stepLabel=(d:number)=>`${Math.abs(d)} frame${Math.abs(d)===1?"":"s"} ${d<0?"earlier":"later"}`;
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-2",className)}} style={style}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    <SegmentedControl aria-label="Trim tool" options={MODES} value={MODES.some(m=>m.value===tool)?tool:""}
      onChange={onToolChange} disabled={disabled} unstyled={unstyled} {...id("tool")}/>
    {isMode(tool)?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{HELP[tool]}</Text>:null}
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}}>
      {tool==="roll"||tool==="ripple"?<SegmentedControl aria-label="Edge" value={edge} onChange={v=>edgeStore.set(v)}
        options={[{value:"head",label:"Start"},{value:"tail",label:"End"}]} disabled={disabled} unstyled={unstyled} {...id("edge")}/>:null}
      {/* Earlier to later, left to right in every layout direction: these step through time. */}
      <View style={{flexDirection:"row",gap:8,direction:"ltr"}}>
      {steps.map((d,i)=>{
        const r=results[i]!;
        return <Button key={d} title={(d>0?"+":"−")+Math.abs(d)} variant="secondary" size="sm" {...id("nudge"+d)}
          accessibilityLabel={stepLabel(d)} disabled={disabled||!r.edit}
          accessibilityHint={r.preview&&!r.preview.valid&&r.preview.problem?TRIM_MODE_PROBLEM_TEXT[r.preview.problem]:undefined}
          onPress={()=>{if(r.edit)onEdit(r.edit);}} style={{minWidth:52}}/>;
      })}
      </View>
    </View>
    {reason&&!disabled?<Text {...id("reason")} {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{reason}.</Text>:null}
  </View>;
}
