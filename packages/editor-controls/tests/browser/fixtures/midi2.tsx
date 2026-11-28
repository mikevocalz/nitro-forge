import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {MIDIPianoRoll,PIANO_ROLL_KEY_COLUMN} from "../../../src/midi/MIDIPianoRoll.tsx";
import {MIDIVelocityLane,type VelocityTool} from "../../../src/midi/MIDIVelocityLane.tsx";
import {MidiChannelPicker} from "../../../src/midi/MidiChannelPicker.tsx";
import type {MidiNote} from "../../../src/midi/note-grid.ts";
import type {VelocityChange} from "../../../src/midi/velocity-line.ts";

const query=new URLSearchParams(location.search);
// ?reject=1 makes batch commits fail the way a rejected engine op would.
const reject=query.get("reject")==="1";

// Stands in for the Cadence engine: setVelocities is all-or-nothing and
// rejects a duplicate index; setNoteChannel replaces one note's channel.
type Doc={notes:MidiNote[];selected:number|undefined;tool:VelocityTool;scrollX:number;log:string[]};
const useDoc=create<Doc>(()=>({
  notes:[
    {pitch:60,velocity:100,startTicks:0,lengthTicks:480,channel:0},
    {pitch:64,velocity:80,startTicks:480,lengthTicks:480,channel:0},
    {pitch:67,velocity:110,startTicks:960,lengthTicks:480,channel:0},
    {pitch:72,velocity:60,startTicks:1440,lengthTicks:480,channel:0},
    {pitch:62,velocity:90,startTicks:1920,lengthTicks:480,channel:9},
    {pitch:65,velocity:70,startTicks:2400,lengthTicks:480,channel:9},
  ],
  selected:undefined,tool:"line",scrollX:0,log:[],
}));
const log=(entry:string)=>useDoc.setState(s=>({log:[...s.log,entry]}));
function setVelocities(changes:readonly VelocityChange[]):Promise<void>{
  if(reject){log("rejected "+changes.length);return Promise.reject(new Error("Engine refused the batch"));}
  if(new Set(changes.map(c=>c.index)).size!==changes.length)return Promise.reject(new Error("Duplicate index"));
  const by=new Map(changes.map(c=>[c.index,c.velocity]));
  useDoc.setState(s=>({notes:s.notes.map((n,i)=>by.has(i)?{...n,velocity:by.get(i)!}:n)}));
  log("velocities "+changes.map(c=>c.index+":"+c.velocity).join(","));
  return Promise.resolve();
}
// A rejected commit leaves the doc as it was; the log above already shows the attempt.
const swallow=(p:Promise<void>)=>p.catch(()=>undefined);

function Fixture(){
  const d=useDoc();
  return <ScrollView contentContainerStyle={{padding:16,gap:20,maxWidth:880,width:"100%",alignSelf:"center"}}>
    <View style={{gap:8}} testID="midi">
      <MIDIPianoRoll notes={d.notes} clipTicks={3840} lowestPitch={58} highestPitch={74} height={264}
        selectedIndex={d.selected} onSelect={i=>useDoc.setState({selected:i})}
        onScrollX={x=>useDoc.setState({scrollX:x})}
        onNoteMove={(i,startTicks,pitch)=>{useDoc.setState(s=>({notes:s.notes.map((n,j)=>j===i?{...n,startTicks,pitch}:n)}));log("move "+i);}}
        onNoteResize={(i,lengthTicks)=>{useDoc.setState(s=>({notes:s.notes.map((n,j)=>j===i?{...n,lengthTicks}:n)}));log("resize "+i);}}
        onNoteChannel={(i,channel)=>{useDoc.setState(s=>({notes:s.notes.map((n,j)=>j===i?{...n,channel}:n)}));log("channel "+i+" "+channel);}}/>
      <MIDIVelocityLane testID="lane" notes={d.notes} clipTicks={3840} inset={PIANO_ROLL_KEY_COLUMN} scrollX={d.scrollX}
        selectedIndex={d.selected} onSelect={i=>useDoc.setState({selected:i})}
        tool={d.tool} onToolChange={tool=>{useDoc.setState({tool});log("tool "+tool);}}
        onVelocityCommit={(i,velocity)=>{useDoc.setState(s=>({notes:s.notes.map((n,j)=>j===i?{...n,velocity}:n)}));log("velocity "+i+" "+velocity);}}
        onVelocitiesCommit={changes=>swallow(setVelocities(changes))}/>
    </View>
    <View testID="states" style={{gap:12}}>
      <MIDIVelocityLane testID="empty-lane" label="Empty clip velocity" notes={[]} clipTicks={3840} inset={PIANO_ROLL_KEY_COLUMN}
        height={64} tool="line" onVelocityCommit={()=>log("never")} onVelocitiesCommit={()=>log("never")}/>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:16,alignItems:"center"}}>
        <MidiChannelPicker testID="picker-off" label="Locked channel" channel={3} disabled onChannelCommit={()=>log("never")}/>
      </View>
    </View>
    <Text testID="log" {...{className:"text-text-muted"}}>{d.log.join("\n")}</Text>
  </ScrollView>;
}
document.documentElement.dataset.theme=query.get("theme")??"light";
document.documentElement.dir=query.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("Midi2Acceptance",()=>Root);
AppRegistry.runApplication("Midi2Acceptance",{rootTag:document.getElementById("root")});
