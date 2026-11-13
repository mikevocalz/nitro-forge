import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import {Banner,Button,Text,View} from '@nitro-forge/studio-workspace/ui';
import {resolveWorkspaceScale,workspaceThemes,type WorkspaceDensity} from '@nitro-forge/studio-workspace/theme';
import {BeatDetectionMarkerLane} from '@nyc-tron/ui/components/forge/audio/BeatDetectionMarkerLane';
import {FRAME_RATES} from '@nyc-tron/ui/components/forge/timebase';
import type {CadenceDocument,CadenceMarker} from '../../../packages/cadence/src/index';
import type {CadenceMixerState} from '../../../packages/cadence/src/mixer-cluster';
import {addCadenceLaneMarker,cadenceBeatSensitivity,cadenceLaneMarkers,cadenceTicksToSeconds,DEFAULT_BEAT_SENSITIVITY,detectCadenceBeats,removeCadenceLaneMarker,updateCadenceLaneMarker} from './cadence-beats-wiring';

export interface CadenceBeatLaneProps {
 document:CadenceDocument;
 project:CadenceMixerState;
 disabled:boolean;
 commit:(write:()=>Promise<unknown>)=>Promise<void>;
 density:WorkspaceDensity;
 theme:'dark'|'light';
}
const RATE=FRAME_RATES.VIDEO_30;
// Detection reads at most 30 seconds of the master per run.
const MAX_DETECT_SECONDS=30;
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
function clipEnd(project:CadenceMixerState){let end=0;for(const track of project.tracks)for(const clip of track.clips)end=Math.max(end,clip.start_ticks+clip.length_ticks);return end;}

