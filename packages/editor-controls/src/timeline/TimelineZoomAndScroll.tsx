import {useContext,useMemo as useIdentityMemo} from 'react';
import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {timelineEditSignature} from './timeline-identity.ts';
import {useRef} from "react";
import {Platform,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import type {FrameRate} from "../timebase.ts";
import {zoomLimits} from "./ruler.ts";
import {
  fitRange,frameToX,minimapScroll,minimapWindow,scrollBy,visibleFrames,zoomAt,
  type FrameRange,type TimelineViewport,
} from "./viewport.ts";

/** Props for {@linkcode TimelineZoomAndScroll}. */
export interface TimelineZoomAndScrollProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly viewport:TimelineViewport;
  /** View state, not an edit: called on every zoom step and mini-map move. */
  readonly onViewportChange:(viewport:TimelineViewport)=>void;
  readonly durationFrames:number;
  readonly rate:FrameRate;
  /** Zoom buttons keep this frame fixed when it is on screen. */
  readonly playheadFrame:number;
  /** Fit selection zooms to it; the button is disabled without one. */
  readonly selection?:FrameRange;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const STEP=1.5;

/**
 * Zoom and scroll controls (D-14): zoom out/in around the playhead (or the
 * view's center when the playhead is off screen), fit selection, fit all, and
 * a mini-map of the whole timeline whose window drags to scroll; pressing
 * elsewhere on it centers the view there. The mini-map is adjustable: arrows
 * scroll a quarter view. Pinch and Ctrl/Cmd-wheel zoom live on
 * `TimelineClipLane`, which shares this viewport.
 */
export function TimelineZoomAndScroll({scope='TimelineZoomAndScroll',revision=0,...props}:TimelineZoomAndScrollProps){
 const parent=useContext(EditorInteractionScope),owner=JSON.stringify(controlIdentity(scope,revision));
 const boundary=useEditorBoundary([owner,parent,props.disabledReason,props.disabled,props.durationFrames,props.rate,props.viewport.widthPx]);
 const guard=useScopedControl(boundary,props,props.disabledReason!==undefined||!!props.disabled);
 return <EditorInteractionScope.Provider value={boundary}><TimelineZoomAndScrollBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onViewportChange={(value)=>guard.current()?.onViewportChange(value)}/></EditorInteractionScope.Provider>;
}
function TimelineZoomAndScrollBody({
 actionError=null,disabledReason,
  viewport,onViewportChange,durationFrames,rate,playheadFrame,selection,disabled=false,className,unstyled=false,testID,style,...rest
}:TimelineZoomAndScrollProps&{actionError?:string|null}){
  const [mini,store]=useLocalStore(()=>({width:0}));
  const latest=useRef(viewport);
  latest.current=viewport;
  const grab=useRef<{offset:number}|undefined>(undefined);
  const styled=!unstyled;
  const limits=zoomLimits(Math.max(1,viewport.widthPx),durationFrames,rate);
  const px=frameToX(viewport,playheadFrame);
  const anchor=px>=0&&px<=viewport.widthPx?px:viewport.widthPx/2;
  const win=minimapWindow(viewport,durationFrames,Math.max(1,mini.width));
  const change=(next:TimelineViewport)=>{
    if(next.startFrame!==viewport.startFrame||next.pxPerFrame!==viewport.pxPerFrame)onViewportChange(next);
  };
  const handlers=useLocalPointer({
    disabled,
    onBegin:p=>{
      const w=minimapWindow(latest.current,durationFrames,Math.max(1,mini.width));
      const inside=p.x>=w.left&&p.x<=w.left+w.width;
      grab.current={offset:inside?p.x-w.left:w.width/2};
      if(!inside)change(minimapScroll(latest.current,p.x-w.width/2,durationFrames,mini.width));
    },
    onMove:p=>{if(grab.current)change(minimapScroll(latest.current,p.x-grab.current.offset,durationFrames,mini.width));},
    onRelease:()=>{grab.current=undefined;},
    onCancel:()=>{grab.current=undefined;},
  });
  const scrollQuarter=(d:-1|1)=>change(scrollBy(viewport,d*viewport.widthPx/4,durationFrames));
  const onKeyDown=(event:KeyEventLike)=>{
    const key=keyboardKey(event);
    if(key!=="ArrowLeft"&&key!=="ArrowRight")return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
    scrollQuarter(key==="ArrowLeft"?-1:1);
  };
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  // Same total as minimapWindow, so the playhead tick and the window agree.
  const total=Math.max(1,durationFrames,viewport.startFrame+visibleFrames(viewport));
  const percent=Math.round(Math.min(1,visibleFrames(viewport)/Math.max(1,durationFrames))*100);
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-2",className)}} style={style}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"center"}}>
      <Button title="Zoom out" variant="secondary" size="sm" {...id("zoom-out")}
        disabled={disabled||viewport.pxPerFrame<=limits.min} onPress={()=>change(zoomAt(viewport,anchor,1/STEP,durationFrames,rate))}/>
      <Button title="Zoom in" variant="secondary" size="sm" {...id("zoom-in")}
        disabled={disabled||viewport.pxPerFrame>=limits.max} onPress={()=>change(zoomAt(viewport,anchor,STEP,durationFrames,rate))}/>
      <Button title="Fit selection" variant="ghost" size="sm" {...id("fit-selection")} disabled={disabled||!selection}
        accessibilityHint={selection?"Zoom to the selected range":"Select a clip or mark a range first"}
        onPress={()=>{if(selection)change(fitRange(viewport,selection,durationFrames,rate));}}/>
      <Button title="Fit all" variant="ghost" size="sm" {...id("fit-all")} disabled={disabled||durationFrames===0}
        onPress={()=>change(fitRange(viewport,{start:0,end:durationFrames},durationFrames,rate))}/>
    </View>
    <View {...handlers} {...id("minimap")}
      {...{onKeyDown,focusable:!disabled,className:joinClasses(styled&&"rounded-control border border-border bg-surface-sunken focus-visible:ring-2 focus-visible:ring-focus")}}
      onLayout={e=>store.set({width:e.nativeEvent.layout.width})}
      accessible accessibilityRole="adjustable" accessibilityLabel="Timeline scroll position"
      accessibilityHint="Drag the window or use the arrow keys to scroll"
      aria-valuemin={0} aria-valuemax={Math.max(0,durationFrames)} aria-valuenow={Math.round(viewport.startFrame)}
      aria-valuetext={`Showing ${percent} percent of the timeline`} aria-disabled={disabled}
      accessibilityActions={[{name:"increment",label:"Scroll later"},{name:"decrement",label:"Scroll earlier"}]}
      onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="increment")scrollQuarter(1);if(e.nativeEvent.actionName==="decrement")scrollQuarter(-1);}}
      style={{height:44,direction:"ltr",opacity:disabled?0.45:1,...NO_SELECT}}>
      {mini.width>0?<View pointerEvents="none" {...{className:joinClasses(styled&&"rounded-control border-2 border-accent bg-accent/10")}}
        style={{position:"absolute",top:4,bottom:4,left:win.left,width:win.width}}/>:null}
      {mini.width>0&&durationFrames>0?<View pointerEvents="none" {...{className:joinClasses(styled&&"bg-accent")}}
        style={{position:"absolute",top:0,bottom:0,width:2,left:Math.min(mini.width-2,playheadFrame/total*mini.width)}}/>:null}
    </View>
  </View>;
}
