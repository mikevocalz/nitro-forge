import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {EQFrequencyGraph} from "../../../src/audio/EQFrequencyGraph.tsx";
import {DynamicsTransferGraph} from "../../../src/audio/DynamicsTransferGraph.tsx";
import type {EqBand,EqResponsePoint} from "../../../src/audio/eq-graph.ts";
import type {DynamicsCurvePoint,DynamicsParams} from "../../../src/audio/dynamics-graph.ts";

// Stands in for the Cadence engine. The response and curve math below is a
// rough test signal so the fixture has something to draw; the components
// never compute either. Engine answers arrive after ENGINE_MS, so the
// stale-curve dimming is visible between a commit and the new props.
const query=new URLSearchParams(location.search);
const ENGINE_MS=Number(query.get("latency")??120);
const reject=query.get("reject")==="1";

function response(bands:readonly EqBand[]):EqResponsePoint[]{
  return Array.from({length:241},(_,i)=>{
    const hz=20*10**(i/80);
    let db=0;
    for(const b of bands){
      if(!b.enabled)continue;
      const oct=Math.log2(hz/b.freqHz);
      if(b.type==="peak")db+=b.gainDb*Math.exp(-((oct*b.q*1.4)**2));
      else if(b.type==="low_shelf")db+=b.gainDb/(1+Math.exp(oct*4));
      else if(b.type==="high_shelf")db+=b.gainDb/(1+Math.exp(-oct*4));
      else if(b.type==="high_pass")db+=-12*Math.log2(1+2**(-oct*2))/2;
      else db+=-12*Math.log2(1+2**(oct*2))/2;
    }
    return {hz,db};
  });
}
function compressorCurve(p:DynamicsParams):DynamicsCurvePoint[]{
  return Array.from({length:61},(_,i)=>{
    const x=i-60,t=p.thresholdDb,k=p.kneeDb,r=p.ratio;
    let y=x;
    if(2*(x-t)>k)y=t+(x-t)/r;
    else if(k>0&&2*Math.abs(x-t)<=k)y=x+(1/r-1)*(x-t+k/2)**2/(2*k);
    return {inDb:x,outDb:y+p.makeupDb};
  });
}

type Doc={bands:EqBand[];response:EqResponsePoint[];selected:number|undefined;comp:DynamicsParams;curve:DynamicsCurvePoint[];log:string[]};
const initialBands:EqBand[]=[
  {type:"high_pass",freqHz:80,gainDb:0,q:0.71,enabled:true},
  {type:"low_shelf",freqHz:200,gainDb:-3,q:0.7,enabled:true},
  {type:"peak",freqHz:1200,gainDb:3,q:1.2,enabled:true},
  {type:"peak",freqHz:3500,gainDb:-4.5,q:2.5,enabled:false},
  {type:"high_shelf",freqHz:10000,gainDb:2,q:0.7,enabled:true},
];
const comp0:DynamicsParams={thresholdDb:-18,ratio:3,kneeDb:6,makeupDb:0};
const useDoc=create<Doc>(()=>({bands:initialBands,response:response(initialBands),selected:2,comp:comp0,curve:compressorCurve(comp0),log:[]}));
const log=(entry:string)=>useDoc.setState(s=>({log:[...s.log,entry]}));
const engine=<T,>(apply:()=>void):Promise<T|void>=>reject
  ?new Promise((_,no)=>setTimeout(()=>no(new Error("engine refused")),ENGINE_MS))
  :new Promise(ok=>setTimeout(()=>{apply();ok();},ENGINE_MS));
const patchBand=(i:number,patch:Partial<EqBand>)=>engine(()=>useDoc.setState(s=>{
  const bands=s.bands.map((b,j)=>j===i?{...b,...patch}:b);
  return {bands,response:response(bands)};
}));
const patchComp=(patch:Partial<DynamicsParams>)=>engine(()=>useDoc.setState(s=>{
  const comp={...s.comp,...patch};
  return {comp,curve:compressorCurve(comp)};
}));

function Fixture(){
  const d=useDoc();
  return <ScrollView contentContainerStyle={{padding:16,gap:20,maxWidth:880,width:"100%",alignSelf:"center"}}>
    <EQFrequencyGraph testID="eq" label="Vocal EQ" bands={d.bands} response={d.response}
      selectedIndex={d.selected} onSelect={i=>useDoc.setState({selected:i})}
      onBandCommit={(i,e)=>{log("band "+i+" "+e.freqHz+" "+e.gainDb);return patchBand(i,e);}}
      onEnabledCommit={(i,enabled)=>{log("enabled "+i+" "+enabled);return patchBand(i,{enabled});}}/>
    <DynamicsTransferGraph testID="comp" label="Vocal compressor" params={d.comp} curve={d.curve} inputLevelDb={-12}
      onThresholdCommit={t=>{log("threshold "+t);return patchComp({thresholdDb:t});}}
      onRatioCommit={r=>{log("ratio "+r);return patchComp({ratio:r});}}/>
    <EQFrequencyGraph testID="eq-empty" label="Guitar EQ" bands={[{type:"peak",freqHz:500,gainDb:-2,q:1,enabled:true}]}
      response={[]} onBandCommit={()=>{}}/>
    <DynamicsTransferGraph testID="comp-empty" label="Drum bus compressor" params={comp0} curve={[]} disabled
      onThresholdCommit={()=>{}} onRatioCommit={()=>{}}/>
    <Text testID="log" {...{className:"text-text-muted"}}>{d.log.join("\n")}</Text>
  </ScrollView>;
}
document.documentElement.dataset.theme=query.get("theme")??"light";
document.documentElement.dir=query.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("EqDynAcceptance",()=>Root);
AppRegistry.runApplication("EqDynAcceptance",{rootTag:document.getElementById("root")});
