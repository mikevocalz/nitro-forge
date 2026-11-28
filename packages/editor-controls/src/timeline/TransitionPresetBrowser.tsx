import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
/*
 * Original implementation for NYC-Tron UI; no third-party source. Provenance
 * is recorded in docs/COMPONENT_OWNERSHIP.md.
 *
 * Static diagrams identify transition kinds. The host compositor supplies
 * actual media preview through renderPreview; diagrams are not video output.
 */
import type {ReactNode} from "react";
import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {TextField} from "@nyc-tron/ui/components/TextField";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {formatTimecode,type FrameRate} from "../timebase.ts";
import {framesToSeconds} from "./time.ts";
import {
  TRANSITION_KINDS,filterTransitionKinds,transitionDiagram,type TransitionKindInfo,
} from "./transition-presets.ts";
import type {TransitionTarget} from "./transitions.ts";
import {exact} from '../exact-optional.ts';

/** The cut the browser applies to, as the host resolved it. */
export interface PresetBrowserCut {
  /** Video/overlay cuts take visual kinds, audio cuts the crossfade. */
  readonly target:TransitionTarget;
  /** `maxTransitionFrames` for the cut. */
  readonly maxFrames:number;
  /** Kind already on the cut, if it has a transition. */
  readonly currentKind?:string;
}

/** Props for {@linkcode TransitionPresetBrowser}. */
export interface TransitionPresetBrowserProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** @default TRANSITION_KINDS (the kinds Splice stores) */
  readonly kinds?:readonly TransitionKindInfo[];
  /** Host compositor preview of actual source media. Static diagrams remain labelled diagrams. */
  readonly renderPreview?:(kind:string,durationFrames:number)=>ReactNode;
  /** The selected cut, or `undefined`; Apply is disabled with the reason shown until there is one. */
  readonly cut?:PresetBrowserCut;
  readonly rate:FrameRate;
  /** Length presets in seconds. @default [0.5, 1, 2] */
  readonly presetsSeconds?:readonly number[];
  /** Once per Apply press, with the length clamped to the cut. */
  readonly onApply:(kind:string,durationFrames:number,durationSeconds:number)=>void;
  readonly dropFrame?:boolean;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

function Diagram({kind,styled}:{kind:string;styled:boolean}){
  const d=transitionDiagram(kind);
  const a=joinClasses(styled&&"bg-surface-sunken border border-border");
  const b=joinClasses(styled&&"bg-primary/25 border border-primary");
  const tile=(cls:string,label:string,extra:object={})=><View {...{className:cls}}
    style={{width:30,height:22,borderRadius:forgeRadius.sm,alignItems:"center",justifyContent:"center",...extra}}>
    <Text {...{className:joinClasses(styled&&"text-text text-xs")}}>{label}</Text>
  </View>;
  // Drawn left to right in every layout direction: the diagram is a picture of time.
  return <View aria-hidden pointerEvents="none" style={{flexDirection:"row",alignItems:"center",width:76,height:28,direction:"ltr"}}>
    {d.shape==="overlap"?<>{tile(a,"A")}{tile(b,"B",{marginLeft:-12,opacity:0.85})}</>
      :d.shape==="dip"?<>{tile(a,"A")}
        <View {...{className:joinClasses(styled&&(d.through==="black"?"bg-text":"bg-surface-raised border border-text"))}}
          style={{width:10,height:22,marginHorizontal:3,borderRadius:forgeHairlineRadius.tick}}/>{tile(b,"B")}</>
      :<>{tile(a,"A")}
        <View style={{width:12,alignItems:"center",justifyContent:"center"}}>
          <View {...{className:joinClasses(styled&&(d.direction==="left"?"border-r-text":"border-l-text"))}} style={{width:0,height:0,
            borderTopWidth:6,borderBottomWidth:6,borderTopColor:"transparent",borderBottomColor:"transparent",
            ...(d.direction==="left"?{borderRightWidth:8}:{borderLeftWidth:8})}}/>
        </View>
        {tile(b,"B",d.shape==="push"?{borderStyle:"dashed"}:{})}</>}
  </View>;
}

/**
 * Transition chooser (D-37): search, a list of kinds with a drawn diagram
 * each, a length (presets in seconds, or a frame at a time, shown as
 * timecode) and Apply to the selected cut. Only kinds that fit the cut's
 * track are offered: visual kinds on video and overlay cuts, the crossfade on
 * audio cuts. Apply is disabled, with the reason shown, until a cut is
 * selected, and when the clips have no spare media for a transition.
 */
