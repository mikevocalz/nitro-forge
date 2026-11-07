import {useEffect,useMemo,useRef} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import {Banner,Button,Select,TabBar,Text,View} from '@nitro-forge/studio-workspace/ui';
import {resolveWorkspaceScale,workspaceThemes,type WorkspaceDensity} from '@nitro-forge/studio-workspace/theme';
import {BusAndRoutingMatrix} from '@nyc-tron/ui/components/forge/audio/BusAndRoutingMatrix';
import {InsertEffectRack} from '@nyc-tron/ui/components/forge/audio/InsertEffectRack';
import {PluginPresetBrowser} from '@nyc-tron/ui/components/forge/audio/PluginPresetBrowser';
import {PrecisionScrubber} from '@nyc-tron/ui/components/forge/inputs/PrecisionScrubber';
import {MIDIPianoRoll,PIANO_ROLL_KEY_COLUMN} from '@nyc-tron/ui/components/forge/midi/MIDIPianoRoll';
import {MIDIVelocityLane} from '@nyc-tron/ui/components/forge/midi/MIDIVelocityLane';
import {CadenceAnalysisControls} from './cadence-analysis-controls';
import {CadenceMixerAdapter,mixerClusterRoutes,mixerClusterSlots,type CadenceMixerState,type MixerInsert} from '../../../packages/cadence/src/mixer-cluster';
import {createCadenceClipBindings} from '../../../packages/cadence/src/editor-adapter';
import type {CadenceDocument,CompressorParams,EqBandType,InsertPreset} from '../../../packages/cadence/src/index';

export interface CadenceDetailControlsProps {
 document:CadenceDocument;
 project:CadenceMixerState;
 disabled:boolean;
 /** The owning surface's generation gate and shared document operation lock. */
 commit:(write:()=>Promise<unknown>)=>Promise<void>;
 density:WorkspaceDensity;
 theme:'dark'|'light';
}
// alpha.4 has no capability marker. Keep its original contract until a supported host is supplied.
const midiCapabilities=(MIDIPianoRoll as typeof MIDIPianoRoll & {capabilities?:{version?:number;rationalTimeSignature?:boolean;controlledScrollX?:boolean}}).capabilities;
const rationalMidiHost=midiCapabilities?.version===1&&midiCapabilities.rationalTimeSignature===true;
const controlledMidiScroll=midiCapabilities?.version===1&&midiCapabilities.controlledScrollX===true;
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
/** Observe legacy void callbacks while preserving the original rejection for awaited callers. */
const observed=<T,>(task:Promise<T>)=>{void task.catch(()=>{});return task;};

