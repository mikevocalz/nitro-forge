import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Pressable,Switch,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {speedLabel} from "./ruler.ts";
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";

/** Props for {@linkcode PlaybackRateMenu}. */
export interface PlaybackRateMenuProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** Current playback rate; negative plays in reverse. */
  readonly rate:number;
  readonly onRateChange:(rate:number)=>void;
  /** Forward rates offered, ascending. @default [0.25, 0.5, 1, 1.5, 2] */
  readonly rates?:readonly number[];
  /** Adds reverse (-1x). Pass only when the player can play backwards. */
  readonly supportsReverse?:boolean;
  /** Pitch policy at rates other than 1x. The switch shows only when a handler is passed. */
  readonly preservePitch?:boolean;
  readonly onPreservePitchChange?:(preserve:boolean)=>void;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

/**
 * Playback speed picker (D-07): a 44pt button showing the rate that opens a
 * list of rates, plus reverse and a preserve-pitch switch when the player
 * supports them. One `onRateChange` per choice; the list closes after it.
 */
export function PlaybackRateMenu({scope='PlaybackRateMenu',revision=0,...props}:PlaybackRateMenuProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.disabled,props.supportsReverse,props.rates]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined||!!props.disabled);
 return <PlaybackRateMenuBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onRateChange={(value)=>guard.run('onRateChange',host=>host.onRateChange(value))}
  {...(props.onPreservePitchChange?{onPreservePitchChange:(value:Parameters<NonNullable<PlaybackRateMenuProps['onPreservePitchChange']>>[0])=>guard.run('onPreservePitchChange',host=>host.onPreservePitchChange?.(value))}:{})}/>;
}
function PlaybackRateMenuBody({
  actionError=null,disabledReason,
  rate,onRateChange,rates=[0.25,0.5,1,1.5,2],supportsReverse=false,preservePitch,onPreservePitchChange,
  disabled=false,className,unstyled=false,testID,style,...rest
}:PlaybackRateMenuProps&{actionError?:string|null}){
  if(!Number.isFinite(rate)||rates.length>64||new Set(rates).size!==rates.length||rates.some(r=>!Number.isFinite(r)||r<=0))throw new RangeError("Forward rates must be positive");
  const [open,store]=useLocalStore(()=>false);
  const styled=!unstyled;
  const options=supportsReverse?[-1,...rates]:[...rates];
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-2",className)}} style={style}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    <Pressable accessibilityRole="button" accessibilityLabel={`Playback speed ${speedLabel(rate)}`}
      accessibilityState={{expanded:open,disabled}} aria-expanded={open} disabled={disabled}
      onPress={()=>store.set(o=>!o)} {...id("toggle")}
      {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-raised px-3 focus-visible:ring-2 focus-visible:ring-focus")}}
      style={{minHeight:tokens.spacing.fixedTarget,minWidth:tokens.spacing.fixedRail,alignItems:"center",justifyContent:"center",alignSelf:"flex-start",opacity:disabled?tokens.opacity.disabled:1}}>
      <Text {...{className:joinClasses(styled&&"text-text font-semibold")}} style={{fontVariant:["tabular-nums"]}}>{speedLabel(rate)}</Text>
    </Pressable>
    {open?<View {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-raised p-1")}} style={{gap:tokens.spacing.off2,alignSelf:"flex-start",minWidth:controlTokens.extent.previewCompact}}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Playback speed">
        {options.map(r=>{
          const on=r===rate;
          return <Pressable key={r} accessibilityRole="radio" aria-checked={on} accessibilityState={{checked:on}}
            onPress={()=>{store.set(false);if(r!==rate)onRateChange(r);}} {...id("rate-"+r)}
            {...{className:joinClasses(styled&&"rounded-control px-3 focus-visible:ring-2 focus-visible:ring-focus",styled&&on&&"bg-surface-sunken")}}
            style={{minHeight:tokens.spacing.fixedTarget,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:tokens.spacing.fixedInset}}>
            <Text {...{className:joinClasses(styled&&(on?"text-text font-semibold":"text-text"))}} style={{fontVariant:["tabular-nums"]}}>
              {r<0?"Reverse":speedLabel(r)}
            </Text>
            {on?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>Current</Text>:null}
          </Pressable>;
        })}
      </View>
      {onPreservePitchChange?<View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",minHeight:tokens.spacing.fixedTarget,paddingHorizontal:tokens.spacing.fixedInset,gap:tokens.spacing.fixedInset}}>
        <Text {...{className:joinClasses(styled&&"text-text text-sm")}}>Preserve pitch</Text>
        <Switch value={preservePitch??true} onValueChange={onPreservePitchChange} accessibilityLabel="Preserve pitch" {...id("pitch")}/>
      </View>:null}
    </View>:null}
  </View>;
}
