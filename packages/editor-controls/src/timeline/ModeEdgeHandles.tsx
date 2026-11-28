import {forgeHairlineRadius} from "../radius.ts";
import {useEffect,useMemo,useRef} from "react";
import {Platform,View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {createValueGesture} from "@nyc-tron/ui/components/gestures/value-gesture";
import type {FrameRate} from "../timebase.ts";
import type {RippleScope,TimelineClip,TimelineEdit,TimelineTrack} from "./edits.ts";
import {
  rippleTrimEdit,rippleTrimPreview,rollEdit,rollPair,rollPreview,type TrimModePreview,
} from "./trim-modes.ts";

/** Props for {@linkcode ModeEdgeHandles}. */
export interface ModeEdgeHandlesProps {
  readonly mode:"roll"|"ripple";
  readonly clip:TimelineClip;
  readonly track:TimelineTrack;
  readonly tracks:readonly TimelineTrack[];
  readonly rate:FrameRate;
  readonly pxPerFrame:number;
  readonly height:number;
  readonly scope:RippleScope;
  readonly onPreview:(preview:TrimModePreview|undefined)=>void;
  readonly onEdit:(edit:TimelineEdit)=>void;
  readonly disabled?:boolean;
  readonly unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const HIT=44;
const ZERO:TrimModePreview={delta:0,clips:{},valid:true};

/** The preview and edit for moving `edge` of the selected clip by `delta` under `mode`. */
export function modeEdge(p:Omit<ModeEdgeHandlesProps,"onPreview"|"onEdit"|"pxPerFrame"|"height">,edge:"head"|"tail",delta:number):{preview?:TrimModePreview;edit?:TimelineEdit|undefined}{
  if(p.mode==="roll"){
    const pair=rollPair(p.track,p.clip,edge);
    if(!pair)return {};
    const preview=rollPreview(p.track,pair.left,pair.right,delta);
    return {preview,edit:rollEdit(pair.left,pair.right,p.track.id,preview,p.rate)};
  }
  const preview=rippleTrimPreview(p.tracks,p.track,p.clip,edge,delta,p.scope);
  return {preview,edit:rippleTrimEdit(p.clip,p.track.id,edge,p.scope,preview,p.rate)};
}

function Edge({edge,...p}:ModeEdgeHandlesProps&{edge:"head"|"tail"}){
  const latest=useRef(p);
  latest.current=p;
  const x0=useRef(0);
  const available=p.mode==="ripple"||rollPair(p.track,p.clip,edge)!==undefined;
  const gesture=useMemo(()=>createValueGesture<TrimModePreview>({
    disabled:()=>latest.current.disabled??false,
    equals:(a,b)=>a.delta===b.delta&&a.valid===b.valid,
    preview:v=>latest.current.onPreview(v.delta===0?undefined:v),
    commit:v=>{
      latest.current.onPreview(undefined);
      const {edit}=modeEdge(latest.current,edge,v.delta);
      if(v.valid&&edit)latest.current.onEdit(edit);
    },
  }),[edge]);
  useEffect(()=>()=>gesture.cancel(),[gesture]);
  const handlers=useLocalPointer({
    disabled:p.disabled||!available,
    onBegin:pt=>{x0.current=pt.x;gesture.begin(ZERO);},
    onMove:pt=>{
      const d=Math.round((pt.x-x0.current)/latest.current.pxPerFrame);
      gesture.update(modeEdge(latest.current,edge,d).preview??ZERO);
    },
    onRelease:()=>{gesture.release();latest.current.onPreview(undefined);},
    onCancel:()=>{gesture.cancel();latest.current.onPreview(undefined);},
  });
  const nudge=(d:number)=>{
    if(p.disabled)return;
    const {edit}=modeEdge(p,edge,d);
    if(edit)p.onEdit(edit);
  };
  const onKeyDown=(event:KeyEventLike)=>{
    const key=keyboardKey(event);
    if(key==="Escape"){gesture.cancel();p.onPreview(undefined);return;}
    const d=key==="ArrowRight"?1:key==="ArrowLeft"?-1:0;
    if(!d)return;
    const e=event as {preventDefault?:()=>void;stopPropagation?:()=>void};
    e.preventDefault?.();e.stopPropagation?.();
    nudge(d);
  };
  if(!available)return null;
  const what=p.mode==="roll"?`Cut at ${edge==="head"?"start":"end"} of ${p.clip.label??"clip"}`:`Ripple ${edge==="head"?"start":"end"} of ${p.clip.label??"clip"}`;
  const styled=!p.unstyled;
  return <View {...handlers}
    {...{onKeyDown,focusable:!p.disabled,className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
    accessible accessibilityRole="adjustable" accessibilityLabel={what}
    accessibilityHint={p.mode==="roll"?"Drag to roll the cut. Arrow keys move it one frame.":"Drag to trim; later clips follow. Arrow keys move one frame."}
    aria-disabled={p.disabled}
    accessibilityActions={[{name:"increment",label:"Later"},{name:"decrement",label:"Earlier"}]}
    onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="increment")nudge(1);if(e.nativeEvent.actionName==="decrement")nudge(-1);}}
    style={{position:"absolute",top:0,height:Math.max(HIT,p.height),width:HIT,
      ...(edge==="head"?{left:-HIT/2}:{right:-HIT/2}),alignItems:"center",justifyContent:"center",zIndex:2,...NO_SELECT}}>
    {/* Roll draws a bar on both sides of the cut; ripple a bracket that opens toward the clip. */}
    <View pointerEvents="none" style={{flexDirection:"row",gap:2,alignItems:"center",direction:"ltr"}}>
      {p.mode==="roll"||edge==="tail"?<View {...{className:joinClasses(styled&&"bg-accent")}} style={{width:4,height:Math.max(20,p.height-12),borderRadius:forgeHairlineRadius.tick}}/>:null}
      {p.mode==="roll"||edge==="head"?<View {...{className:joinClasses(styled&&"bg-accent")}} style={{width:4,height:Math.max(20,p.height-12),borderRadius:forgeHairlineRadius.tick}}/>:null}
    </View>
  </View>;
}

/**
 * Edge handles for the roll and ripple tools (D-21) on the selected clip. A
 * roll handle appears only on an edge that touches another clip; a ripple
 * handle on both edges. Dragging previews through `onPreview` and release
 * emits one `roll` or `rippleTrim` edit; arrow keys and screen-reader steps
 * move one frame.
 */
export function ModeEdgeHandles(props:ModeEdgeHandlesProps){
  return <>
    <Edge edge="head" {...props}/>
    <Edge edge="tail" {...props}/>
  </>;
}
