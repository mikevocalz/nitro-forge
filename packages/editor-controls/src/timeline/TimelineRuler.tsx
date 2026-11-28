import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Platform,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import type {FrameRate} from "../timebase.ts";
import {rulerTicks} from "./ruler.ts";
import {frameToX,visibleFrames,xToFrame,type TimelineViewport} from "./viewport.ts";
import {useFrameScrub} from "./useFrameScrub.ts";

/** A named point on the ruler. */
export interface TimelineMark {
  readonly frame:number;
  readonly label:string;
}
/** Props for {@linkcode TimelineRuler}. */
export interface TimelineRulerProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly viewport:TimelineViewport;
  readonly rate:FrameRate;
  readonly durationFrames:number;
  /** Named marks drawn as flags. */
  readonly marks?:readonly TimelineMark[];
  /** The committed playhead frame, the start of a ruler drag. */
  readonly frame:number;
  readonly onScrub?:(frame:number)=>void;
  /** Once per press-and-release on the ruler. */
  readonly onSeek:(frame:number)=>void;
  /** Minimum space between labels in layout units. @default 72 */
  readonly minLabelPx?:number;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;

/**
 * Time ruler (D-10): labeled ticks that switch between frames, seconds and
 * minutes as you zoom, plus named marks. Pressing or dragging anywhere on it
 * moves the playhead (D-11's "drag anywhere"): moves preview through
 * `onScrub`, release seeks once. The ruler is hidden from screen readers;
 * `TimelinePlayhead` is the accessible, keyboard-operable control for the
 * same position.
 */
export function TimelineRuler({scope='TimelineRuler',revision=0,...props}:TimelineRulerProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.disabled,props.viewport,props.durationFrames,props.rate]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined||!!props.disabled);
 return <TimelineRulerBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onSeek={(value)=>guard.run('onSeek',host=>host.onSeek(value))}
  {...(props.onScrub?{onScrub:(value:Parameters<NonNullable<TimelineRulerProps['onScrub']>>[0])=>guard.current()?.onScrub?.(value)}:{})}/>;
}
function TimelineRulerBody({
  actionError=null,disabledReason,
  viewport,rate,durationFrames,marks=[],frame,onScrub,onSeek,minLabelPx=72,disabled=false,
  className,unstyled=false,testID,style,...rest
}:TimelineRulerProps&{actionError?:string|null}){
  const clamp=(f:number)=>Math.min(durationFrames,Math.max(0,Math.round(f)));
  const scrub=useFrameScrub({frame:clamp(frame),disabled,onScrub,onCommit:onSeek,frameAt:p=>clamp(xToFrame(viewport,p.x))});
  const end=viewport.startFrame+visibleFrames(viewport);
  const ticks=viewport.widthPx>0?rulerTicks(viewport.startFrame,end,viewport.pxPerFrame,rate,minLabelPx):[];
  const styled=!unstyled;
  return <View {...rest} {...scrub.handlers} {...(testID?{testID}:{})}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
    {...{className:joinClasses(styled&&"bg-surface-sunken border-b border-border",className)}}
    style={[{height:44,overflow:"hidden",direction:"ltr",...NO_SELECT},style]}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    {ticks.map((t,i)=>{
      const x=frameToX(viewport,t.frame);
      // The wrapper is as wide as a label: a one-unit wrapper caps the label's
      // width at one unit on web (numberOfLines sets max-width: 100%).
      return <View key={i} pointerEvents="none" style={{position:"absolute",left:x,bottom:0,width:90,alignItems:"flex-start"}}>
        {t.label?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} numberOfLines={1}
          style={{position:"absolute",bottom:14,left:3,fontVariant:["tabular-nums"],width:90}}>{t.label}</Text>:null}
        <View {...{className:joinClasses(styled&&(t.label?"bg-text-muted":"bg-border"))}} style={{width:1,height:t.label?12:5}}/>
      </View>;
    })}
    {marks.map((m,i)=>{
      const x=frameToX(viewport,m.frame);
      if(x<-80||x>viewport.widthPx)return null;
      return <View key={"m"+i} pointerEvents="none" style={{position:"absolute",left:x,top:2,flexDirection:"row",alignItems:"center",gap:3}}>
        <View {...{className:joinClasses(styled&&"bg-accent")}} style={{width:2,height:14}}/>
        <Text {...{className:joinClasses(styled&&"text-text text-xs")}} numberOfLines={1}>{m.label}</Text>
      </View>;
    })}
  </View>;
}
