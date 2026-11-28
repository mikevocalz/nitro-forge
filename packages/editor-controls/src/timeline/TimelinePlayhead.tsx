import {forgeRadius} from "../radius.ts";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Platform,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {formatTimecode,type FrameRate} from "../timebase.ts";
import {frameForKey} from "./frame-keys.ts";
import {frameToX,xToFrame,type TimelineViewport} from "./viewport.ts";
import {useFrameScrub} from "./useFrameScrub.ts";
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";

/** Props for {@linkcode TimelinePlayhead}. */
export interface TimelinePlayheadProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly viewport:TimelineViewport;
  /** The player's reported frame; the line follows it during playback. */
  readonly frame:number;
  readonly durationFrames:number;
  readonly rate:FrameRate;
  /** Height of the line: the ruler plus every lane it crosses. */
  readonly height:number;
  readonly onScrub?:(frame:number)=>void;
  /** Once per drag release, key press or screen-reader step. */
  readonly onSeek:(frame:number)=>void;
  readonly dropFrame?:boolean;
  readonly disabled?:boolean;
  unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const HIT=44;

/**
 * The playhead (D-11): a line across the ruler and every lane at `frame`,
 * with a 44pt head that drags to scrub. Place it absolutely over the ruler and
 * lanes. The head is the keyboard and screen-reader control for the time
 * position (arrows one frame, Page Up/Down one second, Home/End); when the
 * frame is scrolled out of view the head pins to the nearer edge so it stays
 * reachable. Keep it in view during playback with `followPlayhead`.
 */
export function TimelinePlayhead({scope='TimelinePlayhead',revision=0,...props}:TimelinePlayheadProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.disabled,props.viewport,props.height,props.durationFrames,props.rate]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined||!!props.disabled);
 return <TimelinePlayheadBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onSeek={(value)=>guard.run('onSeek',host=>host.onSeek(value))}
  {...(props.onScrub?{onScrub:(value:Parameters<NonNullable<TimelinePlayheadProps['onScrub']>>[0])=>guard.current()?.onScrub?.(value)}:{})}/>;
}
function TimelinePlayheadBody({
  actionError=null,disabledReason,
  viewport,frame,durationFrames,rate,height,onScrub,onSeek,dropFrame=false,disabled=false,unstyled=false,testID,style,...rest
}:TimelinePlayheadProps&{actionError?:string|null}){
  const clamp=(f:number)=>Math.min(durationFrames,Math.max(0,Math.round(f)));
  const committed=clamp(frame);
  const rawX=frameToX(viewport,committed);
  const headLeft=Math.min(Math.max(rawX,0),viewport.widthPx)-HIT/2;
  // Grab mode: pressing the head does not move it; dragging moves it by the travel.
  const scrub=useFrameScrub({frame:committed,disabled,onScrub,onCommit:onSeek,
    frameAt:p=>clamp(xToFrame(viewport,headLeft+p.x)),grabPxPerFrame:viewport.pxPerFrame,durationFrames});
  const x=frameToX(viewport,scrub.shown);
  const inView=x>=0&&x<=viewport.widthPx;
  const shownHead=Math.min(Math.max(x,0),viewport.widthPx)-HIT/2;
  const styled=!unstyled;
  const tc=(f:number)=>formatTimecode(f,rate,{dropFrame});
  const onKeyDown=(event:KeyEventLike)=>{
    const key=keyboardKey(event);
    if(key==="Escape"){scrub.cancel();return;}
    const next=frameForKey(key,committed,durationFrames,rate);
    if(next===undefined||disabled)return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
    if(next!==committed)onSeek(next);
  };
  const step=(d:number)=>{const n=clamp(committed+d);if(!disabled&&n!==committed)onSeek(n);};
  return <View {...rest} pointerEvents="box-none" {...(testID?{testID}:{})}
    style={[{position:"absolute",left:0,top:0,width:viewport.widthPx,height,direction:"ltr"},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {inView?<View pointerEvents="none" {...{className:joinClasses(styled&&"bg-accent")}}
      style={{position:"absolute",left:x-tokens.borderWidth.hairline,top:0,width:tokens.spacing.off2,height}}/>:null}
    <View {...scrub.handlers}
      {...{onKeyDown,focusable:!disabled,className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
      accessible accessibilityRole="adjustable" accessibilityLabel="Playhead"
      accessibilityHint="Drag to scrub. Arrow keys step one frame, Page Up and Page Down one second."
      aria-valuemin={0} aria-valuemax={durationFrames} aria-valuenow={scrub.shown} aria-valuetext={tc(scrub.shown)}
      aria-disabled={disabled}
      accessibilityActions={[{name:"increment",label:"Next frame"},{name:"decrement",label:"Previous frame"}]}
      onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="increment")step(1);if(e.nativeEvent.actionName==="decrement")step(-1);}}
      style={{position:"absolute",left:scrub.active?shownHead:headLeft,top:0,width:HIT,height:HIT,alignItems:"center",opacity:inView?1:controlTokens.opacity.muted,...NO_SELECT}}>
      <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-accent")}}
        style={{marginTop:tokens.spacing.fixedStack,width:tokens.spacing.off14,height:tokens.spacing.off18,borderRadius:forgeRadius.sm}}/>
    </View>
  </View>;
}
