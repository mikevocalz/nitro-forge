import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {Glyph,type TransportGlyph} from "./glyphs.tsx";
import {exact} from '../exact-optional.ts';

/** Props for {@linkcode TransportControls}. */
export interface TransportControlsProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** What the player reports, not what was last requested. */
  readonly playing:boolean;
  readonly frame:number;
  readonly durationFrames:number;
  readonly onPlayPause:()=>void;
  /** Stop: pause and return to the start (or the in mark; the host decides). */
  readonly onStop:()=>void;
  /** Jumps and frame steps. One call per press. */
  readonly onSeek:(frame:number)=>void;
  /** Disables every control and is read out as the reason, e.g. "No media loaded". */
  readonly disabledReason?:string;
  className?:string;
  unstyled?:boolean;
}

/**
 * Play/pause, stop, jump to start/end and previous/next frame (D-06), each a
 * 44pt button. With focus inside, K toggles playback, Left/Right step
 * a frame and Home/End jump. Frame steps stop at the timeline's ends. Playback
 * itself (decoding, the clock) belongs to the host's player.
 */
export function TransportControls({scope='TransportControls',revision=0,...props}:TransportControlsProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.durationFrames]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <TransportControlsBody key={owner} {...props} actionError={guard.error} {...(guard.pending?{disabledReason:'Operation in progress'}:{})}
  onPlayPause={()=>guard.run('onPlayPause',host=>host.onPlayPause())}
  onStop={()=>guard.run('onStop',host=>host.onStop())}
  onSeek={(value)=>guard.run('onSeek',host=>host.onSeek(value))}/>;
}
function TransportControlsBody({
  actionError=null,
  playing,frame,durationFrames,onPlayPause,onStop,onSeek,disabledReason,className,unstyled=false,testID,style,...rest
}:TransportControlsProps&{actionError?:string|null}){
  if(!Number.isSafeInteger(frame)||frame<0||!Number.isSafeInteger(durationFrames)||durationFrames<0)throw new RangeError("durationFrames must be a nonnegative integer");
  const off=disabledReason!==undefined||durationFrames===0;
  const styled=!unstyled;
  const f=Math.min(durationFrames,Math.max(0,Math.round(frame)));
  const seek=(n:number)=>{const t=Math.min(durationFrames,Math.max(0,n));if(!off&&t!==f)onSeek(t);};
  const button=(glyph:TransportGlyph,label:string,onPress:()=>void,disabled=false,primary=false)=>
    <Pressable key={primary?"play-pause":glyph} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{disabled:off||disabled}} disabled={off||disabled} onPress={onPress}
      {...(testID?{testID:testID+"-"+glyph}:{})}
      {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
        styled&&(primary?"border-border bg-surface-sunken":"border-transparent"))}}
      style={{minWidth:primary?56:44,minHeight:44,alignItems:"center",justifyContent:"center",opacity:off||disabled?0.4:1}}>
      <Glyph name={glyph} styled={styled}/>
    </Pressable>;
  const onKeyDown=(event:KeyEventLike)=>{
    if(off)return;
    const key=keyboardKey(event);
    // Space is left to the focused button; K toggles playback from anywhere in the bar.
    const act=key==="k"||key==="K"?onPlayPause
      :key==="ArrowLeft"?()=>seek(f-1):key==="ArrowRight"?()=>seek(f+1)
      :key==="Home"?()=>seek(0):key==="End"?()=>seek(durationFrames):undefined;
    if(!act)return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
    act();
  };
  return <View {...rest} {...(testID?{testID}:{})} {...{onKeyDown}}
    accessibilityRole="toolbar" accessibilityLabel="Transport"
    {...{className:joinClasses("gap-1",className)}}
    // Media controls are not mirrored in right-to-left layouts (Material and Apple guidance):
    // they describe tape direction, not reading order.
    style={[{flexDirection:"row",alignItems:"center",flexWrap:"wrap",direction:"ltr"},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {button("start","Go to start",()=>seek(0),f===0)}
    {button("previous-frame","Previous frame",()=>seek(f-1),f===0)}
    {button(playing?"pause":"play",playing?"Pause":"Play",onPlayPause,false,true)}
    {button("next-frame","Next frame",()=>seek(f+1),f>=durationFrames)}
    {button("end","Go to end",()=>seek(durationFrames),f>=durationFrames)}
    {button("stop","Stop",onStop)}
    {disabledReason?<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{paddingHorizontal:6}}>{disabledReason}</Text>:null}
  </View>;
}
