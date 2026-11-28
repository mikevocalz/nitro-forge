import {createWaveformGesture,waveformPosition,createWaveformLaneStore,writeWaveformPosition,stepWaveformPosition} from './waveform-gesture.ts';
import {useStore} from 'zustand';
import {controlIdentity,useScopedControl,type ScopedControlProps} from './inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { useRef,useLayoutEffect } from "react";
import { PanResponder,Platform,View,type ViewProps,type ViewStyle } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import {
  FULL_RANGE,assertWaveformRange,peaksToBars,resamplePeaks,slicePeaks,
  type WaveformPeak,type WaveformRange,
} from "./waveform.ts";
import {exact} from './exact-optional.ts';


export interface WaveformLaneProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** Measured real source signal extrema; not synthetic waves. */
  readonly peaks:readonly WaveformPeak[];
  readonly columns?:number;
  readonly height?:number;
  readonly onSeekNormalized?:((position:number)=>void)|undefined;
  /** Current playhead in [0, 1]; screen-reader steps move from here. */
  readonly position?:number;
  /** Normalized distance per accessibility increment/decrement. */
  readonly accessibilityStep?:number;
  /**
   * Part of the clip to draw, normalized. Only the peaks inside it are
   * resampled, so a zoomed-in view of a long clip costs the same as a short
   * one. @default FULL_RANGE
   */
  readonly visibleRange?:WaveformRange;
  /** Live preview of the range while the lane is dragged sideways. */
  readonly onVisibleRangeChange?:((range:WaveformRange)=>void)|undefined;
  /**
   * Once per finished sideways drag. Without it the lane does not scroll and
   * every release seeks.
   */
  readonly onVisibleRangeCommit?:((range:WaveformRange)=>void)|undefined;
  className?:string;
  barClassName?:string;
  unstyled?:boolean;
}

/**
 * Per-component import: no audio API, Forge engines, Skia or Nitro.
 * Bounded native view count (<=128) at any zoom: `visibleRange` picks the
 * window and only that window is resampled. A tap seeks; with
 * `onVisibleRangeCommit`, a sideways drag scrolls the window and commits
 * once on release. A GPU (Skia) lane for dense multitrack timelines is
 * deferred until that backend is verified on devices.
 */
