import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Platform,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {formatTimecode,type FrameRate} from "../timebase.ts";
import type {FrameRange} from "./viewport.ts";
import {frameForKey} from "./frame-keys.ts";
import {useFrameScrub} from "./useFrameScrub.ts";
import {exact} from '../exact-optional.ts';

/** Props for {@linkcode SeekBar}. */
export interface SeekBarProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The player's reported frame. */
  readonly frame:number;
  readonly durationFrames:number;
  readonly rate:FrameRate;
  /** Decoded or downloaded ranges, drawn behind the played range. */
  readonly buffered?:readonly FrameRange[];
  /** Drag preview: show this frame, request a fast seek if the player can. */
  readonly onScrub?:(frame:number)=>void;
  /** Once per release, key press or screen-reader step: the exact seek. */
  readonly onSeek:(frame:number)=>void;
  readonly dropFrame?:boolean;
  readonly disabled?:boolean;
  /** @default "Playback position" */
  readonly label?:string;
  className?:string;
  unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const THUMB=20;

/**
 * Seek track with played and buffered ranges (D-04). Press jumps, dragging
 * scrubs through `onScrub`, release seeks once through `onSeek`, Escape
 * restores the start frame. Keys: arrows one frame, Page Up/Down one second,
 * Home/End. Unlike `NativeSeekBar` (the `@expo/ui` native slider), it needs no
 * optional peer and reports where the drag ends.
 */
export function SeekBar({scope='SeekBar',revision=0,...props}:SeekBarProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.disabled,props.durationFrames,props.rate]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined||!!props.disabled);
 return <SeekBarBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onSeek={(value)=>guard.run('onSeek',host=>host.onSeek(value))}
  {...(props.onScrub?{onScrub:(value:Parameters<NonNullable<SeekBarProps['onScrub']>>[0])=>guard.current()?.onScrub?.(value)}:{})}/>;
}
function SeekBarBody({
  actionError=null,disabledReason,
  frame,durationFrames,rate,buffered=[],onScrub,onSeek,dropFrame=false,disabled=false,label="Playback position",
  className,unstyled=false,testID,style,...rest
}:SeekBarProps&{actionError?:string|null}){
  if(!Number.isSafeInteger(durationFrames)||durationFrames<0)throw new RangeError("durationFrames must be a nonnegative integer");
  const [layout,store]=useLocalStore(()=>({width:0}));
  const off=disabled||durationFrames===0;
  const usable=Math.max(1,layout.width-THUMB);
  const clamp=(f:number)=>Math.min(durationFrames,Math.max(0,Math.round(f)));
  const scrub=useFrameScrub({frame:clamp(frame),disabled:off,onScrub,onCommit:onSeek,
    frameAt:p=>clamp((p.x-THUMB/2)/usable*durationFrames)});
  const pos=(f:number)=>durationFrames===0?0:f/durationFrames;
  const tc=(f:number)=>formatTimecode(f,rate,{dropFrame});
  const styled=!unstyled;
  const onKeyDown=(event:KeyEventLike)=>{
    const key=keyboardKey(event);
    if(key==="Escape"){scrub.cancel();return;}
    const next=frameForKey(key,clamp(frame),durationFrames,rate);
    if(next===undefined||off)return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
    if(next!==clamp(frame))onSeek(next);
  };
  const step=(d:number)=>{const n=clamp(frame+d);if(!off&&n!==clamp(frame))onSeek(n);};
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-1",className)}} style={style}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    <View {...scrub.handlers}
      {...{onKeyDown,focusable:!off,className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
      onLayout={e=>store.set({width:e.nativeEvent.layout.width})}
      accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityHint="Drag to scrub. Arrow keys step one frame, Page Up and Page Down one second."
      aria-valuemin={0} aria-valuemax={durationFrames} aria-valuenow={scrub.shown}
      aria-valuetext={`${tc(scrub.shown)} of ${tc(durationFrames)}`} aria-disabled={off}
      accessibilityActions={[{name:"increment",label:"Next frame"},{name:"decrement",label:"Previous frame"}]}
      onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="increment")step(1);if(e.nativeEvent.actionName==="decrement")step(-1);}}
      style={{height:44,justifyContent:"center",direction:"ltr",opacity:off?0.45:1,...NO_SELECT}}>
      <View pointerEvents="none" {...{className:joinClasses(styled&&"rounded-control bg-surface-sunken border border-border")}}
        style={{position:"absolute",left:THUMB/2,right:THUMB/2,height:8,overflow:"hidden"}}>
        {buffered.map((r,i)=><View key={i} {...{className:joinClasses(styled&&"bg-border")}}
          style={{position:"absolute",top:0,bottom:0,left:`${pos(Math.max(0,r.start))*100}%`,
            width:`${Math.max(0,pos(Math.min(durationFrames,r.end))-pos(Math.max(0,r.start)))*100}%`}}/>)}
        <View {...{className:joinClasses(styled&&"bg-accent")}} style={{position:"absolute",top:0,bottom:0,left:0,width:`${pos(scrub.shown)*100}%`}}/>
      </View>
      {layout.width>0?<View pointerEvents="none" {...{className:joinClasses(styled&&"bg-surface-raised border-2 border-accent")}}
        style={{position:"absolute",left:pos(scrub.shown)*usable,width:THUMB,height:THUMB,borderRadius:THUMB/2}}/>:null}
    </View>
    <View style={{flexDirection:"row",justifyContent:"space-between",direction:"ltr"}}>
      <Text {...{className:joinClasses(styled&&(scrub.active?"text-text":"text-text-muted"),styled&&"text-xs")}} style={{fontVariant:["tabular-nums"]}}>{tc(scrub.shown)}</Text>
      <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{fontVariant:["tabular-nums"]}}>{tc(durationFrames)}</Text>
    </View>
  </View>;
}
