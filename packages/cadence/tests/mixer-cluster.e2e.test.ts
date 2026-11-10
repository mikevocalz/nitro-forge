import {afterAll,beforeAll,expect,it} from 'vitest';
import {CliHost} from '@nitro-forge/ignition/cli';
import {CadenceDocument} from '../src/index';
import {CadenceMixerAdapter,mixerClusterChannels,mixerClusterRoutes,mixerClusterSlots} from '../src/mixer-cluster';
let host:CliHost;
beforeAll(()=>{host=new CliHost();});afterAll(async()=>{await host.dispose();});
async function setup(){const doc=await CadenceDocument.open(host);const track=(await doc.addTrack('midi','Keys')).data.track_id;const bus=(await doc.addTrack('bus','Bus')).data.track_id;const clip=(await doc.addClip(track,0,960)).data.clip_id;await doc.addNote(clip,69,0,960,100);await doc.addNote(clip,72,0,960,80);return {doc,track,bus,clip,a:new CadenceMixerAdapter(doc)};}
it('routes, groups and solo-safe callbacks use canonical IDs and authoritative channel fields',async()=>{
 const {doc,a,track,bus}=await setup();try{
 await a.routing().onOutputCommit(String(track),String(bus));await a.routing().onSendCommit(track,bus,0.25);await doc.setTrackGroup(track,'Keys');await a.mixer().onGroupSoloCommit('Keys',true);const s=await a.mixer().onSoloSafeCommit(bus,true);
 expect(mixerClusterChannels(s)).toContainEqual(expect.objectContaining({id:bus,kind:'bus',soloSafe:true}));expect(mixerClusterRoutes(s).sources[0]).toMatchObject({output:bus,sends:[{bus,level:0.25}]});
 const before=await a.read();await expect(a.routing().onOutputCommit(bus,track)).rejects.toThrow();expect(await a.read()).toEqual(before);await expect(a.mixer().onGainCommit('01',0.5)).rejects.toThrow(/Invalid/);await a.mixer().onGainCommit(track,0.5);expect((await a.read()).tracks[0]!.volume).toBe(0.5);
 }finally{await doc.close();}
});
it('rack and preset callbacks preserve slot identity and one-step undo',async()=>{
 const {doc,a,track}=await setup();try{
 const state=await a.inserts(track).onAdd('eq');const slot=mixerClusterSlots(state,track)[0]!;const presets=await a.presets(slot.id).load('eq');expect(presets.length).toBeGreaterThan(0);await a.presets(slot.id).onApply(presets[0]!.id);const before=await a.read();await a.inserts(track).onBypassCommit(slot.id,true);expect(mixerClusterSlots(await a.read(),track)[0]!.bypassed).toBe(true);await doc.undo();expect(await a.read()).toEqual(before);
 await a.inserts(track).onRemove(slot.id);expect(mixerClusterSlots(await a.read(),track)).toEqual([]);
 }finally{await doc.close();}
});
it('queued EQ edits retain neighboring bands and continue after rejection',async()=>{
 const {doc,a,track}=await setup();try{
 const slot=(await doc.addInsert(track,'eq')).data.insert_id;const eq=a.eq(slot);const initial=await eq.loadBands();const before=await a.read();
 await Promise.all([eq.onBandCommit(0,{freqHz:130,gainDb:3}),eq.onEnabledCommit(1,false)]);
 const bands=await eq.loadBands();expect(bands[0]).toMatchObject({freqHz:130,gainDb:3});expect(bands[1]!.enabled).toBe(false);expect(bands[2]).toEqual(initial[2]);await doc.undo();expect((await eq.loadBands())[1]!.enabled).toBe(true);await doc.undo();expect(await a.read()).toEqual(before);
 await expect(eq.onEnabledCommit(99,true)).rejects.toThrow(/index/);await eq.onEnabledCommit(0,false);expect((await eq.loadResponse()).length).toBe(128);
 }finally{await doc.close();}
});
it('automation and batch velocity map one gesture to one history entry; MIDI channels are zero-based',async()=>{
 const {doc,a,track,clip}=await setup();try{
 const lane=a.automation(track,'pan');await lane.onPointAdd(0,-1);await lane.onPointAdd(960,1);await lane.onModeCommit('read');await lane.onPointMove(0,240,-0.5);expect((await a.read()).tracks[0]!.automation.pan.points[0]).toEqual({ticks:240,value:-0.5});
 const before=await a.read();await a.midi(clip).onVelocitiesCommit([{index:0,velocity:20},{index:1,velocity:110}]);expect((await a.read()).tracks[0]!.clips[0]!.notes.map(n=>n.velocity)).toEqual([20,110]);await doc.undo();expect(await a.read()).toEqual(before);await a.midi(clip).onNoteChannel(0,15);expect((await a.read()).tracks[0]!.clips[0]!.notes[0]!.channel).toBe(15);
 }finally{await doc.close();}
});
it('analysis returns measured data and camelCase graph values without consuming undo',async()=>{
 const {doc,a,track}=await setup();try{
 const slot=(await doc.addInsert(track,'compressor')).data.insert_id;await a.dynamics(slot).onThresholdCommit(-24);await a.dynamics(slot).onRatioCommit(4);expect((await a.dynamics(slot).loadCurve())[20]).toEqual(expect.objectContaining({inDb:expect.any(Number),outDb:expect.any(Number)}));const before=await a.read();await a.metronome().onMetronomeCommit(true);const analysis=a.analysis({fromTicks:0,toTicks:960,sampleRate:8000});const loud=await analysis.loudness();expect(loud.integratedLufs).not.toBeNull();expect((await analysis.spectrogram({fftSize:256,hop:128,bands:16})).frames.length).toBeGreaterThan(0);expect((await analysis.meter()).master.max_peak).toBeGreaterThan(0);await doc.undo();expect(await a.read()).toEqual(before);
 }finally{await doc.close();}
});
