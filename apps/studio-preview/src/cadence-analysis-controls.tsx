import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import {Banner,Button,Select,TabBar,Text,View} from '@nitro-forge/studio-workspace/ui';
import {resolveWorkspaceScale,workspaceThemes,type WorkspaceDensity} from '@nitro-forge/studio-workspace/theme';
import {AutomationLane} from '@nyc-tron/ui/components/forge/audio/AutomationLane';
import {AutomationModePicker} from '@nyc-tron/ui/components/forge/audio/AutomationModePicker';
import {EQFrequencyGraph} from '@nyc-tron/ui/components/forge/audio/EQFrequencyGraph';
import {DynamicsTransferGraph} from '@nyc-tron/ui/components/forge/audio/DynamicsTransferGraph';
import {LoudnessMeter} from '@nyc-tron/ui/components/forge/audio/LoudnessMeter';
import {SpectrogramView} from '@nyc-tron/ui/components/forge/audio/SpectrogramView';
import type {EqResponsePoint} from '@nyc-tron/ui/components/forge/audio/eq-graph';
import type {DynamicsCurvePoint} from '@nyc-tron/ui/components/forge/audio/dynamics-graph';
import type {CadenceDocument,AutomationParam} from '../../../packages/cadence/src/index';
import {CadenceMixerAdapter,type CadenceMixerState} from '../../../packages/cadence/src/mixer-cluster';

export interface CadenceAnalysisControlsProps {
 document:CadenceDocument;
 project:CadenceMixerState;
 disabled:boolean;
 commit:(write:()=>Promise<unknown>)=>Promise<void>;
 density:WorkspaceDensity;
 theme:'dark'|'light';
}
type Offline = {
 loudness:Awaited<ReturnType<ReturnType<CadenceMixerAdapter['analysis']>['loudness']>>;
 spectrogram:Awaited<ReturnType<ReturnType<CadenceMixerAdapter['analysis']>['spectrogram']>>;
};
type Graph = {kind:'eq';points:readonly EqResponsePoint[]}|{kind:'compressor';points:readonly DynamicsCurvePoint[]};
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const observed=<T,>(task:Promise<T>)=>{void task.catch(()=>{});return task;};
function clipEnd(project:CadenceMixerState){let end=0;for(const track of project.tracks)for(const clip of track.clips)end=Math.max(end,clip.start_ticks+clip.length_ticks);return end;}

