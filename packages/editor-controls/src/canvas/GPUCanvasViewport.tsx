import {useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import {AppState,Text,View,type ViewProps} from 'react-native';
import {Skia,SkiaGraphiteView,type SkiaGraphiteViewRef,type SkCanvas,type SkGpuInfo} from 'react-native-skia';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {validateViewport,type CanvasViewport} from './canvas-viewport.ts';
import {submitCanvasFrame} from './graphite-frame.ts';
export interface CanvasGpuStatus {available:boolean;backend:string;error:string|null;generation:number}
export interface GPUCanvasViewportProps extends Omit<ViewProps,'children'> {
 scope:string;revision?:string|number;viewport:CanvasViewport;
 /** Draw a complete document frame synchronously. Canvas is borrowed until this call returns. */
 drawFrame:(canvas:SkCanvas,viewport:CanvasViewport)=>void;
 /** App-authored clear color; transparent by default. */
 clearColor?:string;
 paused?:boolean;
 onGpuChange?:(status:CanvasGpuStatus)=>void;
 /** Submission is queued for a display frame; this is not a presentation acknowledgement. */
 onFrameSubmitted?:(revision:string|number)=>void;
 onRenderError?:(error:Error)=>void;
 renderUnavailable?:(status:CanvasGpuStatus)=>ReactNode;
 label?:string;className?:string;unstyled?:boolean;
}
const statusOf=(gpu:SkGpuInfo,generation:number):CanvasGpuStatus=>({available:gpu.isAvailable,backend:gpu.backend,error:gpu.error,generation});
/** Actual Skia 3 Graphite surface. Document/engine state and GPU resource handles remain host-owned. */
export function GPUCanvasViewport({scope,revision=0,viewport,drawFrame,clearColor='transparent',paused=false,onGpuChange,onFrameSubmitted,onRenderError,renderUnavailable,label='Document canvas',className,unstyled=false,style,onLayout,...rest}:GPUCanvasViewportProps){
 validateViewport(viewport);
 if(!scope.trim()||scope.length>512||!label.trim()||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid GPU canvas identity');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,state=useStore(store,s=>s),view=useRef<SkiaGraphiteViewRef|null>(null),mounted=useRef(false);
 const boundary=JSON.stringify([scope,revision,viewport,clearColor,paused]);
 const latest=useRef({boundary,drawFrame,onGpuChange,onFrameSubmitted,onRenderError});
 useLayoutEffect(()=>{latest.current={boundary,drawFrame,onGpuChange,onFrameSubmitted,onRenderError};});
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let alive=true;let previous=AppState.currentState;
  const watch=(gpu:SkGpuInfo)=>{void gpu.lost.then(()=>{if(!alive)return;const next=Skia.gpu;store.setState(s=>({gpu:statusOf(next,s.gpu.generation+1)}));if(next.lost!==gpu.lost)watch(next);},error=>{if(alive)store.setState(s=>({gpu:{...s.gpu,available:false,error:String(error)}}));});};
  watch(Skia.gpu);
  const subscription=AppState.addEventListener('change',value=>{const resuming=value==='active'&&(previous==='background'||previous==='inactive');previous=value;if(resuming&&alive)store.setState(s=>({resume:s.resume+1}));});
  return()=>{alive=false;subscription.remove();};
 },[store]);
 useEffect(()=>{if(mounted.current)latest.current.onGpuChange?.(state.gpu);},[state.gpu]);
 useEffect(()=>{
  if(paused||!state.gpu.available||!state.layout||viewport.width<=0||viewport.height<=0||!Skia.gpu.foreground)return;
  const current=()=>mounted.current&&latest.current.boundary===boundary&&!paused&&Skia.gpu.isAvailable&&Skia.gpu.foreground;
  let context:ReturnType<SkiaGraphiteViewRef['getContext']>|undefined;
  try{if(!current()||!view.current)return;context=view.current.getContext();if(submitCanvasFrame(context,viewport,Skia.Color(clearColor),(canvas,value)=>latest.current.drawFrame(canvas,value),current)&&current()){store.setState({drawError:null});latest.current.onFrameSubmitted?.(revision);}}
  catch(error){if(current()){const failure=error instanceof Error?error:new Error(String(error));store.setState({drawError:{boundary,message:failure.message.slice(0,1024)}});latest.current.onRenderError?.(failure);}}
  finally{context?.dispose();}
 },[boundary,state.gpu,state.layout,state.resume]);
 const failed=state.drawError?.boundary===boundary;
 return <View {...rest} accessible={!failed&&state.gpu.available} accessibilityRole={!failed&&state.gpu.available?"image":undefined} accessibilityLabel={label} {...{className:joinClasses(!unstyled&&'bg-surface-sunken',className)}} style={[{width:viewport.width,height:viewport.height,overflow:'hidden',direction:'ltr'},style]} onLayout={onLayout}>
  {state.gpu.available?<SkiaGraphiteView ref={view} style={{position:'absolute',inset:0}} onLayout={event=>{const {width,height}=event.nativeEvent.layout;store.setState({layout:width>0&&height>0?width+':'+height:''});}}/>:renderUnavailable?.(state.gpu)??<Text accessibilityRole="alert" {...{className:joinClasses(!unstyled&&'text-text')}}>{state.gpu.error??'GPU rendering is unavailable'}</Text>}
  {state.drawError?.boundary===boundary?<Text accessibilityRole="alert" {...{className:joinClasses(!unstyled&&'text-text')}} style={{position:'absolute',inset:0}}>Canvas rendering failed: {state.drawError.message}</Text>:null}
 </View>;
}
function makeStore(){return createStore(()=>({gpu:statusOf(Skia.gpu,0),layout:'',resume:0,drawError:null as null|{boundary:string;message:string}}));}
