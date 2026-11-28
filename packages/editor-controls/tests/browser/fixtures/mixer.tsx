import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {MixingConsole} from "../../../src/audio/MixingConsole.tsx";
import {TempoAndMetronome} from "../../../src/audio/TempoAndMetronome.tsx";
import type {MixerChannel} from "../../../src/audio/mixer.ts";
import type {TimeSignature} from "../../../src/audio/tempo.ts";
import {MIDIPianoRoll,PIANO_ROLL_KEY_COLUMN} from "../../../src/midi/MIDIPianoRoll.tsx";
import {MIDIVelocityLane} from "../../../src/midi/MIDIVelocityLane.tsx";
import {StepSequencer} from "../../../src/midi/StepSequencer.tsx";
import type {MidiNote} from "../../../src/midi/note-grid.ts";
import {WaveformLane} from "../../../src/WaveformLane.tsx";
import type {WaveformRange} from "../../../src/waveform.ts";

// Stands in for the engine: commits replace committed state and count, the
// way a Cadence describe() round trip would.
type Doc={
  channels:MixerChannel[];notes:MidiNote[];drums:MidiNote[];selected:number|undefined;
  bpm:number;sig:TimeSignature;click:boolean;scrollX:number;range:WaveformRange;log:string[];
};
const useDoc=create<Doc>(()=>({
  channels:[
    {id:1,name:"Drums",gain:1,pan:0,muted:false,solo:false},
    {id:2,name:"Bass",gain:0.5,pan:-0.3,muted:false,solo:false},
    {id:3,name:"Keys",gain:0.71,pan:0.4,muted:true,solo:false},
    {id:4,name:"Vocal",gain:0.89,pan:0,muted:false,solo:false},
  ],
  notes:[
    {pitch:60,velocity:100,startTicks:0,lengthTicks:480},
    {pitch:64,velocity:80,startTicks:480,lengthTicks:480},
    {pitch:67,velocity:110,startTicks:960,lengthTicks:960},
    {pitch:72,velocity:60,startTicks:1920,lengthTicks:240},
  ],
  drums:[
    {pitch:36,velocity:127,startTicks:0,lengthTicks:240},
    {pitch:42,velocity:96,startTicks:480,lengthTicks:240},
    {pitch:38,velocity:96,startTicks:960,lengthTicks:240},
    {pitch:36,velocity:96,startTicks:1440,lengthTicks:240},
  ],
  selected:0,bpm:120,sig:[4,4],click:false,scrollX:0,range:{start:0,end:0.5},log:[],
}));
const log=(entry:string)=>useDoc.setState(s=>({log:[...s.log,entry]}));
const patchChannel=(id:MixerChannel["id"],f:(c:MixerChannel)=>MixerChannel)=>
  useDoc.setState(s=>({channels:s.channels.map(c=>c.id===id?f(c):c)}));
const patchNote=(key:"notes"|"drums",i:number,f:(n:MidiNote)=>MidiNote)=>
  useDoc.setState(s=>({[key]:s[key].map((n,j)=>j===i?f(n):n)}) as Partial<Doc>);
// Real measured shape would come from decoded audio; this is a fixed test signal.
const peaks=Array.from({length:2000},(_,i)=>{const a=0.15+0.8*Math.abs(Math.sin(i/37)*Math.cos(i/151));return {min:-a,max:a*0.9};});

