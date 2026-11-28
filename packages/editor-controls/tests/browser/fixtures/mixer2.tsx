import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {MixingConsole} from "../../../src/audio/MixingConsole.tsx";
import {createPeakHold} from "../../../src/audio/meter-ballistics.ts";
import type {MixerChannel} from "../../../src/audio/mixer.ts";

// Stands in for the Cadence engine: commits replace committed state and log,
// the way a describe() round trip would. Group ops change every member in
// one step, like setGroupSolo / setGroupMuted.
type Doc={channels:MixerChannel[];log:string[]};
const useDoc=create<Doc>(()=>({
  channels:[
    {id:1,name:"Kick",gain:0.89,pan:0,muted:false,solo:false,group:"Drums",output:10},
    {id:2,name:"Snare",gain:1,pan:0.1,muted:false,solo:false,group:"Drums",output:10},
    {id:3,name:"Bass",gain:0.71,pan:-0.2,muted:false,solo:false},
    {id:4,name:"Keys",gain:0.5,pan:0.35,muted:true,solo:false,group:"Music"},
    {id:5,name:"Vocal",gain:0.79,pan:0,muted:false,solo:false,group:"Music",sends:[{bus:11,level:0.3}]},
    {id:10,name:"Drum bus",gain:0.79,pan:0,muted:false,solo:false,kind:"bus"},
    {id:11,name:"Reverb",gain:0.5,pan:-0.15,muted:false,solo:false,kind:"bus"},
  ],
  log:[],
}));
const log=(entry:string)=>useDoc.setState(s=>({log:[...s.log,entry]}));
const patch=(pred:(c:MixerChannel)=>boolean,f:(c:MixerChannel)=>MixerChannel)=>
  useDoc.setState(s=>({channels:s.channels.map(c=>pred(c)?f(c):c)}));

// A fixed engine meter read (windowed sample peak per channel), run through
// the real ballistics once. Static: nothing animates on its own.
const engineReads:Record<string,number[]>={"1":[0.5,0.62,0.4],"2":[0.9,0.7,1],"3":[0.3,0.35,0.28],"4":[0,0,0],
  "5":[0.2,0.45,0.33],"10":[0.7,0.84,0.6],"11":[0.1,0.16,0.12]};
const meters=Object.fromEntries(Object.entries(engineReads).map(([id,reads])=>{
  const hold=createPeakHold();let out={level:0,hold:0};
  reads.forEach((p,i)=>{out=hold(p,i*50);});
  return [id,{peak:out.level,hold:out.hold}];
}));

const query=new URLSearchParams(location.search);
const showMeters=query.get("meters")!=="0";

function Fixture(){
  const d=useDoc();
  return <ScrollView contentContainerStyle={{padding:16,gap:20,maxWidth:1100,width:"100%",alignSelf:"center"}}>
    <MixingConsole testID="console" channels={d.channels} meters={showMeters?meters:undefined}
      onGainCommit={(id,gain)=>{patch(c=>c.id===id,c=>({...c,gain}));log("gain "+id+" "+gain.toFixed(3));}}
      onPanCommit={(id,pan)=>{patch(c=>c.id===id,c=>({...c,pan}));log("pan "+id+" "+pan);}}
      onMutedCommit={(id,muted)=>{patch(c=>c.id===id,c=>({...c,muted}));log("mute "+id+" "+muted);}}
      onSoloCommit={(id,solo)=>{patch(c=>c.id===id,c=>({...c,solo}));log("solo "+id+" "+solo);}}
      onSoloSafeCommit={(id,soloSafe)=>{patch(c=>c.id===id,c=>({...c,soloSafe}));log("safe "+id+" "+soloSafe);}}
      onGroupSoloCommit={(group,solo)=>{patch(c=>c.group===group,c=>({...c,solo}));log("gsolo "+group+" "+solo);}}
      onGroupMutedCommit={(group,muted)=>{patch(c=>c.group===group,c=>({...c,muted}));log("gmute "+group+" "+muted);}}/>
    <Text testID="log" {...{className:"text-text-muted"}}>{d.log.join("\n")}</Text>
  </ScrollView>;
}
document.documentElement.dataset.theme=query.get("theme")??"light";
document.documentElement.dir=query.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("Mixer2Acceptance",()=>Root);
AppRegistry.runApplication("Mixer2Acceptance",{rootTag:document.getElementById("root")});