/** Document controls and explicit offline measurements. Owns no audio/player/native handle. */
export function CadenceAnalysisControls(props:CadenceAnalysisControlsProps){
 const {document,project,disabled,commit}=props,scale=resolveWorkspaceScale(props.density),colors=workspaceThemes[props.theme];
 const adapter=useMemo(()=>new CadenceMixerAdapter(document),[document]);
 const store=useMemo(()=>createStore(()=>({panel:'automation' as 'automation'|'graphs'|'offline',trackId:null as number|null,slotId:null as number|null,param:'gain' as AutomationParam,
  bars:4,selectedTick:undefined as number|undefined,band:undefined as number|undefined,retry:0,
  graph:null as Graph|null,graphStatus:'idle' as 'idle'|'loading'|'ready'|'error',graphError:'',
  offline:null as Offline|null,offlineStatus:'idle' as 'idle'|'loading'|'ready'|'error',offlineError:'',offlineBusy:false})),[document]);
 const view=useStore(store,s=>s);
 const latestStore=useRef(store);latestStore.current=store;
 const offlineLock=useRef(false);
 const track=project.tracks.find(t=>t.id===view.trackId)??project.tracks[0];
 const graphSlots=track?.inserts.filter(slot=>slot.kind==='eq'||slot.kind==='compressor')??[];
 const slot=graphSlots.find(slot=>slot.id===view.slotId)??graphSlots[0];
 const identity=JSON.stringify([view.panel,track?.id,slot?.id,view.param,view.bars]);
 const boundary=useRef({document,project,disabled,identity,generation:0});
 const previous=boundary.current;
 if(previous.document!==document||previous.project!==project||previous.disabled!==disabled||previous.identity!==identity)
  boundary.current={document,project,disabled,identity,generation:previous.generation+1};
 const generation=boundary.current.generation;
 const mounted=useRef(false),graphSource=useRef(-1),offlineSource=useRef(-1),offlineRequest=useRef(0);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const current=()=>mounted.current&&boundary.current.generation===generation&&!boundary.current.disabled;
 const select=(patch:Partial<ReturnType<typeof store.getState>>)=>{
  boundary.current={...boundary.current,generation:boundary.current.generation+1};
  store.setState(patch);
 };
 const write=(action:()=>Promise<unknown>)=>current()?observed(commit(action)):observed(Promise.reject(new Error('The selected analysis controls changed. Wait for the current document.')));
 const controlKey=JSON.stringify([identity,generation]);
 useEffect(()=>{
  let active=true;graphSource.current=-1;
  if(disabled||view.panel!=='graphs'||!slot)return;
  store.setState({graph:null,graphStatus:'loading',graphError:''});
  const load=async():Promise<Graph>=>slot.kind==='eq'
   ?{kind:'eq',points:await adapter.eq(slot.id).loadResponse(128,48000)}
   :{kind:'compressor',points:await adapter.dynamics(slot.id).loadCurve()};
  void load().then(graph=>{if(active&&current()){graphSource.current=generation;store.setState({graph,graphStatus:'ready'});}},error=>{
   if(active&&current()){graphSource.current=generation;store.setState({graph:null,graphStatus:'error',graphError:errorText(error)});}
  });
  return()=>{active=false;};
 },[adapter,project,disabled,identity,generation,view.retry,store]);
 const quarterBeats=project.time_sig[0]*4/project.time_sig[1];
 const supportsGrid=Number.isSafeInteger(quarterBeats)&&quarterBeats>=1&&quarterBeats<=64;
 const windowTicks=Math.max(1,Math.floor(project.ppq*quarterBeats*view.bars));
 const lane=track?.automation[view.param];
 const visiblePoints=lane?.points.map((point,index)=>({point,index})).filter(item=>item.point.ticks<=windowTicks)??[];
 const selectedPoint=visiblePoints.findIndex(item=>item.point.ticks===view.selectedTick);
 const graphReady=graphSource.current===generation&&view.graphStatus==='ready';
 const end=clipEnd(project);
 // One bounded first-range render, at most ten seconds at the current tempo.
 const analysisTicks=Math.min(end,windowTicks,Math.max(1,Math.floor(10*project.tempo_bpm*project.ppq/60)));
 const runOffline=()=>{
  if(!current()||analysisTicks<=0||offlineLock.current)return;
  offlineLock.current=true;
  const request=++offlineRequest.current;offlineSource.current=generation;
  store.setState({offline:null,offlineStatus:'loading',offlineError:'',offlineBusy:true});
  const run=async()=>{
   const analysis=adapter.analysis({fromTicks:0,toTicks:analysisTicks,sampleRate:48000,includeMetronome:false});
   // Sequential reads avoid two simultaneous render buffers and keep each request bounded.
   const loudness=await analysis.loudness();
   if(!current()||request!==offlineRequest.current)return;
   const spectrogram=await analysis.spectrogram({fftSize:1024,hop:1024,bands:32});
   if(current()&&request===offlineRequest.current){offlineSource.current=generation;store.setState({offline:{loudness,spectrogram},offlineStatus:'ready'});}
  };
  void run().catch(error=>{if(current()&&request===offlineRequest.current){offlineSource.current=generation;store.setState({offline:null,offlineStatus:'error',offlineError:errorText(error)});}}).finally(()=>{offlineLock.current=false;if(mounted.current)latestStore.current.setState({offlineBusy:false});});
 };
 const offlineCurrent=offlineSource.current===generation;
 const offline=offlineCurrent?view.offline:null;
 const textStyle={color:colors.muted,fontSize:scale.type.body};
 return <View testID="cadence-analysis-controls" style={{gap:scale.space.group}}>
  <TabBar semantics="tabs" density="compact" aria-label="Automation and analysis panels" tabs={(['automation','graphs','offline'] as const).map(panel=>({key:panel,label:panel==='automation'?'Automation':panel==='graphs'?'EQ / dynamics':'Offline analysis',icon:null,active:view.panel===panel,onPress:()=>select({panel,selectedTick:undefined,band:undefined})}))}/>
  <Select label="Analysis window" value={String(view.bars)} options={[1,4,8].map(value=>({value:String(value),label:`First ${value} ${value===1?'bar':'bars'}`}))}
   disabled={disabled} onValueChange={value=>{const bars=Number(value);if([1,4,8].includes(bars))select({bars,selectedTick:undefined});}}/>
  {view.panel!=='offline'&&<>
   {!track?<Text style={textStyle}>Add a track in Routing or MIDI to edit automation and insert graphs.</Text>:<>
    <Select label="Track for automation or graphs" value={String(track.id)} options={project.tracks.map(track=>({value:String(track.id),label:track.name}))} disabled={disabled}
     onValueChange={value=>select({trackId:Number(value),slotId:null,selectedTick:undefined,band:undefined})}/>
    {view.panel==='automation'&&lane&&<>
     <Select label="Automation parameter" value={view.param} options={[{value:'gain',label:'Gain'},{value:'pan',label:'Pan'}]} disabled={disabled}
      onValueChange={value=>{if(value==='gain'||value==='pan')select({param:value,selectedTick:undefined});}}/>
     <AutomationModePicker key={controlKey+'mode'} mode={lane.mode} label={`${track.name} ${view.param} automation mode`} disabled={disabled}
      onModeCommit={mode=>write(()=>{if(mode!=='off'&&mode!=='read')throw new Error('Live automation modes require a transport host.');return adapter.automation(track.id,view.param).onModeCommit(mode);})}/>
     {supportsGrid&&visiblePoints.length<=2048?<AutomationLane key={controlKey} label={`${track.name} ${view.param} · first ${view.bars} bars`} param={view.param}
      points={visiblePoints.map(item=>item.point)} mode={lane.mode} lengthTicks={windowTicks} ppq={project.ppq} beatsPerBar={quarterBeats}
      snapTicks={Math.max(1,Math.round(project.ppq/4))} pixelsPerTick={Math.min(.1,4096/windowTicks)} disabled={disabled}
      {...(selectedPoint>=0?{selectedIndex:selectedPoint}:{})} cursorTicks={Math.min(project.playhead_ticks,windowTicks)}
      onSelect={index=>store.setState({selectedTick:visiblePoints[index]?.point.ticks})}
      onPointAdd={(ticks,value)=>write(()=>adapter.automation(track.id,view.param).onPointAdd(ticks,value))}
      onPointMove={(index,ticks,value)=>write(()=>{const item=visiblePoints[index];if(!item)throw new Error('Automation point is unavailable.');return adapter.automation(track.id,view.param).onPointMove(item.index,ticks,value);})}
      onPointRemove={index=>write(()=>{const item=visiblePoints[index];if(!item)throw new Error('Automation point is unavailable.');return adapter.automation(track.id,view.param).onPointRemove(item.index);})}/>
      :<Banner tone="info" title={!supportsGrid?'The pinned automation lane requires whole quarter-note bars. Mode selection remains available.':'This window exceeds the 2048-point preview budget. Choose a shorter window.'}/>}
     <Text style={textStyle}>Off and Read are document automation modes. Live write, touch and latch recording require a transport host.</Text>
    </>}
    {view.panel==='graphs'&&<>
     {!slot?<Text style={textStyle}>Select Effects and add an EQ or compressor insert to this track.</Text>:<>
      <Select label="Insert graph" value={String(slot.id)} options={graphSlots.map(slot=>({value:String(slot.id),label:`${slot.kind} ${slot.id}`}))} disabled={disabled}
       onValueChange={value=>select({slotId:Number(value),band:undefined})}/>
      {!graphReady&&<Text accessibilityLiveRegion="polite" style={textStyle}>{graphSource.current===generation&&view.graphStatus==='error'?view.graphError:'Loading engine response…'}</Text>}
      {graphSource.current===generation&&view.graphStatus==='error'&&<Button title="Retry response" targetSize={scale.size.target} disabled={disabled} onPress={()=>store.setState(s=>({retry:s.retry+1}))}/>}
      {graphReady&&view.graph?.kind==='eq'&&slot.kind==='eq'&&<EQFrequencyGraph key={controlKey} label={`${track.name} EQ response at 48 kHz`} bands={slot.params.bands.map(b=>({type:b.type,freqHz:b.freq_hz,gainDb:b.gain_db,q:b.q,enabled:b.enabled}))}
       response={view.graph.points} range={24} disabled={disabled} {...(view.band!==undefined&&Number.isSafeInteger(view.band)&&view.band>=0&&view.band<slot.params.bands.length?{selectedIndex:view.band}:{})} onSelect={band=>store.setState({band})}
       onBandCommit={(index,edit)=>write(()=>adapter.eq(slot.id).onBandCommit(index,edit))} onEnabledCommit={(index,enabled)=>write(()=>adapter.eq(slot.id).onEnabledCommit(index,enabled))}/>}
      {graphReady&&view.graph?.kind==='compressor'&&slot.kind==='compressor'&&<DynamicsTransferGraph key={controlKey} label={`${track.name} compressor transfer`} curve={view.graph.points} disabled={disabled}
       params={{thresholdDb:slot.params.threshold_db,ratio:slot.params.ratio,kneeDb:slot.params.knee_db,makeupDb:slot.params.makeup_db}}
       onThresholdCommit={value=>write(()=>adapter.dynamics(slot.id).onThresholdCommit(value))} onRatioCommit={value=>write(()=>adapter.dynamics(slot.id).onRatioCommit(value))}/>}
     </>}
     <Text style={textStyle}>These curves come from the document engine. They are not live audio measurements.</Text>
    </>}
   </>}
  </>}
  {view.panel==='offline'&&<>
   <Text style={textStyle}>Offline master analysis: ticks 0–{analysisTicks}, 48 kHz, at most ten seconds. The metronome is excluded.</Text>
   <Button title={offlineCurrent&&view.offlineStatus==='loading'?'Analyzing…':'Run offline analysis'} disabled={disabled||analysisTicks<=0||view.offlineBusy||offlineLock.current} targetSize={scale.size.target} onPress={runOffline}/>
   {analysisTicks<=0&&<Text style={textStyle}>Add a MIDI clip before analyzing the rendered master.</Text>}
   {offlineCurrent&&view.offlineStatus==='error'&&<Banner tone="danger" title={view.offlineError} live="alert"/>}
   {offline&&<>
    <LoudnessMeter label="Offline master range" status={offline.loudness.integratedLufs===null?'silent':'ready'} {...offline.loudness}/>
    <SpectrogramView label="Offline master spectrum" status={offline.spectrogram.frames.length?'ready':'empty'} {...offline.spectrogram}/>
   </>}
  </>}
 </View>;
}
