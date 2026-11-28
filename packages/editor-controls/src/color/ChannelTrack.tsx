import {useEffect,useMemo,useRef} from "react";
import {I18nManager,Platform,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {adjustKey} from "@nyc-tron/ui/components/gestures/adjust-keys";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {createValueGesture} from "@nyc-tron/ui/components/gestures/value-gesture";
import type {RgbaColor} from "../color.ts";
import {checkerColumns,trackSegments} from "./segments.ts";

/** Props for {@linkcode ChannelTrack}. */
export interface ChannelTrackProps extends Omit<ViewProps,"children"> {
  /** Screen-reader name, e.g. "Opacity". */
  readonly label:string;
  /** Committed position, 0..1. */
  readonly value:number;
  /** Evenly spaced gradient stops, start to end. */
  readonly stops:readonly RgbaColor[];
  /** Draws a checkerboard under the gradient for translucent stops. */
  readonly checker?:boolean;
  /** Spoken value, e.g. "40 percent". */
  readonly valueText:(value:number)=>string;
  /** Thumb fill for a position. */
  readonly thumbColor:(value:number)=>string;
  /** Arrow-key and screen-reader step. @default 0.01 */
  readonly step?:number;
  /** Page Up/Down step. @default 0.1 */
  readonly pageStep?:number;
  readonly onPreview?:(value:number)=>void;
  /** Once per drag release, key press or screen-reader action that changes the value. */
  readonly onCommit:(value:number)=>void;
  readonly disabled?:boolean;
  /** Track runs right to left. @default I18nManager.isRTL */
  readonly rtl?:boolean;
  readonly unstyled?:boolean;
}

const THUMB=28;
const SEGMENTS=48;
const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const clamp01=(n:number)=>Math.max(0,Math.min(1,n));
const roundTo=(n:number,step:number)=>{
  const places=Math.max(0,Math.ceil(-Math.log10(step)));
  return Number((Math.round(n/step)*step).toFixed(places));
};

/**
 * A 44pt gradient track with one thumb, shared by `AlphaSlider` and the
 * brightness track of `ColorDiscPicker`. Dragging previews; release, keys and
 * screen-reader actions commit once each. Escape during a drag restores the
 * start value. The drawing is pinned left-to-right and flipped by hand under
 * `rtl`, so it does not depend on how each platform mirrors `row` layouts.
 */
export function ChannelTrack({
  label,value,stops,checker=false,valueText,thumbColor,step=0.01,pageStep=0.1,
  onPreview,onCommit,disabled=false,rtl=I18nManager.isRTL,unstyled=false,testID,style,...rest
}:ChannelTrackProps){
  if(!Number.isFinite(value)||value<0||value>1)throw new RangeError("ChannelTrack value must be 0..1");
  const [state,store]=useLocalStore(()=>({width:0,preview:undefined as number|undefined}));
  const latest=useRef({value,onPreview,onCommit,disabled});
  latest.current={value,onPreview,onCommit,disabled};
  const gesture=useMemo(()=>createValueGesture<number>({
    disabled:()=>latest.current.disabled,
    equals:(a,b)=>a===b,
    preview:v=>{store.set(s=>({...s,preview:v}));latest.current.onPreview?.(v);},
    commit:v=>latest.current.onCommit(v),
  }),[store]);
  useEffect(()=>()=>gesture.cancel(),[gesture]);
  const usable=Math.max(1,state.width-THUMB);
  const toValue=(x:number)=>{
    const t=clamp01((x-THUMB/2)/usable);
    return roundTo(rtl?1-t:t,step/10);
  };
  const end=()=>store.set(s=>({...s,preview:undefined}));
  const handlers=useLocalPointer({
    disabled,
    onBegin:p=>{gesture.begin(latest.current.value);gesture.update(toValue(p.x));},
    onMove:p=>gesture.update(toValue(p.x)),
    onRelease:()=>{gesture.release();end();},
    onCancel:()=>{gesture.cancel();end();},
  });
  const commitKey=(next:number)=>{
    const v=roundTo(clamp01(next),step);
    if(!disabled&&v!==value)onCommit(v);
  };
  const onKeyDown=(event:KeyEventLike)=>{
    const intent=adjustKey(keyboardKey(event),rtl);
    if(!intent)return;
    if(intent.kind==="cancel"){if(gesture.active){gesture.cancel();end();}return;}
    if(intent.kind==="step")commitKey(value+intent.direction*step);
    else if(intent.kind==="page")commitKey(value+intent.direction*pageStep);
    else commitKey(intent.kind==="min"?0:1);
    (event as {preventDefault?:()=>void}).preventDefault?.();
  };
  const shown=state.preview??value;
  const segments=useMemo(()=>{
    const list=trackSegments(stops,SEGMENTS);
    return rtl?list.reverse():list;
  },[stops,rtl]);
  const cells=checker?checkerColumns(state.width):0;
  const thumbLeft=(rtl?1-shown:shown)*usable;
  const styled=!unstyled;
  return <View {...rest} {...handlers}
    {...{onKeyDown,focusable:!disabled,
      className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
    testID={testID}
    onLayout={e=>store.set(s=>({...s,width:e.nativeEvent.layout.width}))}
    accessible accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityHint="Drag or use the arrow keys to adjust. Press Escape to cancel a drag."
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown*100)}
    aria-valuetext={valueText(shown)} aria-disabled={disabled}
    accessibilityActions={[{name:"increment",label:"Increase"},{name:"decrement",label:"Decrease"}]}
    onAccessibilityAction={e=>{
      if(e.nativeEvent.actionName==="increment")commitKey(value+step);
      if(e.nativeEvent.actionName==="decrement")commitKey(value-step);
    }}
    style={[{height:44,justifyContent:"center",direction:"ltr",opacity:disabled?0.45:1,...NO_SELECT},style]}>
    <View pointerEvents="none" {...{className:joinClasses(styled&&"rounded-control border border-border")}}
      style={{position:"absolute",left:0,right:0,height:24,overflow:"hidden"}}>
      {cells?<View style={{position:"absolute",left:0,top:0,bottom:0,flexDirection:"row"}}>
        {Array.from({length:cells},(_,i)=><View key={i} style={{width:7}}>
          <View {...{className:joinClasses(styled&&(i%2?"bg-border":"bg-surface-raised"))}} style={{height:12}}/>
          <View {...{className:joinClasses(styled&&(i%2?"bg-surface-raised":"bg-border"))}} style={{height:12}}/>
        </View>)}
      </View>:null}
      <View style={{flex:1,flexDirection:"row"}}>
        {segments.map((c,i)=><View key={i} style={{flex:1,backgroundColor:c}}/>)}
      </View>
    </View>
    {state.width>0?<View pointerEvents="none" {...{className:joinClasses(styled&&"border-text")}}
      style={{position:"absolute",left:thumbLeft,width:THUMB,height:THUMB,borderRadius:THUMB/2,borderWidth:2,
        alignItems:"center",justifyContent:"center"}}>
      <View {...{className:joinClasses(styled&&"border-surface-raised")}}
        style={{width:THUMB-4,height:THUMB-4,borderRadius:(THUMB-4)/2,borderWidth:2,backgroundColor:thumbColor(shown)}}/>
    </View>:null}
  </View>;
}
