import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useRef} from "react";
import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {DEFAULT_SHUTTLE_LADDER,assertLadder,shuttleLabel,shuttleRate} from "./shuttle.ts";

/** Props for {@linkcode JKLShuttleController}. */
export interface JKLShuttleControllerProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The player's reported rate: 0 stopped, negative in reverse. */
  readonly rate:number;
  readonly onRateChange:(rate:number)=>void;
  /** Forward rates L climbs through, ascending. @default [1, 2, 4, 8] */
  readonly ladder?:readonly number[];
  /** Lets J play in reverse. Pass only when the player can. */
  readonly supportsReverse?:boolean;
  /** Frame step while K is held: J steps back, L forward. Omit when the player cannot step. */
  readonly onStep?:(delta:-1|1)=>void;
  /** Disables the controller and is read out as the reason, e.g. "No media loaded". */
  readonly disabledReason?:string;
  className?:string;
  unstyled?:boolean;
}

/**
 * J/K/L shuttle (D-09): three 44pt keys and the current rate. L plays forward
 * and climbs the ladder, J does the same in reverse (or slows forward play
 * when the player cannot reverse), K stops. With focus inside, the J, K and L
 * keys work too, and holding K while pressing J or L steps one frame. Media
 * controls keep tape direction, so the row is not mirrored in RTL.
 */
export function JKLShuttleController({scope='JKLShuttleController',revision=0,...props}:JKLShuttleControllerProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.supportsReverse,props.ladder]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <JKLShuttleControllerBody key={owner} {...props} actionError={guard.error} {...(guard.pending?{disabledReason:'Operation in progress'}:{})}
  onRateChange={(value)=>guard.run('onRateChange',host=>host.onRateChange(value))}
  {...(props.onStep?{onStep:(value:Parameters<NonNullable<JKLShuttleControllerProps['onStep']>>[0])=>guard.run('onStep',host=>host.onStep?.(value))}:{})}/>;
}
function JKLShuttleControllerBody({
  actionError=null,
  rate,onRateChange,ladder=DEFAULT_SHUTTLE_LADDER,supportsReverse=false,onStep,disabledReason,
  className,unstyled=false,testID,style,...rest
}:JKLShuttleControllerProps&{actionError?:string|null}){
  assertLadder(ladder);
  const off=disabledReason!==undefined;
  const styled=!unstyled;
  const kHeld=useRef(false);
  const press=(key:"j"|"k"|"l")=>{
    if(off)return;
    const next=shuttleRate(rate,key,ladder,supportsReverse);
    if(next!==rate)onRateChange(next);
  };
  const onKeyDown=(event:KeyEventLike)=>{
    if(off)return;
    const key=keyboardKey(event)?.toLowerCase();
    if(key!=="j"&&key!=="k"&&key!=="l")return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
    if(key==="k"){kHeld.current=true;press("k");return;}
    if(kHeld.current&&onStep){onStep(key==="j"?-1:1);return;}
    press(key);
  };
  const onKeyUp=(event:KeyEventLike)=>{if(keyboardKey(event)?.toLowerCase()==="k")kHeld.current=false;};
  const jStops=!supportsReverse;
  const key=(k:"j"|"k"|"l",label:string,hint:string,on:boolean,disabled=false)=>
    <Pressable key={k} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      accessibilityState={{disabled:off||disabled,selected:on}} disabled={off||disabled} onPress={()=>press(k)}
      {...(testID?{testID:testID+"-"+k}:{})}
      {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
        styled&&(on?"border-focus bg-surface-sunken":"border-border bg-surface-raised"))}}
      style={{minWidth:52,minHeight:44,alignItems:"center",justifyContent:"center",opacity:off||disabled?0.4:1}}>
      <Text {...{className:joinClasses(styled&&(on?"text-text font-semibold":"text-text"))}}>{k.toUpperCase()}</Text>
    </Pressable>;
  return <View {...rest} {...(testID?{testID}:{})} {...{onKeyDown,onKeyUp,onBlur:()=>{kHeld.current=false;}}}
    accessibilityRole="toolbar" accessibilityLabel="Shuttle"
    {...{className:joinClasses("gap-2",className)}}
    style={[{flexDirection:"row",alignItems:"center",flexWrap:"wrap",direction:"ltr"},style]}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    {key("j",jStops?"Slower":"Reverse",jStops?"Slows forward playback one step":"Plays in reverse; press again to go faster",rate<0,jStops&&rate<=0)}
    {key("k","Stop","Stops playback. Hold K and press J or L to step a frame",rate===0)}
    {key("l","Forward","Plays forward; press again to go faster",rate>0)}
    <Text accessibilityLiveRegion="polite" {...(testID?{testID:testID+"-rate"}:{})}
      {...{className:joinClasses(styled&&"text-text font-semibold")}}
      style={{fontVariant:["tabular-nums"],minWidth:88,paddingHorizontal:4}}>{shuttleLabel(rate)}</Text>
    {disabledReason?<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>{disabledReason}</Text>:null}
  </View>;
}