function Fixture(){
  const d=useDoc();
  return <ScrollView contentContainerStyle={{padding:16,gap:20,maxWidth:880,width:"100%",alignSelf:"center"}}>
    <MixingConsole testID="console" channels={d.channels}
      onGainCommit={(id,gain)=>{patchChannel(id,c=>({...c,gain}));log("gain "+id+" "+gain.toFixed(3));}}
      onPanCommit={(id,pan)=>{patchChannel(id,c=>({...c,pan}));log("pan "+id+" "+pan);}}
      onMutedCommit={(id,muted)=>{patchChannel(id,c=>({...c,muted}));log("mute "+id+" "+muted);}}
      onSoloCommit={(id,solo)=>{patchChannel(id,c=>({...c,solo}));log("solo "+id+" "+solo);}}/>
    <TempoAndMetronome testID="tempo" bpm={d.bpm} timeSignature={d.sig} beat={1}
      metronome={{enabled:d.click,onChange:click=>{useDoc.setState({click});log("click "+click);}}}
      onTempoCommit={bpm=>{useDoc.setState({bpm});log("tempo "+bpm);}}
      onTimeSignatureCommit={sig=>{useDoc.setState({sig});log("sig "+sig.join("/"));}}/>
    <View style={{gap:8}} testID="midi">
      <MIDIPianoRoll notes={d.notes} clipTicks={3840} lowestPitch={55} highestPitch={74} height={308}
        selectedIndex={d.selected} onSelect={i=>useDoc.setState({selected:i})}
        onScrollX={x=>useDoc.setState({scrollX:x})} onAudition={p=>log("audition "+p)}
        onNoteMove={(i,startTicks,pitch)=>{patchNote("notes",i,n=>({...n,startTicks,pitch}));log("move "+i+" "+startTicks+" "+pitch);}}
        onNoteResize={(i,lengthTicks)=>{patchNote("notes",i,n=>({...n,lengthTicks}));log("resize "+i+" "+lengthTicks);}}
        onNoteAdd={(startTicks,lengthTicks,pitch)=>{useDoc.setState(s=>({notes:[...s.notes,{pitch,startTicks,lengthTicks,velocity:100}]}));log("add "+startTicks+" "+pitch);}}
        onNoteRemove={i=>{useDoc.setState(s=>({notes:s.notes.filter((_,j)=>j!==i),selected:undefined}));log("remove "+i);}}/>
      <MIDIVelocityLane notes={d.notes} clipTicks={3840} inset={PIANO_ROLL_KEY_COLUMN} scrollX={d.scrollX}
        selectedIndex={d.selected} onSelect={i=>useDoc.setState({selected:i})}
        onVelocityCommit={(i,velocity)=>{patchNote("notes",i,n=>({...n,velocity}));log("velocity "+i+" "+velocity);}}/>
    </View>
    <StepSequencer testID="steps" notes={d.drums} clipTicks={3840} currentStep={2}
      lanes={[{pitch:36,name:"Kick"},{pitch:38,name:"Snare"},{pitch:42,name:"Hat"}]}
      onStepAdd={(pitch,startTicks,lengthTicks,velocity)=>{useDoc.setState(s=>({drums:[...s.drums,{pitch,startTicks,lengthTicks,velocity}]}));log("step+ "+pitch+" "+startTicks);}}
      onStepRemove={i=>{useDoc.setState(s=>({drums:s.drums.filter((_,j)=>j!==i)}));log("step- "+i);}}
      onStepVelocity={(i,velocity)=>{patchNote("drums",i,n=>({...n,velocity}));log("accent "+i+" "+velocity);}}/>
    <View testID="wave" {...{className:"rounded-card border border-border bg-surface-raised"}} style={{padding:12,gap:8}}>
      <WaveformLane peaks={peaks} height={72} columns={96} visibleRange={d.range} accessibilityLabel="Vocal take"
        onSeekNormalized={p=>log("seek "+p.toFixed(3))}
        onVisibleRangeCommit={range=>{useDoc.setState({range});log("range "+range.start.toFixed(3));}}/>
    </View>
    <Text testID="log" {...{className:"text-text-muted"}}>{d.log.join("\n")}</Text>
  </ScrollView>;
}
const query=new URLSearchParams(location.search);
document.documentElement.dataset.theme=query.get("theme")??"light";
document.documentElement.dir=query.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("MixerAcceptance",()=>Root);
AppRegistry.runApplication("MixerAcceptance",{rootTag:document.getElementById("root")});