/** App composition: no audio context, player, synthetic meters or document handle ownership. */
export function CadenceDetailControls(props:CadenceDetailControlsProps){
 const {document,project,disabled,commit}=props,scale=resolveWorkspaceScale(props.density);
 const adapter=useMemo(()=>new CadenceMixerAdapter(document),[document]);
 const store=useMemo(()=>createStore(()=>({panel:'routing' as 'routing'|'effects'|'midi'|'analysis',trackId:null as number|null,slotId:null as number|null,clipId:null as number|null,note:undefined as number|undefined,scrollX:0,scrollBoundary:'',
  presetKey:'',presets:[] as InsertPreset[],presetStatus:'loading' as 'loading'|'ready'|'error',presetError:'',retry:0})),[document]);
 const view=useStore(store,s=>s);
 const selectableTracks=view.panel==='midi'?project.tracks.filter(t=>t.kind==='midi'):project.tracks;
 const track=selectableTracks.find(t=>t.id===view.trackId)??selectableTracks[0];
 const slot=track?.inserts.find(s=>s.id===view.slotId);
 const clip=track?.clips.find(c=>c.id===view.clipId)??track?.clips[0];
 const identity=JSON.stringify([view.panel,track?.id,slot?.id,clip?.id]);
 const authority=useRef({project,revision:0});
 if(authority.current.project!==project)authority.current={project,revision:authority.current.revision+1};
 // alpha.4 controls have no scope/revision API: cancel their local drafts and gestures
 // when authoritative data or the edited selection changes, never on density/geometry.
 const controlBoundary=JSON.stringify([identity,authority.current.revision,disabled]);
 const boundaryRef=useRef(controlBoundary);
 boundaryRef.current=controlBoundary;
 const current=useRef({document,project,disabled,identity});
 current.current={document,project,disabled,identity};
 const select=(patch:Partial<ReturnType<typeof store.getState>>)=>{current.current.identity='';store.setState(patch);};
 const write=(action:()=>Promise<unknown>)=>{
  const latest=current.current;
  if(latest.document!==document||latest.project!==project||latest.disabled||latest.identity!==identity)
   return observed(Promise.reject(new Error('The selected audio controls changed. Wait for the current document.')));
  return observed(commit(action));
 };
 const presetKey=slot?`${track!.id}:${slot.id}:${slot.kind}`:'';
 const presetSource=useRef<unknown>(null);
 useEffect(()=>{
  let active=true;presetSource.current=null;
  if(!slot||disabled||view.panel!=='effects')return;
  store.setState({presetKey,presetStatus:'loading',presetError:'',presets:[]});
  void adapter.presets(slot.id).load(slot.kind).then(presets=>{
   const latest=current.current;
   if(active&&latest.document===document&&latest.project===project&&!latest.disabled&&latest.identity===identity){
    presetSource.current=project;store.setState({presets:[...presets],presetStatus:'ready'});
   }
  },error=>{if(active&&current.current.document===document&&current.current.project===project&&!current.current.disabled&&current.current.identity===identity){presetSource.current=project;store.setState({presetStatus:'error',presetError:errorText(error)});}});
  return()=>{active=false;};
 },[adapter,document,project,slot?.id,slot?.kind,presetKey,identity,disabled,view.retry,store]);
 const readyPresets=presetSource.current===project&&view.presetKey===presetKey;
 const routes=mixerClusterRoutes(project),routing=adapter.routing();
 const numeric=(label:string,value:number,min:number,max:number,step:number,unit:string,action:(value:number)=>Promise<unknown>)=><PrecisionScrubber key={controlBoundary+label} label={label} value={value} min={min} max={max} step={step} unit={unit} disabled={disabled} {...{targetSize:scale.size.target}} onCommit={value=>write(()=>action(value))}/>;
 return <View testID="cadence-detail-controls" style={{gap:scale.space.group}}>
  <TabBar semantics="tabs" density="compact" aria-label="Audio detail panels" tabs={(['routing','effects','midi','analysis'] as const).map(panel=>({key:panel,label:panel==='midi'?'MIDI':panel==='routing'?'Routing':panel==='analysis'?'Analysis':'Effects',icon:null,active:view.panel===panel,onPress:()=>select({panel,note:undefined,scrollX:0})}))}/>
  {view.panel==='analysis'&&<CadenceAnalysisControls document={document} project={project} disabled={disabled} commit={write} density={props.density} theme={props.theme}/>}
  {view.panel==='routing'&&<>
  <Button title="Add bus" disabled={disabled} targetSize={scale.size.target} variant="ghost" onPress={()=>{void write(()=>document.addTrack('bus'));}}/>
  <BusAndRoutingMatrix key={controlBoundary} {...routes} disabled={disabled} onOutputCommit={(id,bus)=>write(()=>routing.onOutputCommit(id,bus))}
   onSendCommit={(id,bus,level)=>write(()=>routing.onSendCommit(id,bus,level))} onSendRemove={(id,bus)=>write(()=>routing.onSendRemove(id,bus))}/>
  </>}
  {view.panel!=='routing'&&view.panel!=='analysis'&&!track&&<Button title="Add MIDI track" variant="ghost" disabled={disabled} targetSize={scale.size.target} onPress={()=>{void write(()=>document.addTrack('midi'));}}/>}
  {view.panel!=='routing'&&view.panel!=='analysis'&&track&&<>
   <Select label="Track to edit" value={String(track.id)} options={selectableTracks.map(t=>({value:String(t.id),label:t.name}))}
    disabled={disabled} onValueChange={id=>select({trackId:Number(id),slotId:null,clipId:null,note:undefined,scrollX:0})}/>
   {view.panel==='effects'&&<>
   <InsertEffectRack key={controlBoundary} label={track.name} inserts={mixerClusterSlots(project,track.id)} disabled={disabled}
    {...(slot?{selectedId:String(slot.id)}:{})} onSelect={id=>select({slotId:Number(id)})}
    onAdd={kind=>write(()=>adapter.inserts(track.id).onAdd(kind))} onRemove={id=>write(()=>adapter.inserts(track.id).onRemove(id))}
    onMove={(id,index)=>write(()=>adapter.inserts(track.id).onMove(id,index))} onBypassCommit={(id,bypassed)=>write(()=>adapter.inserts(track.id).onBypassCommit(id,bypassed))}/>
   {slot&&<View style={{gap:scale.space.inset}}>
    <Text style={{color:workspaceThemes[props.theme].text,fontSize:scale.type.body}}>{track.name} · {slot.kind}</Text>
    {view.presetError&&readyPresets&&<Banner tone="danger" title={view.presetError} live="alert"/>}
    <PluginPresetBrowser key={controlBoundary} kind={slot.kind} presets={readyPresets?view.presets:[]} status={readyPresets?view.presetStatus:'loading'} disabled={disabled||!readyPresets}
     onRetry={()=>store.setState(s=>({retry:s.retry+1}))} onApply={id=>write(()=>adapter.presets(slot.id).onApply(id))}/>
    <InsertParameters key={controlBoundary} slot={slot} numeric={numeric} document={document} write={write} disabled={disabled}/>
   </View>}
   </>}
   {view.panel==='midi'&&track.kind==='midi'&&<>
    {!clip&&<Button title="Add four-bar MIDI clip" disabled={disabled} targetSize={scale.size.target} variant="ghost"
     onPress={()=>{void write(()=>document.addClip(track.id,0,project.ppq*project.time_sig[0]*4*4/project.time_sig[1]));}}/>}
    {clip&&<>
     <Select label="MIDI clip to edit" value={String(clip.id)} options={track.clips.map(c=>({value:String(c.id),label:`Clip ${c.id} · ${c.length_ticks} ticks`}))}
      disabled={disabled} onValueChange={id=>select({clipId:Number(id),note:undefined,scrollX:0})}/>
     <MidiEditors key={controlBoundary} document={document} project={project} clip={clip} disabled={disabled} target={scale.size.target} selected={view.note} requestedScrollX={view.scrollX} scrollX={view.scrollBoundary===controlBoundary?view.scrollX:0}
      onSelect={note=>select({note})} onScrollX={scrollX=>{if(boundaryRef.current===controlBoundary)store.setState({scrollX,scrollBoundary:controlBoundary});}} write={write}/>
    </>}
   </>}
  </>}
 </View>;
}

