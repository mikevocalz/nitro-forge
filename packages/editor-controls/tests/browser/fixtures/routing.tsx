import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {BusAndRoutingMatrix} from "../../../src/audio/BusAndRoutingMatrix.tsx";
import {InsertEffectRack} from "../../../src/audio/InsertEffectRack.tsx";
import {PluginPresetBrowser,type PresetListStatus} from "../../../src/audio/PluginPresetBrowser.tsx";
import type {RoutingBus,RoutingSource,RouteId} from "../../../src/audio/routing.ts";
import type {InsertKind,InsertPreset,InsertSlot} from "../../../src/audio/inserts.ts";

// Query: empty=1 (no tracks, no buses, no inserts), nobus=1, full=1 (8 inserts),
// narrow=1 (matrix in a 360 pt pane), reject=1 (every commit rejects),
// presets=loading|error, disabled=1, theme, dir.
const query=new URLSearchParams(location.search);
const flag=(k:string)=>query.get(k)==="1";
const FACTORY:Record<InsertKind,InsertPreset[]>={
  gain:[{id:"unity",label:"Unity"},{id:"minus-6",label:"Minus 6 dB"},{id:"plus-6",label:"Plus 6 dB"}],
  eq:[{id:"flat",label:"Flat"},{id:"vocal-presence",label:"Vocal presence"},{id:"bass-tighten",label:"Bass tighten"},{id:"telephone",label:"Telephone"}],
  compressor:[{id:"gentle",label:"Gentle"},{id:"vocal-level",label:"Vocal level"},{id:"drum-punch",label:"Drum punch"},{id:"limiter",label:"Limiter"}],
};
const kinds:InsertKind[]=["eq","compressor","gain"];
type Slot=InsertSlot&{preset?:string};
type Doc={sources:RoutingSource[];buses:RoutingBus[];inserts:Slot[];selected:string|undefined;log:string[];next:number};
const useDoc=create<Doc>(()=>({
  sources:flag("empty")?[]:[
    {id:1,name:"Lead vocal",output:null,sends:[{bus:"rev",level:0.35}]},
    {id:2,name:"Drums",output:"drm",sends:[]},
    {id:3,name:"Bass",output:null,sends:[{bus:"rev",level:0.1}]},
  ],
  buses:flag("empty")||flag("nobus")?[]:[{id:"rev",name:"Reverb"},{id:"drm",name:"Drum bus"}],
  inserts:flag("empty")?[]:flag("full")
    ?Array.from({length:8},(_,i)=>({id:"s"+i,kind:kinds[i%3],bypassed:i===4,summary:FACTORY[kinds[i%3]][1].label,preset:FACTORY[kinds[i%3]][1].id}))
    :[{id:"s0",kind:"eq",bypassed:false,summary:"Vocal presence",preset:"vocal-presence"},
      {id:"s1",kind:"compressor",bypassed:true,summary:"Vocal level",preset:"vocal-level"},
      {id:"s2",kind:"gain",bypassed:false}],
  selected:flag("empty")?undefined:"s0",log:[],next:10,
}));
const log=(entry:string)=>useDoc.setState(s=>({log:[...s.log,entry]}));
// The engine stand-in: a reject run logs the attempt and leaves state alone.
const commit=(entry:string,apply:()=>void)=>{
  log(entry);
  // The app reports the failure; the handler attached here keeps it handled.
  if(flag("reject")){const p=Promise.reject(new Error("engine rejected "+entry));p.catch(()=>log("rejected"));return p;}
  apply();return undefined;
};
const patchSource=(id:RouteId,f:(s:RoutingSource)=>RoutingSource)=>useDoc.setState(d=>({sources:d.sources.map(s=>s.id===id?f(s):s)}));

function Fixture(){
  const d=useDoc();
  const disabled=flag("disabled");
  const selected=d.inserts.find(s=>s.id===d.selected);
  const status=(query.get("presets")??"ready") as PresetListStatus;
  return <ScrollView contentContainerStyle={{padding:16,gap:20,maxWidth:880,width:"100%",alignSelf:"center"}}>
    <View style={flag("narrow")?{width:360,alignSelf:"flex-start"}:undefined}>
      <BusAndRoutingMatrix testID="matrix" sources={d.sources} buses={d.buses} disabled={disabled}
        emptyAction={{title:"Add bus",onPress:()=>log("add bus")}}
        onOutputCommit={(id,bus)=>commit("output "+id+" "+bus,()=>patchSource(id,s=>({...s,output:bus})))}
        onSendCommit={(id,bus,level)=>commit("send "+id+" "+bus+" "+level,()=>patchSource(id,s=>({...s,
          sends:s.sends.some(x=>x.bus===bus)?s.sends.map(x=>x.bus===bus?{...x,level}:x):[...s.sends,{bus,level}]})))}
        onSendRemove={(id,bus)=>commit("unsend "+id+" "+bus,()=>patchSource(id,s=>({...s,sends:s.sends.filter(x=>x.bus!==bus)})))}/>
    </View>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:20}}>
      <InsertEffectRack testID="rack" style={{flexGrow:1,flexBasis:340}} label="Lead vocal" inserts={d.inserts}
        selectedId={d.selected} disabled={disabled} onSelect={id=>useDoc.setState({selected:id})}
        onAdd={kind=>commit("add "+kind,()=>useDoc.setState(s=>({inserts:[...s.inserts,{id:"s"+s.next,kind,bypassed:false}],next:s.next+1})))}
        onRemove={id=>commit("remove "+id,()=>useDoc.setState(s=>({inserts:s.inserts.filter(x=>x.id!==id),selected:s.selected===id?undefined:s.selected})))}
        onMove={(id,index)=>commit("move "+id+" "+index,()=>useDoc.setState(s=>{
          const list=s.inserts.filter(x=>x.id!==id);list.splice(index,0,s.inserts.find(x=>x.id===id)!);return {inserts:list};}))}
        onBypassCommit={(id,bypassed)=>commit("bypass "+id+" "+bypassed,()=>useDoc.setState(s=>({inserts:s.inserts.map(x=>x.id===id?{...x,bypassed}:x)})))}/>
      {selected?<PluginPresetBrowser testID="presets" style={{flexGrow:1,flexBasis:300}} kind={selected.kind}
        presets={FACTORY[selected.kind]} currentId={selected.preset} status={status} disabled={disabled}
        onRetry={()=>log("retry")}
        onApply={id=>commit("preset "+selected.id+" "+id,()=>useDoc.setState(s=>({inserts:s.inserts.map(x=>x.id===selected.id
          ?{...x,preset:id,summary:FACTORY[x.kind].find(p=>p.id===id)!.label}:x)})))}/>:null}
    </View>
    <Text testID="log" {...{className:"text-text-muted"}}>{d.log.join("\n")}</Text>
  </ScrollView>;
}
document.documentElement.dataset.theme=query.get("theme")??"light";
document.documentElement.dir=query.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("RoutingAcceptance",()=>Root);
AppRegistry.runApplication("RoutingAcceptance",{rootTag:document.getElementById("root")});