/** E-35: beat detection writes Cadence markers (ticks) shown on the shared marker lane. Sensitivity is host state. */
export function CadenceBeatLane(props:CadenceBeatLaneProps){
 const {document,project,disabled,commit}=props,scale=resolveWorkspaceScale(props.density),colors=workspaceThemes[props.theme];
 const store=useMemo(()=>createStore(()=>({sensitivity:DEFAULT_BEAT_SENSITIVITY,status:'idle' as 'idle'|'detecting'|'ready'|'error',error:'',bpm:null as number|null,summary:'',
  markers:[] as CadenceMarker[],read:'loading' as 'loading'|'ready'|'error',readError:'',retry:0,selected:undefined as string|undefined,playheadFrame:0,widthPx:640})),[document]);
 const view=useStore(store,s=>s);
 const mounted=useRef(false),run=useRef<AbortController|null>(null);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;run.current?.abort();};},[]);
 // Markers follow the authoritative project: every commit, undo or redo replaces `project`.
 useEffect(()=>{
  let active=true;
  store.setState({read:'loading',readError:''});
  void document.listMarkers().then(result=>{if(active)store.setState({markers:result.data.markers,read:'ready'});},
   error=>{if(active)store.setState({read:'error',readError:errorText(error)});});
  return()=>{active=false;};
 },[document,project,view.retry,store]);
 const time={ppq:project.ppq,tempo_bpm:project.tempo_bpm};
 const end=clipEnd(project);
 const range={fromTicks:0,toTicks:Math.min(end,Math.floor(MAX_DETECT_SECONDS*project.tempo_bpm*project.ppq/60))};
 const durationFrames=Math.max(RATE.numerator,Math.ceil(cadenceTicksToSeconds(Math.max(end,...view.markers.map(m=>m.ticks+m.length_ticks)),time)*RATE.numerator/RATE.denominator)+RATE.numerator);
 const viewport={startFrame:0,pxPerFrame:Math.max(.05,view.widthPx/durationFrames),widthPx:view.widthPx};
 const markers=cadenceLaneMarkers(view.markers,time,RATE);
 const selected=markers.some(m=>m.id===view.selected)?view.selected:undefined;
 const textStyle={color:colors.muted,fontSize:scale.type.body};
 const write=(action:()=>Promise<unknown>)=>commit(action);
 // Only Cancel stops a run. The lane's own signal is not forwarded: our commit closes the
 // surface while it runs, and that must not abort the addMarkers step it is waiting for.
 const detect=async()=>{
  run.current?.abort();
  const controller=new AbortController();run.current=controller;
  const existing=store.getState().markers,sensitivity=store.getState().sensitivity;
  store.setState({status:'detecting',error:'',summary:''});
  let outcome:Awaited<ReturnType<typeof detectCadenceBeats>>|null=null;
  try{
   await write(async()=>{outcome=await detectCadenceBeats(document,range,sensitivity,existing,time,controller.signal);});
   if(!mounted.current||run.current!==controller)return;
   const done=outcome as Awaited<ReturnType<typeof detectCadenceBeats>>|null;
   const found=done?.result.onsets_seconds.length??0,added=done?.added??0;
   store.setState({status:done?.cancelled?'idle':'ready',bpm:done?.result.estimated_bpm??null,
    summary:done?.cancelled?(added===0?'Detection cancelled before markers were written.':`Cancellation arrived after the marker write started. ${added} marker${added===1?'':'s'} added in one undo step.`):`Sensitivity ${sensitivity.toFixed(2)}: ${found} onset${found===1?'':'s'} found, ${added===0?'no new markers':`${added} marker${added===1?'':'s'} added in one undo step`}.`});
  }catch(error){
   if(mounted.current&&run.current===controller)store.setState({status:'error',error:errorText(error)});
   throw error;
  }finally{if(run.current===controller)run.current=null;}
 };
 return <View testID="cadence-beat-lane" style={{gap:scale.space.element}} onLayout={event=>{const width=Math.floor(event.nativeEvent.layout.width);if(width>0&&width!==store.getState().widthPx)store.setState({widthPx:width});}}>
  <Text style={textStyle}>Detection reads the master from the start, at most {MAX_DETECT_SECONDS} seconds, at 48 kHz without the metronome. Higher sensitivity finds quieter onsets; 0.50 is the detector's original threshold.</Text>
  {view.read==='loading'&&<Text accessibilityLiveRegion="polite" style={textStyle}>Reading markers…</Text>}
  {view.read==='error'&&<View style={{gap:scale.space.element}}><Banner tone="danger" title={view.readError} live="alert"/>
   <Button title="Read markers again" variant="ghost" targetSize={scale.size.target} onPress={()=>store.setState(s=>({retry:s.retry+1}))}/></View>}
  {view.read==='ready'&&<>
   <BeatDetectionMarkerLane scope={`cadence-beats:${project.ppq}`} revision={view.markers.length} sensitivity={view.sensitivity} detectedBpm={view.bpm} status={view.status}
    {...(view.error?{error:view.error}:{})} {...(disabled&&view.status!=='detecting'?{disabledReason:'Wait for the document to finish loading.'}:{})}
    {...(range.toTicks<=0?{unavailableReason:'Add a MIDI clip with notes before detecting beats.'}:{})}
    onSensitivityCommit={value=>{store.setState({sensitivity:cadenceBeatSensitivity(value)});}}
    onDetect={detect}
    onCancel={()=>{run.current?.abort();store.setState({summary:'Cancellation requested. A marker write already started will finish as one undo step.'});}}
    lane={{markers,viewport,rate:RATE,durationFrames,playheadFrame:Math.min(view.playheadFrame,durationFrames),...(selected?{selectedMarkerId:selected}:{}),
     onSelect:id=>store.setState({selected:id}),
     // No transport: seeking moves the lane's own playhead, which is where Add marker puts one.
     onSeek:frame=>store.setState({playheadFrame:frame}),
     onAdd:at=>{void write(()=>addCadenceLaneMarker(document,at,time)).catch(()=>{});},
     onUpdate:(id,update)=>{void write(()=>{const current=store.getState().markers.find(marker=>String(marker.id)===id);if(!current)throw new Error('The marker is no longer available.');return updateCadenceLaneMarker(document,id,update,time,current,RATE);}).catch(()=>{});},
     onRemove:id=>{void write(()=>removeCadenceLaneMarker(document,id)).catch(()=>{});}}}/>
   {view.summary&&<Text accessibilityLiveRegion="polite" style={textStyle}>{view.summary}</Text>}
   {view.markers.length===0&&<Text style={textStyle}>No markers yet. Detect beats, or add one at the playhead.</Text>}
   {view.markers.length>0&&<Text style={textStyle}>{view.markers.length} marker{view.markers.length===1?'':'s'} saved in the document. Undo and Redo apply to each detection run as one step.</Text>}
  </>}
 </View>;
}