type Numeric=(label:string,value:number,min:number,max:number,step:number,unit:string,action:(value:number)=>Promise<unknown>)=>React.JSX.Element;
function InsertParameters({slot,numeric,document,write,disabled}:{slot:MixerInsert;numeric:Numeric;document:CadenceDocument;write:(action:()=>Promise<unknown>)=>Promise<unknown>;disabled:boolean}){
 if(slot.kind==='gain')return numeric('Insert gain',slot.params.gain_db,-24,24,.1,' dB',gain_db=>document.setInsertParams(slot.id,{gain_db}));
 if(slot.kind==='compressor'){
  const fields:readonly [keyof CompressorParams,string,number,number,number,string][]=[['threshold_db','Threshold',-60,0,.1,' dB'],['ratio','Ratio',1,20,.1,':1'],['knee_db','Knee',0,24,.1,' dB'],['attack_ms','Attack',.1,200,.1,' ms'],['release_ms','Release',5,2000,1,' ms'],['makeup_db','Makeup',0,24,.1,' dB']];
  return <>{fields.map(([key,label,min,max,step,unit])=>numeric(label,slot.params[key],min,max,step,unit,value=>document.setInsertParams(slot.id,{[key]:value})))}</>;
 }
 const choices:readonly EqBandType[]=['peak','low_shelf','high_shelf','low_pass','high_pass'];
 return <>{slot.params.bands.map((band,index)=>{
  const update=(patch:Partial<typeof band>)=>document.setInsertParams(slot.id,{bands:slot.params.bands.map((b,i)=>({...b,...(i===index?patch:{})}))});
  return <View key={index} style={{gap:8}}><Select label={`Band ${index+1} type`} value={band.type} options={choices.map(value=>({value,label:value.replaceAll('_',' ')}))} disabled={disabled} onValueChange={type=>{if(choices.includes(type as EqBandType))void write(()=>update({type:type as EqBandType}));}}/>
   <Select label={`Band ${index+1} state`} value={band.enabled?'on':'off'} options={[{value:'on',label:'Enabled'},{value:'off',label:'Bypassed'}]} disabled={disabled} onValueChange={value=>{void write(()=>update({enabled:value==='on'}));}}/>
   {numeric(`Band ${index+1} frequency`,band.freq_hz,20,20000,1,' Hz',freq_hz=>update({freq_hz}))}
   {band.type!=='low_pass'&&band.type!=='high_pass'&&numeric(`Band ${index+1} gain`,band.gain_db,-24,24,.1,' dB',gain_db=>update({gain_db}))}
   {numeric(`Band ${index+1} Q`,band.q,.1,18,.1,'',q=>update({q}))}
  </View>;
 })}</>;
}
function MidiEditors({document,project,clip,disabled,target,selected,requestedScrollX,scrollX,onSelect,onScrollX,write}:{document:CadenceDocument;project:CadenceMixerState;clip:CadenceMixerState['tracks'][number]['clips'][number];disabled:boolean;target:number;selected:number|undefined;requestedScrollX:number;scrollX:number;onSelect:(index:number)=>void;onScrollX:(x:number)=>void;write:(action:()=>Promise<unknown>)=>Promise<unknown>}){
 const bindings=createCadenceClipBindings(document,clip.id),midi=new CadenceMixerAdapter(document).midi(clip.id);
 const notes=clip.notes.map(n=>({pitch:n.pitch,velocity:n.velocity,startTicks:n.start_ticks,lengthTicks:n.length_ticks,channel:n.channel}));
 const quarterBeatsPerBar=project.time_sig[0]*4/project.time_sig[1];
 const supportsBarGrid=rationalMidiHost||(Number.isInteger(quarterBeatsPerBar)&&quarterBeatsPerBar>0);
 const selection=selected===undefined||!notes[selected]?{}:{selectedIndex:selected};
 return <View style={{gap:8}}>
  {supportsBarGrid?<MIDIPianoRoll notes={notes} clipTicks={clip.length_ticks} ppq={project.ppq} {...(rationalMidiHost?{timeSignature:project.time_sig}:{beatsPerBar:quarterBeatsPerBar})} {...(controlledMidiScroll?{scrollX:requestedScrollX}:{})} rowHeight={target} height={352} {...selection} disabled={disabled} onSelect={onSelect} onScrollX={onScrollX}
   onNoteAdd={(start,length,pitch)=>write(()=>bindings.onNoteAdd(start,length,pitch))} onNoteMove={(index,start,pitch)=>write(()=>bindings.onNoteMove(index,start,pitch))}
   onNoteResize={(index,length)=>write(()=>bindings.onNoteResize(index,length))} onNoteRemove={index=>write(()=>bindings.onNoteRemove(index))} onNoteChannel={(index,channel)=>write(()=>midi.onNoteChannel(index,channel))}/>:<Banner tone="info" title="The current piano-roll host requires whole quarter-note bars. Velocity editing remains available in project ticks."/>}
  <MIDIVelocityLane notes={notes} clipTicks={clip.length_ticks} inset={PIANO_ROLL_KEY_COLUMN} scrollX={scrollX} {...selection} disabled={disabled} onSelect={onSelect}
   onVelocityCommit={(index,velocity)=>write(()=>bindings.onVelocityCommit(index,velocity))} onVelocitiesCommit={changes=>write(()=>midi.onVelocitiesCommit(changes))}/>
 </View>;
}
