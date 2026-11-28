import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Pressable,Text,TextInput,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import type {FrameRate} from "../timebase.ts";
import {formatTime,parseTime,supportsDropFrame,type TimeFormat} from "./time.ts";

/** Props for {@linkcode TimecodeDisplay}. */
export interface TimecodeDisplayProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly frame:number;
  readonly rate:FrameRate;
  readonly format:TimeFormat;
  /** Shows the format switch. Keep the format in the host's preferences. */
  readonly onFormatChange?:(format:TimeFormat)=>void;
  /** SMPTE drop-frame labels; NTSC rates only. @default false */
  readonly dropFrame?:boolean;
  /** Enables the samples format. */
  readonly sampleRate?:number;
  /** Makes the time editable: one commit per accepted entry (Enter or blur). */
  readonly onCommit?:(frame:number)=>void;
  /** Highest frame a typed entry may reach. */
  readonly durationFrames?:number;
  /** @default "Current time" */
  readonly label?:string;
  className?:string;
  unstyled?:boolean;
}

const FORMAT_LABEL:Record<TimeFormat,string>={timecode:"Timecode",frames:"Frames",seconds:"Seconds",samples:"Samples"};
const HINT:Record<TimeFormat,string>={
  timecode:"Enter HH:MM:SS:FF",frames:"Enter a frame number",seconds:"Enter seconds, like 4.5",samples:"Enter HH:MM:SS.mmm",
};

/**
 * Time readout (D-08) in timecode (with drop-frame at 29.97/59.94), frames,
 * seconds or sample clock. With `onCommit` the readout is a field: typed time
 * in the current format commits once, out-of-range or malformed text is
 * rejected with the expected format, and the field keeps the draft.
 */
export function TimecodeDisplay({scope='TimecodeDisplay',revision=0,...props}:TimecodeDisplayProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.format,props.rate,props.durationFrames,props.dropFrame]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <TimecodeDisplayBody key={owner} {...props} actionError={guard.error} {...(guard.pending?{disabledReason:'Operation in progress'}:{})}
  {...(props.onCommit?{onCommit:(value:Parameters<NonNullable<TimecodeDisplayProps['onCommit']>>[0])=>guard.run('onCommit',host=>host.onCommit?.(value))}:{})}
  {...(props.onFormatChange?{onFormatChange:(value:Parameters<NonNullable<TimecodeDisplayProps['onFormatChange']>>[0])=>guard.current()?.onFormatChange?.(value)}:{})}/>;
}
function TimecodeDisplayBody({disabledReason,
  actionError=null,
  frame,rate,format,onFormatChange,dropFrame=false,sampleRate,onCommit,durationFrames,label="Current time",
  className,unstyled=false,testID,style,...rest
}:TimecodeDisplayProps&{actionError?:string|null}){
  if(dropFrame&&!supportsDropFrame(rate))throw new RangeError("Drop-frame timecode needs 29.97 or 59.94 fps");
  const [draft,store]=useLocalStore(()=>undefined as {text:string;error?:string}|undefined);
  const styled=!unstyled;
  const formats:TimeFormat[]=sampleRate===undefined?["timecode","frames","seconds"]:["timecode","frames","seconds","samples"];
  const current=formats.includes(format)?format:"timecode";
  const opts={dropFrame,...(sampleRate===undefined?{}:{sampleRate})};
  const shown=formatTime(Math.max(0,Math.round(frame)),rate,current,opts);
  // Reads the store, not the render's draft: Enter blurs the field, and the
  // blur's apply runs before a re-render, so it must see the cleared draft.
  const apply=()=>{
    const d=store.get();
    if(disabledReason!==undefined||!d||!onCommit)return;
    const f=parseTime(d.text,rate,current,opts);
    if(f===undefined||(durationFrames!==undefined&&f>durationFrames)){
      store.set({...d,error:f===undefined?HINT[current]+".":`Enter a time up to ${formatTime(durationFrames!,rate,current,opts)}.`});
      return;
    }
    store.set(undefined);
    if(f!==frame)onCommit(f);
  };
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const text=joinClasses(styled&&"text-text text-lg font-semibold");
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-1",className)}} style={[{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:8},style]}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    {onCommit?<TextInput editable={disabledReason===undefined} maxLength={128} value={draft?.text??shown} onChangeText={t=>store.set({text:t})}
      onSubmitEditing={apply} onBlur={apply} selectTextOnFocus autoCorrect={false} autoCapitalize="none"
      accessibilityLabel={`${label}, ${FORMAT_LABEL[current]}`} accessibilityHint={HINT[current]} aria-invalid={Boolean(draft?.error)}
      {...id("input")}
      {...{className:joinClasses(text,styled&&"rounded-control border bg-surface-sunken px-2",
        styled&&(draft?.error?"border-danger":"border-border"))}}
      style={{minHeight:44,minWidth:150,fontVariant:["tabular-nums"]}}/>
      :<Text selectable accessibilityLabel={`${label} ${shown}`} {...{className:text}} style={{fontVariant:["tabular-nums"]}}>{shown}</Text>}
    {onFormatChange?<Pressable disabled={disabledReason!==undefined} accessibilityRole="button" accessibilityLabel={`Time format: ${FORMAT_LABEL[current]}`}
      accessibilityHint="Switches to the next time format" {...id("format")}
      onPress={()=>{store.set(undefined);onFormatChange(formats[(formats.indexOf(current)+1)%formats.length]!);}}
      {...{className:joinClasses(styled&&"rounded-control border border-border px-3 focus-visible:ring-2 focus-visible:ring-focus")}}
      style={{minHeight:44,justifyContent:"center"}}>
      <Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>{FORMAT_LABEL[current]+(current==="timecode"&&dropFrame?" (drop-frame)":"")}</Text>
    </Pressable>:null}
    {draft?.error?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(styled&&"text-danger text-xs")}} style={{flexBasis:"100%"}}>{draft.error}</Text>:null}
  </View>;
}
