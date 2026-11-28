import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface TimelapseExportSettings {format:'mp4'|'webm';width:number;height:number;fps:number}
export interface TimelapseArtifact {uri:string;bytes:number;mime:'video/mp4'|'video/webm';width:number;height:number;durationMs:number}
export interface TimelapseProgress {completedFrames:number;totalFrames:number}
export interface TimelapsePlaybackExporterProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 recording:boolean;eventCount:number;durationMs:number;
 onRecordingChange:(recording:boolean,signal:AbortSignal)=>void|Promise<unknown>;
 playback:{playing:boolean;positionMs:number;rate:number};
 onPlaybackChange:(state:{playing:boolean;positionMs:number;rate:number})=>void;
 renderPreview:(positionMs:number)=>ReactNode;
 value:TimelapseExportSettings;onSettingsChange:(value:TimelapseExportSettings)=>void;
 formats:readonly {id:'mp4'|'webm';label:string;unavailableReason?:string}[];
 /** Encode the real, non-destructive history into a file. Honour abort and remove partial outputs. */
 onExport:(settings:TimelapseExportSettings,signal:AbortSignal,onProgress:(progress:TimelapseProgress)=>void)=>Promise<TimelapseArtifact>;
 onOpenExport:(artifact:TimelapseArtifact)=>void;unstyled?:boolean;
}
export function TimelapsePlaybackExporter({scope='timelapse',revision=0,...props}:TimelapsePlaybackExporterProps){
 const {recording,eventCount,durationMs,onRecordingChange:_record,playback,onPlaybackChange,renderPreview,value,onSettingsChange,formats,onExport:_export,onOpenExport,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(eventCount)||eventCount<0||!Number.isFinite(durationMs)||durationMs<0||durationMs>86400000||![value.width,value.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=8192)||!Number.isInteger(value.fps)||value.fps<1||value.fps>120||!['mp4','webm'].includes(value.format)||formats.length>2||new Set(formats.map(f=>f.id)).size!==formats.length||formats.some(f=>!['mp4','webm'].includes(f.id)||!f.label.trim())||!Number.isFinite(playback.positionMs)||playback.positionMs<0||playback.positionMs>durationMs||!Number.isFinite(playback.rate)||playback.rate<.25||playback.rate>8)throw new RangeError('Invalid timelapse state');
 const boundary=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),action=useOwnedAction(boundary),busy=action.pending!==null,off=busy||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v);
 const committed=useRef({boundary,props}),admitted=useRef(false);
 useLayoutEffect(()=>{committed.current={boundary,props};});
 useLayoutEffect(()=>{admitted.current=false;store.setState({progress:null,artifact:null,progressError:null});return()=>{admitted.current=true;};},[boundary]);
 const current=()=>committed.current.boundary===boundary&&!off&&!admitted.current?committed.current.props:null;
 const run=(id:string,operation:(host:typeof props,signal:AbortSignal)=>unknown|Promise<unknown>)=>{const host=current();if(!host)return;admitted.current=true;void action.run(id,signal=>operation(host,signal),undefined,{pendingForAsyncOnly:true}).finally(()=>{if(committed.current.boundary===boundary)admitted.current=false;});};
 const format=formats.find(f=>f.id===value.format),exportReason=recording?'Pause history recording before export':eventCount===0||durationMs===0?'Draw some history before export':!format?'This encoder is not available':format.unavailableReason;
 const change=(patch:Partial<TimelapseExportSettings>)=>{if(current())onSettingsChange({...value,...patch});};
 const exportFile=()=>{
  const host=current();if(!host||exportReason)return;admitted.current=true;store.setState({progress:null,artifact:null,progressError:null});
  void action.run('export',signal=>host.onExport({...host.value},signal,progress=>{
   if(signal.aborted||committed.current.boundary!==boundary)return;
   if(!Number.isSafeInteger(progress.completedFrames)||!Number.isSafeInteger(progress.totalFrames)||progress.totalFrames<1||progress.completedFrames<0||progress.completedFrames>progress.totalFrames||progress.completedFrames<(store.getState().progress?.completedFrames??0)){action.cancel();admitted.current=false;store.setState({progress:null,progressError:'Encoder reported invalid progress'});return;}
   store.setState({progress:{...progress}});
  }),artifact=>{
   if(!artifact.uri.trim()||artifact.uri.length>8192||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<=0||!Number.isSafeInteger(artifact.width)||artifact.width<1||!Number.isSafeInteger(artifact.height)||artifact.height<1||!Number.isFinite(artifact.durationMs)||artifact.durationMs<=0||artifact.mime!==(host.value.format==='mp4'?'video/mp4':'video/webm'))throw new Error('Encoder did not return a valid media file');
   store.setState({artifact:{...artifact}});
  }).finally(()=>{if(committed.current.boundary===boundary)admitted.current=false;});
 };
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]} accessibilityLabel="Drawing timelapse">
  <Text {...{className:unstyled?undefined:'text-text'}}>{eventCount} recorded drawing events; {(durationMs/1000).toFixed(1)} seconds</Text>
  <Button title={recording?'Pause history recording':'Record drawing history'} disabled={off} unstyled={unstyled} onPress={()=>run('record',(host,signal)=>host.onRecordingChange(!host.recording,signal))}/>
  {renderPreview(playback.positionMs)}
  <Button title={playback.playing?'Pause timelapse':'Play timelapse'} disabled={off||durationMs===0} unstyled={unstyled} onPress={()=>{if(current())onPlaybackChange({...playback,playing:!playback.playing});}}/>
  <PrecisionScrubber scope={scope} revision={revision} label="History position" unit=" ms" value={playback.positionMs} min={0} max={Math.max(1,durationMs)} step={1} disabled={off||durationMs===0} unstyled={unstyled} onCommit={positionMs=>{if(current())onPlaybackChange({...playback,positionMs});}}/>
  <PrecisionScrubber scope={scope} revision={revision} label="Timelapse playback speed" unit="×" value={playback.rate} min={.25} max={8} step={.25} disabled={off} unstyled={unstyled} onCommit={rate=>{if(current())onPlaybackChange({...playback,rate});}}/>
  <Select label="Timelapse format" value={value.format} options={formats.map(f=>({value:f.id,label:f.label,disabled:f.unavailableReason!==undefined}))} disabled={off} unstyled={unstyled} onValueChange={format=>change({format:format as TimelapseExportSettings['format']})}/>
  {(['width','height','fps'] as const).map(key=><PrecisionScrubber key={key} scope={scope} revision={revision} label={'Export '+key} value={value[key]} min={1} max={key==='fps'?120:8192} step={1} disabled={off} unstyled={unstyled} onCommit={n=>change({[key]:Math.round(n)})}/>)}
  {exportReason?<Text {...{className:unstyled?undefined:'text-text'}}>{exportReason}</Text>:null}
  <Button title="Export timelapse file" disabled={off||exportReason!==undefined} accessibilityHint={exportReason} unstyled={unstyled} onPress={exportFile}/>
  {action.pending==='export'?<><Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{s.progress?`${s.progress.completedFrames} of ${s.progress.totalFrames} frames encoded`:'Encoding; progress not reported'}</Text><Button title="Cancel timelapse export" unstyled={unstyled} onPress={()=>{action.cancel();admitted.current=false;store.setState({progress:null});}}/></>:null}
  {s.artifact?<><Text {...{className:unstyled?undefined:'text-text'}}>Exported {s.artifact.bytes} bytes</Text><Button title="Open exported timelapse" disabled={off} unstyled={unstyled} onPress={()=>{if(current()&&s.artifact)onOpenExport(s.artifact);}}/></>:null}
  {disabledReason?<Text {...{className:unstyled?undefined:'text-text'}}>{disabledReason}</Text>:null}<ErrorMessage {...exact({message:action.error??s.progressError??undefined,unstyled:unstyled})}/>
 </View>;
}
function makeStore(){return createStore(()=>({progress:null as TimelapseProgress|null,artifact:null as TimelapseArtifact|null,progressError:null as string|null}));}