export function TransitionPresetBrowser({scope='TransitionPresetBrowser',revision=0,...props}:TransitionPresetBrowserProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,props.cut,props.rate,props.kinds]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><TransitionPresetBrowserBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onApply={(kind,frames,seconds)=>guard.run('onApply',host=>host.onApply(kind,frames,seconds))}/></EditorInteractionScope.Provider>;
}
function TransitionPresetBrowserBody({
 actionError=null,disabledReason,
  renderPreview,kinds=TRANSITION_KINDS,cut,rate,presetsSeconds=[0.5,1,2],onApply,dropFrame=false,disabled=false,
  className,unstyled=false,testID,style,...rest
}:TransitionPresetBrowserProps&{actionError?:string|null}){
  if(kinds.length>256||new Set(kinds.map(k=>k.kind)).size!==kinds.length||presetsSeconds.length>64||presetsSeconds.some(n=>!Number.isFinite(n)||n<=0)||cut!==undefined&&(!Number.isSafeInteger(cut.maxFrames)||cut.maxFrames<0))throw new RangeError("Invalid transition catalog");
  const fps=rate.numerator/rate.denominator;
  const [state,store]=useLocalStore(()=>({query:"",kind:"",frames:Math.max(1,Math.round(fps))}));
  const styled=!unstyled;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const shown=filterTransitionKinds(kinds,state.query,cut?.target);
  const kind=shown.find(k=>k.kind===state.kind)??shown.find(k=>k.kind===cut?.currentKind)??shown[0];
  const max=cut?.maxFrames??0;
  const frames=Math.max(1,max>0?Math.min(max,state.frames):state.frames);
  const reason=!cut?"Select a cut on the timeline":max<1?"These clips have no spare media for a transition"
    :!kind?"No transition matches the search":undefined;
  const tc=(f:number)=>formatTimecode(f,rate,{dropFrame});
  const presets=presetsSeconds.map(s=>({value:String(Math.max(1,Math.round(s*fps))),label:s+" s"}));
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-3",className)}} style={style}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {kind&&renderPreview?<View accessibilityLabel="Live transition preview">{renderPreview(kind.kind,frames)}</View>:<Text {...{className:joinClasses(styled&&"text-text-muted")}}>Live transition preview not provided by this editor</Text>}
    <TextField id={(testID??"transitions")+"-search"} label="Search transitions" value={state.query}
      maxLength={128} onChangeText={query=>store.set(s=>({...s,query}))} editable={!disabled} autoCorrect={false}/>
    <View accessibilityRole="radiogroup" accessibilityLabel="Transition" style={{gap:4}}>
      {shown.length?shown.map(k=>{
        const on=k.kind===kind?.kind;
        return <Pressable key={k.kind} accessibilityRole="radio" aria-checked={on} accessibilityState={{checked:on,disabled}}
          disabled={disabled} onPress={()=>store.set(s=>({...s,kind:k.kind}))} {...id("kind-"+k.kind)}
          {...{className:joinClasses(styled&&"rounded-control border px-2 focus-visible:ring-2 focus-visible:ring-focus",
            styled&&(on?"border-focus bg-surface-sunken":"border-transparent"))}}
          style={{minHeight:52,flexDirection:"row",alignItems:"center",gap:12,paddingVertical:6}}>
          <Diagram kind={k.kind} styled={styled}/>
          <View style={{flex:1,minWidth:0,gap:2}}>
            <Text {...{className:joinClasses(styled&&(on?"text-text font-semibold":"text-text"))}}>{k.label}</Text>
            <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{k.description}</Text>
          </View>
          {k.kind===cut?.currentKind?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>On this cut</Text>:null}
        </Pressable>;
      }):<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{paddingVertical:8}}>
        {cut?"No transition matches the search. Clear it to see every kind.":"No transition matches the search."}</Text>}
    </View>
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}}>
      <SegmentedControl aria-label="Transition length" options={presets} value={String(frames)} disabled={disabled}
        onChange={v=>store.set(s=>({...s,frames:Number(v)}))} unstyled={unstyled} {...id("length")}/>
      <View style={{flexDirection:"row",gap:8,direction:"ltr"}}>
      <Button title="−1" variant="secondary" size="sm" accessibilityLabel="One frame shorter" disabled={disabled||frames<=1}
        onPress={()=>store.set(s=>({...s,frames:Math.max(1,frames-1)}))} style={{minWidth:44}} {...id("shorter")}/>
      <Button title="+1" variant="secondary" size="sm" accessibilityLabel="One frame longer" disabled={disabled||(max>0&&frames>=max)}
        onPress={()=>store.set(s=>({...s,frames:frames+1}))} style={{minWidth:44}} {...id("longer")}/>
      </View>
      <Text {...id("length-tc")} {...{className:joinClasses(styled&&"text-text text-sm")}} style={{fontVariant:["tabular-nums"]}}>
        {tc(frames)}{max>0?` of up to ${tc(max)}`:""}</Text>
    </View>
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}}>
      <Button title={cut?.currentKind?"Replace transition":"Apply to cut"} variant="primary" size="sm" disabled={disabled||reason!==undefined}
        accessibilityHint={reason} {...id("apply")}
        onPress={()=>{if(kind&&!reason)onApply(kind.kind,frames,framesToSeconds(frames,rate));}}/>
      {reason?<Text {...id("reason")} {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{reason}.</Text>:null}
    </View>
  </View>;
}