export function WaveformLane({scope='waveform',revision=0,...props}:WaveformLaneProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.visibleRange,props.columns,props.height]);
 if(props.peaks.length>1048576||props.peaks.some(p=>!Number.isFinite(p.min)||!Number.isFinite(p.max)||p.min>p.max||p.min< -1||p.max>1))throw new RangeError('Invalid waveform peaks');
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <View style={{minWidth:0}}><WaveformLaneBody sourceBoundary={JSON.stringify(controlIdentity(scope,revision))} gestureBoundary={owner} {...props}
  onSeekNormalized={props.onSeekNormalized?value=>{guard.current()?.onSeekNormalized?.(value);}:undefined}
  onVisibleRangeChange={props.onVisibleRangeChange?value=>{guard.current()?.onVisibleRangeChange?.(value);}:undefined}
  onVisibleRangeCommit={props.onVisibleRangeCommit?value=>guard.run('range',host=>host.onVisibleRangeCommit?.(value)):undefined}/>
  <ErrorMessage {...exact({message:guard.error??props.disabledReason,unstyled:props.unstyled})}/></View>;
}
function WaveformLaneBody({

  sourceBoundary,gestureBoundary,peaks,columns=96,height=64,onSeekNormalized,position,accessibilityStep=0.05,
  visibleRange=FULL_RANGE,onVisibleRangeChange,onVisibleRangeCommit,
  className,barClassName,unstyled=false,style,disabledReason,...props
}:WaveformLaneProps&{sourceBoundary:string;gestureBoundary:string}){
  assertWaveformRange(visibleRange);
  const width=useRef(0);
  const committedBoundary=useRef(gestureBoundary);
  const gesture=useRef<ReturnType<typeof createWaveformGesture>|null>(null);
  if(!gesture.current)gesture.current=createWaveformGesture();
  const session=gesture.current;
  const latest=useRef({onSeekNormalized,onVisibleRangeChange,onVisibleRangeCommit,visibleRange,sourceBoundary,position,accessibilityStep,disabled:disabledReason!==undefined});
  useLayoutEffect(()=>{latest.current={onSeekNormalized,onVisibleRangeChange,onVisibleRangeCommit,visibleRange,sourceBoundary,position,accessibilityStep,disabled:disabledReason!==undefined};});
  const local=useRef<ReturnType<typeof createWaveformLaneStore>|null>(null);
  if(!local.current)local.current=createWaveformLaneStore(visibleRange,sourceBoundary);
  const store=local.current;
  const active=useStore(store,s=>s.active);
  const previewRange=useStore(store,s=>s.range);
  const fallback=useStore(store,s=>s.fallback);
  const current=waveformPosition(position,sourceBoundary,fallback);
  const range=active?previewRange:visibleRange;
  useLayoutEffect(()=>{committedBoundary.current=gestureBoundary;session.cancel();store.setState({active:false});},[gestureBoundary,session,store]);
  useLayoutEffect(()=>()=>{session.cancel();},[session]);
  const seek=(next:number)=>{
    if(latest.current.disabled)return;
    const value=writeWaveformPosition(store,latest.current.sourceBoundary,next);
    latest.current.onSeekNormalized?.(value);
  };
  const responder=useRef<ReturnType<typeof PanResponder.create>|null>(null);
  if(!responder.current)responder.current=PanResponder.create({
    onStartShouldSetPanResponder:e=>(e.nativeEvent.touches?.length??1)<=1&&!latest.current.disabled&&(latest.current.onSeekNormalized!=null||latest.current.onVisibleRangeCommit!=null),
    onPanResponderGrant:e=>{if(latest.current.disabled||(e.nativeEvent.touches?.length??1)>1){session.cancel();store.setState({active:false});return;}session.begin(committedBoundary.current,width.current,latest.current.visibleRange);store.setState({active:false,range:latest.current.visibleRange});},
    onPanResponderMove:(_e,g)=>{
      const p=latest.current;if(p.disabled)return;
      if(g.numberActiveTouches>1){const scrolling=session.cancel();store.setState({active:false});if(scrolling)p.onVisibleRangeChange?.(p.visibleRange);return;}
      const next=session.move(committedBoundary.current,g.dx,p.onVisibleRangeCommit!=null);
      if(next){store.setState({active:true,range:next});p.onVisibleRangeChange?.(next);}
    },
    onPanResponderRelease:e=>{
      const result=session.release(committedBoundary.current,e.nativeEvent.locationX);
      store.setState({active:false});
      const p=latest.current;if(!result||p.disabled)return;
      if(result.kind==='range'){if(result.changed)p.onVisibleRangeCommit?.(result.range);}
      else if(p.onSeekNormalized)seek(result.position);
    },
    onPanResponderTerminate:()=>{
      const scrolling=session.cancel();store.setState({active:false});
      if(scrolling&&!latest.current.disabled)latest.current.onVisibleRangeChange?.(latest.current.visibleRange);
    },
    onPanResponderTerminationRequest:()=>!store.getState().active,
  });
  if(!Number.isFinite(accessibilityStep)||accessibilityStep<=0||accessibilityStep>1)
    throw new RangeError("accessibilityStep must be within (0, 1]");
  if(!Number.isInteger(columns)||columns<1||columns>128)
    throw new RangeError("Waveform columns must be 1..128");
  const bars=peaksToBars(resamplePeaks(slicePeaks(peaks,range),columns),height);
  const webTrack=Platform.OS==="web"&&onVisibleRangeCommit?{touchAction:"pan-y"} as unknown as ViewStyle:undefined;
  return <View
    {...props}
    {...responder.current.panHandlers}
    {...{className:joinClasses("w-full flex-row overflow-hidden",!unstyled&&"bg-surface-sunken",className)}}
    style={[{height,direction:"ltr"},webTrack,style]}
    accessible
    accessibilityRole={onSeekNormalized?"adjustable":"image"}
    accessibilityLabel={props.accessibilityLabel??"Audio waveform"}
    accessibilityState={{disabled:disabledReason!==undefined}}
    onLayout={e=>{if(committedBoundary.current!==gestureBoundary)return;const next=e.nativeEvent.layout.width;if(next!==width.current){const scrolling=session.cancel();store.setState({active:false});if(scrolling&&!latest.current.disabled)latest.current.onVisibleRangeChange?.(latest.current.visibleRange);width.current=Number.isFinite(next)&&next>0?next:0;}props.onLayout?.(e);}}
    accessibilityValue={onSeekNormalized?{min:0,max:100,now:Math.round(current*100)}:undefined}
    accessibilityActions={onSeekNormalized?[{name:"increment"},{name:"decrement"}]:undefined}
    onAccessibilityAction={onSeekNormalized?e=>{
      if(committedBoundary.current!==gestureBoundary||latest.current.disabled||!latest.current.onSeekNormalized)return;
      // Step from the playhead; jumping to 0 or 1 would discard the position.
      const delta=e.nativeEvent.actionName==="increment"?latest.current.accessibilityStep:e.nativeEvent.actionName==="decrement"?-latest.current.accessibilityStep:0;
      if(delta){const p=latest.current;const value=stepWaveformPosition(store,{source:p.sourceBoundary,...(p.position===undefined?{}:{position:p.position})},delta);p.onSeekNormalized?.(value);}
    }:undefined}
  >{bars.map((bar,i)=><View key={i} style={{flex:1,height}}>
    <View
      {...{className:joinClasses("self-center w-3/4",!unstyled&&"bg-accent",barClassName)}}
      style={{marginTop:bar.top,height:bar.height}}
    />
  </View>)}</View>;
}
