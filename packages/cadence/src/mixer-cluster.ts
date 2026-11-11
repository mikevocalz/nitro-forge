import type {AnalysisRange,AutomationMode,AutomationParam,CadenceDocument,CompressorParams,EqBand,InsertKind,TrackKind} from './index';
import type {CadenceDescribe} from './editor-adapter';

/** An authoritative insert in {@linkcode CadenceMixerState}. */
export type MixerInsert = {readonly id:number;readonly bypassed:boolean}&(
  {readonly kind:'gain';readonly params:{readonly gain_db:number}}|
  {readonly kind:'eq';readonly params:{readonly bands:readonly EqBand[]}}|
  {readonly kind:'compressor';readonly params:Readonly<CompressorParams>});
/** Full mixer fields read by {@linkcode CadenceMixerAdapter}; no optimistic document. */
export interface CadenceMixerState extends Omit<CadenceDescribe,'tracks'> {
  readonly playhead_ticks:number;
  readonly metronome:{readonly enabled:boolean;readonly volume:number};
  readonly tracks:readonly (Omit<CadenceDescribe['tracks'][number],'kind'|'clips'>&{
    readonly kind:TrackKind;readonly output:number|null;readonly sends:readonly {bus:number;level:number}[];
    readonly group:string|null;readonly solo_safe:boolean;readonly inserts:readonly MixerInsert[];
    readonly automation:Readonly<Record<AutomationParam,{readonly mode:AutomationMode;readonly points:readonly {ticks:number;value:number}[]}>>;
    readonly clips:readonly {id:number;start_ticks:number;length_ticks:number;gain_db:number;muted:boolean;notes:readonly {pitch:number;velocity:number;start_ticks:number;length_ticks:number;channel:number}[]}[];
  })[];
}
/** Canonical engine ID accepted by {@linkcode CadenceMixerAdapter} callbacks. */
export type MixerId=string|number;
function id(value:MixerId):number {
  if(typeof value==='string'&&!/^[1-9]\d*$/.test(value))throw new RangeError(`Invalid Cadence id: ${value}`);
  const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new RangeError(`Invalid Cadence id: ${value}`);return n;
}

/**
 * Controlled audio-cluster bindings. Each successful commit returns fresh engine
 * state for the host to publish. Writes through this instance are serialized,
 * including EQ read/modify/write; a rejection does not poison later edits.
 * Transport, output device, polling cadence, selection and analysis target stay
 * host-owned. This adapter neither starts playback nor owns a native resource.
 */
