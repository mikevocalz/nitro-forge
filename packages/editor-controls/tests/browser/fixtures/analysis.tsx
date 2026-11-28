import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {LoudnessMeter,type LoudnessStatus} from "../../../src/audio/LoudnessMeter.tsx";
import {SpectrogramView,type SpectrogramStatus} from "../../../src/audio/SpectrogramView.tsx";

// Stands in for the engine: the loudness and spectrogram results below are a
// fixed test signal shaped like a Cadence `loudness` / `spectrogram` reply.
const query=new URLSearchParams(location.search);
const state=query.get("state")??"ready";
type Doc={target:number;status:LoudnessStatus;spectro:SpectrogramStatus;rejectTarget:boolean;log:string[]};
const useDoc=create<Doc>(()=>({
  target:-14,
  status:(state==="ready"?"ready":state) as LoudnessStatus,
  spectro:(state==="silent"?"empty":state==="ready"?"ready":state) as SpectrogramStatus,
  rejectTarget:query.get("reject")==="1",log:[],
}));
const log=(entry:string)=>useDoc.setState(s=>({log:[...s.log,entry]}));

// 32 s of momentary blocks every 0.1 s: a quiet intro, a louder chorus, a gap.
const momentary=Array.from({length:320},(_,i)=>{
  if(i>=250&&i<262)return null;
  const base=i<80?-24:i<200?-12:-16;
  return base+3*Math.sin(i/6)+1.5*Math.cos(i/2.3);
});
// 48 log-spaced bands from 31 Hz, 0.08 s hops over the same 32 s.
const bands=Array.from({length:48},(_,i)=>31.25*Math.pow(2,i/5));
const frames=Array.from({length:400},(_,f)=>bands.map((hz,b)=>{
  const t=f*0.08;
  const kick=(f%12<2)&&hz<150?-4:-120;
  const tone=-20-Math.abs(Math.log2(hz/220))*14+6*Math.sin(t/3);
  const hiss=t>16?-60-b*0.4:-95;
  return Math.max(-120,kick,tone,hiss);
}));

function Fixture(){
  const d=useDoc();
  return <ScrollView contentContainerStyle={{padding:16,gap:20,maxWidth:880,width:"100%",alignSelf:"center"}}>
    <LoudnessMeter testID="loudness" label="Master, bars 1-17" status={d.status}
      integratedLufs={d.status==="ready"?-12.2:null} shortTermMaxLufs={d.status==="ready"?-8.9:null}
      momentaryMaxLufs={d.status==="ready"?-7.4:null} samplePeakDbfs={d.status==="ready"?-0.4:null}
      momentaryLufs={d.status==="ready"?momentary:[]} stepSeconds={0.1} target={d.target}
      error="The mixdown failed because track 3 references a missing file. Relink it, then measure again."
      onRetry={()=>{log("retry");useDoc.setState({status:"ready"});}}
      onTargetChange={lufs=>{
        log("target "+lufs);
        if(useDoc.getState().rejectTarget)return Promise.reject(new Error("rejected"));
        useDoc.setState({target:lufs});
      }}/>
    <SpectrogramView testID="spectrogram" label="Spectrum, bars 1-17" status={d.spectro}
      frames={d.spectro==="ready"?frames:[]} bandsHz={bands} hopSeconds={0.08}
      error="The spectrum could not be computed because the render was cancelled. Run the analysis again."/>
    <Text testID="log" {...{className:"text-text-muted"}}>{d.log.join("\n")}</Text>
  </ScrollView>;
}
document.documentElement.dataset.theme=query.get("theme")??"light";
document.documentElement.dir=query.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("AnalysisAcceptance",()=>Root);
AppRegistry.runApplication("AnalysisAcceptance",{rootTag:document.getElementById("root")});
