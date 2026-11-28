import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {AutomationLane} from "../../../src/audio/AutomationLane.tsx";
import {AutomationModePicker} from "../../../src/audio/AutomationModePicker.tsx";
import type {AutomationMode,AutomationParam,AutomationPoint} from "../../../src/audio/automation.ts";

// Stands in for the Cadence engine: per-lane points and mode, sorted, one
// point per tick; duplicate ticks and out-of-order moves are rejected the
// way the engine rejects them. Each accepted op appends one log line.
type Lane={points:AutomationPoint[];mode:AutomationMode};
type Doc={gain:Lane;pan:Lane;bass:Lane;selected:Record<string,number|undefined>;log:string[];reject:boolean};
const useDoc=create<Doc>(()=>({
  gain:{mode:"read",points:[{ticks:0,value:0.71},{ticks:1920,value:1},{ticks:3840,value:0.5},{ticks:5760,value:0.5}]},
  pan:{mode:"off",points:[]},
  bass:{mode:"off",points:[{ticks:0,value:0.5},{ticks:3840,value:0.25}]},
  selected:{gain:1},log:[],reject:new URLSearchParams(location.search).get("reject")==="1",
}));
type Key="gain"|"pan"|"bass";
const log=(entry:string)=>useDoc.setState(s=>({log:[...s.log,entry]}));
const fmt=(v:number)=>v.toFixed(3);
const setLane=(k:Key,f:(l:Lane)=>Lane)=>useDoc.setState(s=>({[k]:f(s[k])}) as Partial<Doc>);
function ops(k:Key){
  return {
    onPointAdd:(ticks:number,value:number)=>{
      if(useDoc.getState().reject)return Promise.reject(new Error("engine busy"));
      const l=useDoc.getState()[k];
      if(l.points.some(p=>p.ticks===ticks))throw new Error("duplicate tick");
      const points=[...l.points,{ticks,value}].sort((a,b)=>a.ticks-b.ticks);
      setLane(k,x=>({...x,points}));
      useDoc.setState(s=>({selected:{...s.selected,[k]:points.findIndex(p=>p.ticks===ticks)}}));
      log(`add ${k} ${ticks} ${fmt(value)}`);
    },
    onPointMove:(i:number,ticks:number,value:number)=>{
      if(useDoc.getState().reject)return Promise.reject(new Error("engine busy"));
      const p=useDoc.getState()[k].points;
      if((p[i-1]&&ticks<=p[i-1]!.ticks)||(p[i+1]&&ticks>=p[i+1]!.ticks))throw new Error("crossed a neighbour");
      setLane(k,x=>({...x,points:x.points.map((q,j)=>j===i?{ticks,value}:q)}));
      log(`move ${k} ${i} ${ticks} ${fmt(value)}`);
    },
    onPointRemove:(i:number)=>{
      setLane(k,x=>({...x,points:x.points.filter((_,j)=>j!==i)}));
      useDoc.setState(s=>({selected:{...s.selected,[k]:undefined}}));
      log(`remove ${k} ${i}`);
    },
    onSelect:(i:number)=>useDoc.setState(s=>({selected:{...s.selected,[k]:i}})),
  };
}
const modeCommit=(k:Key)=>(mode:AutomationMode)=>{setLane(k,x=>({...x,mode}));log(`mode ${k} ${mode}`);};

function Track({k,param,label,cursorTicks,disabled}:{k:Key;param:AutomationParam;label:string;cursorTicks?:number;disabled?:boolean}){
  const lane=useDoc(s=>s[k]);
  const selected=useDoc(s=>s.selected[k]);
  return <View testID={k} style={{gap:8}}>
    <AutomationModePicker mode={lane.mode} label={label.replace(" automation"," mode")} disabled={disabled} onModeCommit={modeCommit(k)}/>
    <AutomationLane param={param} label={label} points={lane.points} mode={lane.mode} lengthTicks={7680}
      selectedIndex={selected} cursorTicks={cursorTicks} disabled={disabled} {...ops(k)}/>
  </View>;
}

function Fixture(){
  const entries=useDoc(s=>s.log);
  return <ScrollView contentContainerStyle={{padding:16,gap:24,maxWidth:880,width:"100%",alignSelf:"center"}}>
    <Track k="gain" param="gain" label="Vocal volume automation" cursorTicks={960}/>
    <Track k="pan" param="pan" label="Vocal pan automation"/>
    <Track k="bass" param="gain" label="Bass volume automation" disabled/>
    <Text testID="log" {...{className:"text-text-muted"}}>{entries.join("\n")}</Text>
  </ScrollView>;
}
const query=new URLSearchParams(location.search);
document.documentElement.dataset.theme=query.get("theme")??"light";
document.documentElement.dir=query.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("AutomationAcceptance",()=>Root);
AppRegistry.runApplication("AutomationAcceptance",{rootTag:document.getElementById("root")});