export class CadenceMixerAdapter {
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private readonly doc:CadenceDocument){}
  async read():Promise<CadenceMixerState>{return (await this.doc.describe<CadenceMixerState>()).data;}
  private commit(write:()=>Promise<unknown>):Promise<CadenceMixerState>{
    const result=this.tail.then(async()=>{await write();return this.read();});
    this.tail=result.catch(()=>undefined);return result;
  }
  /** Mixer strip and group intents; one engine command each. */
  mixer(){return {
    onGainCommit:(track:MixerId,gain:number)=>this.commit(()=>this.doc.setTrackGain(id(track),gain)),
    onPanCommit:(track:MixerId,pan:number)=>this.commit(()=>this.doc.setTrackPan(id(track),pan)),
    onMutedCommit:(track:MixerId,muted:boolean)=>this.commit(()=>this.doc.setMuted(id(track),muted)),
    onSoloCommit:(track:MixerId,solo:boolean)=>this.commit(()=>this.doc.setSolo(id(track),solo)),
    onSoloSafeCommit:(track:MixerId,safe:boolean)=>this.commit(()=>this.doc.setSoloSafe(id(track),safe)),
    onGroupSoloCommit:(group:string,solo:boolean)=>this.commit(()=>this.doc.setGroupSolo(group,solo)),
    onGroupMutedCommit:(group:string,muted:boolean)=>this.commit(()=>this.doc.setGroupMuted(group,muted)),
  };}
  /** Bus output and post-fader sends. Buses feed master, never other buses. */
  routing(){return {
    onOutputCommit:(source:MixerId,bus:MixerId|null)=>this.commit(()=>this.doc.setTrackOutput(id(source),bus===null?null:id(bus))),
    onSendCommit:(source:MixerId,bus:MixerId,level:number)=>this.commit(()=>this.doc.setSend(id(source),id(bus),level)),
    onSendRemove:(source:MixerId,bus:MixerId)=>this.commit(()=>this.doc.removeSend(id(source),id(bus))),
  };}
  /** Rack commits for one track; slot IDs are stable across reorder. */
  inserts(track:MixerId){return {
    onAdd:(kind:InsertKind)=>this.commit(()=>this.doc.addInsert(id(track),kind)),
    onRemove:(slot:string)=>this.commit(()=>this.doc.removeInsert(id(slot))),
    onMove:(slot:string,index:number)=>this.commit(()=>this.doc.moveInsert(id(slot),index)),
    onBypassCommit:(slot:string,bypassed:boolean)=>this.commit(()=>this.doc.setInsertBypass(id(slot),bypassed)),
  };}
  /** Factory preset loading/application for a selected insert. */
  presets(slot:MixerId){return {
    load:async(kind:InsertKind)=>(await this.doc.insertPresets(kind)).data.presets,
    onApply:(preset:string)=>this.commit(()=>this.doc.applyInsertPreset(id(slot),preset)),
  };}
  private async eqBands(slot:MixerId):Promise<readonly EqBand[]>{
    const insert=(await this.read()).tracks.flatMap(t=>t.inserts).find(s=>s.id===id(slot));
    if(!insert||insert.kind!=='eq')throw new RangeError('EQ insert is unavailable');return insert.params.bands;
  }
  /** EQ band edits preserve all other bands and parameters from fresh engine state. */
  eq(slot:MixerId){
    const update=(index:number,patch:Partial<EqBand>)=>this.commit(async()=>{
      const bands=await this.eqBands(slot);
      if(!Number.isInteger(index)||index<0||index>=bands.length)throw new RangeError('EQ band index is out of range');
      await this.doc.setInsertParams(id(slot),{bands:bands.map((band,i)=>({...band,...(i===index?patch:{})}))});
    });
    return {
      onBandCommit:(index:number,edit:{freqHz:number;gainDb:number})=>update(index,{freq_hz:edit.freqHz,gain_db:edit.gainDb}),
      onEnabledCommit:(index:number,enabled:boolean)=>update(index,{enabled}),
      loadResponse:async(points=128,sampleRate=48000)=>(await this.doc.eqResponse(id(slot),points,sampleRate)).data.points,
      loadBands:async()=>(await this.eqBands(slot)).map(b=>({type:b.type,freqHz:b.freq_hz,gainDb:b.gain_db,q:b.q,enabled:b.enabled})),
    };
  }
  /** Compressor graph commits and measured transfer curve, without UI-side DSP. */
  dynamics(slot:MixerId){return {
    onThresholdCommit:(thresholdDb:number)=>this.commit(()=>this.doc.setInsertParams(id(slot),{threshold_db:thresholdDb})),
    onRatioCommit:(ratio:number)=>this.commit(()=>this.doc.setInsertParams(id(slot),{ratio})),
    loadCurve:async()=>(await this.doc.dynamicsCurve(id(slot))).data.points.map(p=>({inDb:p.in_db,outDb:p.out_db})),
  };}
  /** One automation lane in absolute project ticks; off/read are supported. */
  automation(track:MixerId,param:AutomationParam){return {
    onPointAdd:(ticks:number,value:number)=>this.commit(()=>this.doc.addAutomationPoint(id(track),param,ticks,value)),
    onPointMove:(index:number,ticks:number,value:number)=>this.commit(()=>this.doc.moveAutomationPoint(id(track),param,index,ticks,value)),
    onPointRemove:(index:number)=>this.commit(()=>this.doc.removeAutomationPoint(id(track),param,index)),
    /** NYC-Tron offers write/touch/latch/trim too; those need a transport host, so they reject. */
    onModeCommit:(mode:string)=>mode==='off'||mode==='read'?this.commit(()=>this.doc.setAutomationMode(id(track),param,mode))
      :Promise.reject(new Error(`Cadence automation supports off and read; ${mode} needs a live transport host.`)),
  };}
  /** Batch velocity is one command/undo step; channel is zero-based 0..15. */
  midi(clip:MixerId){return {
    onVelocitiesCommit:(changes:readonly {index:number;velocity:number}[])=>this.commit(()=>this.doc.setVelocities(id(clip),changes)),
    onNoteChannel:(index:number,channel:number)=>this.commit(()=>this.doc.setNoteChannel(id(clip),index,channel)),
  };}
  /** Enables the engine click; the host still schedules/plays rendered audio. */
  metronome(){return {onMetronomeCommit:(enabled:boolean)=>this.commit(()=>this.doc.setMetronome(enabled))};}
  /** Read-only measurements; results have no document history effects. */
  analysis(range:AnalysisRange){return {
    meter:async(windowMs=50)=>(await this.doc.meter(range,windowMs)).data,
    loudness:async()=>{const r=(await this.doc.loudness(range)).data;return {integratedLufs:r.integrated_lufs,shortTermMaxLufs:r.short_term_max_lufs,momentaryMaxLufs:r.momentary_max_lufs,samplePeakDbfs:r.sample_peak_dbfs,momentaryLufs:r.momentary_lufs,stepSeconds:r.step_seconds};},
    spectrogram:async(options:{fftSize?:number;hop?:number;bands?:number}={})=>{const r=(await this.doc.spectrogram(range,options)).data;return {frames:r.frames,bandsHz:r.bands_hz,hopSeconds:r.hop_seconds};},
  };}
}
/** Committed channels for NYC-Tron's mixer and mix-group controls. */
export function mixerClusterChannels(state:CadenceMixerState){return state.tracks.map(t=>({id:t.id,name:t.name,gain:t.volume,pan:t.pan,muted:t.muted,solo:t.solo,kind:t.kind==='bus'?'bus' as const:'track' as const,...(t.group===null?{}:{group:t.group}),soloSafe:t.solo_safe,output:t.output,sends:t.sends}));}
/** Routing sources and buses, preserving engine ID type. */
export function mixerClusterRoutes(state:CadenceMixerState){return {sources:state.tracks.filter(t=>t.kind!=='bus').map(t=>({id:t.id,name:t.name,output:t.output,sends:t.sends})),buses:state.tracks.filter(t=>t.kind==='bus').map(t=>({id:t.id,name:t.name}))};}
/** Selected track's rack rows, without an invented last-applied preset. */
export function mixerClusterSlots(state:CadenceMixerState,track:MixerId){const t=state.tracks.find(t=>t.id===id(track));if(!t)throw new RangeError('Track is unavailable');return t.inserts.map(s=>({id:String(s.id),kind:s.kind,bypassed:s.bypassed}));}
