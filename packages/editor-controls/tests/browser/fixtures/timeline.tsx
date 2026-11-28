import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {FRAME_RATES} from "../../../src/timebase.ts";
import {TimecodeDisplay} from "../../../src/timeline/TimecodeDisplay.tsx";
import {TransportControls} from "../../../src/timeline/TransportControls.tsx";
import {PlaybackRateMenu} from "../../../src/timeline/PlaybackRateMenu.tsx";
import {SeekBar} from "../../../src/timeline/SeekBar.tsx";
import {TimelineRuler} from "../../../src/timeline/TimelineRuler.tsx";
import {TimelinePlayhead} from "../../../src/timeline/TimelinePlayhead.tsx";
import {InOutRangeHandles} from "../../../src/timeline/InOutRangeHandles.tsx";
import {TimelineZoomAndScroll} from "../../../src/timeline/TimelineZoomAndScroll.tsx";
import {TimelineClipLane,type TimelineTool} from "../../../src/timeline/TimelineClipLane.tsx";
import {RazorSplitTool} from "../../../src/timeline/RazorSplitTool.tsx";
import {SafeAreaOverlay} from "../../../src/timeline/SafeAreaOverlay.tsx";
import {FRAME_GUIDES} from "../../../src/timeline/safe-area.ts";
import {secondsToFrame,type TimeFormat} from "../../../src/timeline/time.ts";
import {defaultPxPerFrame} from "../../../src/timeline/ruler.ts";
import {
  clipEnd,markedRange,timelineDuration,type InOutRange,type TimelineEdit,type TimelineTrack,
} from "../../../src/timeline/edits.ts";
import {clampViewport,type TimelineViewport} from "../../../src/timeline/viewport.ts";

const params=new URLSearchParams(location.search);
const rate=params.get("rate")==="ntsc"?FRAME_RATES.NTSC_2997:FRAME_RATES.FILM_24;
const fps=rate.numerator/rate.denominator;

/*
 * Test stand-in for a Forge adapter over Splice: clips are stored in seconds,
 * and each TimelineEdit is applied as the engine ops it maps to (moveClip,
 * trimClip, splitClip), in the order the edit names, with Splice's overlap
 * rule. A rejected op throws, as the engine would.
 */
type EngineClip={id:number;track:number;start_s:number;in_s:number;out_s:number;speed:number;name:string;source_s:number};
const engine={
  tracks:[{id:1,kind:"video" as const,name:"Video 1"},{id:2,kind:"audio" as const,name:"Audio 1"}],
  clips:[
    {id:11,track:1,start_s:0,in_s:0,out_s:4,speed:1,name:"Harbor wide",source_s:12},
    {id:12,track:1,start_s:5,in_s:2,out_s:8,speed:1,name:"Ferry close-up",source_s:10},
    {id:13,track:1,start_s:12,in_s:0,out_s:6,speed:2,name:"Gulls, 2x",source_s:8},
    {id:21,track:2,start_s:0,in_s:0,out_s:14,speed:1,name:"Ambience",source_s:30},
  ] as EngineClip[],
  nextId:30,ops:[] as string[],
  len:(c:EngineClip)=>(c.out_s-c.in_s)/c.speed,
  overlaps(track:number,start:number,len:number,except:number){
    return engine.clips.some(c=>c.track===track&&c.id!==except&&start<c.start_s+engine.len(c)-1e-9&&start+len>c.start_s+1e-9);
  },
  moveClip(id:number,start_s:number){
    const c=engine.clips.find(x=>x.id===id)!;
    if(engine.overlaps(c.track,start_s,engine.len(c),id))throw new Error("move would overlap");
    c.start_s=start_s;engine.ops.push("moveClip");
  },
  trimClip(id:number,in_s:number,out_s:number){
    const c=engine.clips.find(x=>x.id===id)!;
    if(engine.overlaps(c.track,c.start_s,(out_s-in_s)/c.speed,id))throw new Error("trim would overlap");
    c.in_s=in_s;c.out_s=out_s;engine.ops.push("trimClip");
  },
  splitClip(id:number,at_s:number){
    const c=engine.clips.find(x=>x.id===id)!;
    const media=c.in_s+(at_s-c.start_s)*c.speed;
    engine.clips.push({...c,id:engine.nextId++,start_s:at_s,in_s:media});
    c.out_s=media;engine.ops.push("splitClip");
  },
};
const read=():TimelineTrack[]=>engine.tracks.map(t=>({id:String(t.id),kind:t.kind,label:t.name,
  clips:engine.clips.filter(c=>c.track===t.id).sort((a,b)=>a.start_s-b.start_s).map(c=>({
    id:String(c.id),label:c.name,speed:c.speed,
    startFrame:secondsToFrame(c.start_s,rate),
    sourceIn:c.in_s*fps,sourceOut:c.out_s*fps,sourceDuration:c.source_s*fps,
  }))}));
function apply(edit:TimelineEdit){
  const id=Number(edit.clipId);
  if(edit.kind==="move")engine.moveClip(id,edit.startSeconds);
  else if(edit.kind==="split")engine.splitClip(id,edit.atSeconds);
  else if(edit.kind!=="trim")throw new Error(edit.kind+" is not wired in this fixture");
  else if(edit.order==="trim-only")engine.trimClip(id,edit.inSeconds,edit.outSeconds);
  else if(edit.order==="trim-then-move"){engine.trimClip(id,edit.inSeconds,edit.outSeconds);engine.moveClip(id,edit.startSeconds);}
  else{engine.moveClip(id,edit.startSeconds);engine.trimClip(id,edit.inSeconds,edit.outSeconds);}
}

type Host={
  tracks:TimelineTrack[];frame:number;scrub:number|undefined;playing:boolean;speed:number;pitch:boolean;
  format:TimeFormat;range:InOutRange;selected:string|undefined;tool:TimelineTool;viewport:TimelineViewport;
  commits:number;last:string;
};
const initialTracks=read();
const useHost=create<Host>(()=>({
  tracks:initialTracks,frame:Number(params.get("frame")??30),scrub:undefined,playing:false,speed:1,pitch:true,
  format:"timecode",range:{},selected:params.get("select")??undefined,tool:"select",
  viewport:{startFrame:0,pxPerFrame:4,widthPx:0},commits:0,last:"none",
}));
const commit=(edit:TimelineEdit)=>{
  try{apply(edit);useHost.setState(s=>({tracks:read(),commits:s.commits+1,last:edit.kind+" "+engine.ops.slice(-2).join("+")}));}
  catch(e){useHost.setState({last:"rejected "+(e as Error).message});}
};

function Fixture(){
  const s=useHost();
  const duration=timelineDuration(s.tracks);
  const shown=s.scrub??s.frame;
  const selectedClip=s.tracks.flatMap(t=>t.clips).find(c=>c.id===s.selected);
  const selection=selectedClip?{start:selectedClip.startFrame,end:Math.ceil(clipEnd(selectedClip))}
    :s.range.inFrame!==undefined||s.range.outFrame!==undefined?markedRange(s.range,duration):undefined;
  const seek=(frame:number)=>useHost.setState(h=>({frame,scrub:undefined,commits:h.commits+1,last:"seek "+frame}));
  const scrub=(frame:number)=>useHost.setState({scrub:frame});
  const setViewport=(viewport:TimelineViewport)=>useHost.setState({viewport});
  const timelineHeight=44+56*s.tracks.length;
  return <ScrollView contentContainerStyle={{padding:16,gap:14,maxWidth:1100,width:"100%",alignSelf:"center"}}>
    <View {...{className:"rounded-card border border-border bg-surface-sunken"}} style={{aspectRatio:16/9,maxWidth:640,width:"100%",alignSelf:"center",overflow:"hidden"}}>
      <Text {...{className:"text-text-muted"}} style={{position:"absolute",left:0,right:0,top:"46%",textAlign:"center"}}>Program monitor</Text>
      <SafeAreaOverlay aspect={16/9} guide={params.get("guide")==="scope"?FRAME_GUIDES.scope:undefined} showThirds showCenter testID="safe"/>
    </View>
    <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:10}}>
      <TransportControls testID="transport" playing={s.playing} frame={s.frame} durationFrames={duration}
        onPlayPause={()=>useHost.setState(h=>({playing:!h.playing}))} onStop={()=>useHost.setState({playing:false,frame:0})} onSeek={seek}/>
      <TimecodeDisplay testID="tc" frame={shown} rate={rate} format={s.format} sampleRate={48000}
        dropFrame={params.get("rate")==="ntsc"}
        onFormatChange={format=>useHost.setState({format})} onCommit={seek} durationFrames={duration}/>
      <PlaybackRateMenu testID="rate" rate={s.speed} onRateChange={speed=>useHost.setState({speed})} supportsReverse
        preservePitch={s.pitch} onPreservePitchChange={pitch=>useHost.setState({pitch})}/>
    </View>
    <SeekBar testID="seek" frame={shown} durationFrames={duration} rate={rate} buffered={[{start:0,end:Math.round(duration*0.6)}]}
      onScrub={scrub} onSeek={seek}/>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:12,alignItems:"flex-start"}}>
      <RazorSplitTool testID="razor" tool={s.tool} onToolChange={tool=>useHost.setState({tool})} tracks={s.tracks}
        selectedClipId={s.selected} playheadFrame={s.frame} rate={rate} onEdit={commit}/>
    </View>
    <View {...{className:"rounded-card border border-border bg-surface-raised"}} style={{padding:12,gap:10}}
      onLayout={e=>{
        const w=e.nativeEvent.layout.width-24;
        useHost.setState(h=>({viewport:clampViewport({...h.viewport,widthPx:w,pxPerFrame:h.viewport.widthPx?h.viewport.pxPerFrame:defaultPxPerFrame(w,rate)*2},duration)}));
      }}>
      {s.viewport.widthPx>0?<>
        <TimelineZoomAndScroll testID="zoom" viewport={s.viewport} onViewportChange={setViewport} durationFrames={duration}
          rate={rate} playheadFrame={s.frame} selection={selection}/>
        <InOutRangeHandles testID="inout" viewport={s.viewport} range={s.range} durationFrames={duration} rate={rate}
          playheadFrame={s.frame} onCommit={range=>useHost.setState(h=>({range,commits:h.commits+1,last:"range"}))}/>
        <View style={{height:timelineHeight}}>
          <TimelineRuler testID="ruler" viewport={s.viewport} rate={rate} durationFrames={duration} frame={s.frame}
            marks={[{frame:Math.round(5*fps),label:"Ferry"}]} onScrub={scrub} onSeek={seek}/>
          <TimelineClipLane testID="lanes" tracks={s.tracks} viewport={s.viewport} onViewportChange={setViewport} rate={rate}
            durationFrames={duration} playheadFrame={s.frame} selectedClipId={s.selected} tool={s.tool}
            onSelect={selected=>useHost.setState({selected})} onEdit={commit}/>
          <TimelinePlayhead testID="playhead" viewport={s.viewport} frame={shown} durationFrames={duration} rate={rate}
            height={timelineHeight} onScrub={scrub} onSeek={seek}/>
        </View>
      </>:null}
    </View>
    <View style={{gap:4}}>
      <Text testID="frame" {...{className:"text-text-muted"}}>{"frame "+s.frame}</Text>
      <Text testID="commits" {...{className:"text-text-muted"}}>{"commits "+s.commits}</Text>
      <Text testID="last" {...{className:"text-text-muted"}}>{"last "+s.last}</Text>
      <Text testID="clips" {...{className:"text-text-muted"}}>{"clips "+s.tracks[0]!.clips.map(c=>`${c.id}@${c.startFrame}+${Math.round(clipEnd(c)-c.startFrame)}`).join(" ")}</Text>
      <Text testID="view" {...{className:"text-text-muted"}}>{`view ${Math.round(s.viewport.startFrame)} ${s.viewport.pxPerFrame.toFixed(2)}`}</Text>
      <Text testID="speed" {...{className:"text-text-muted"}}>{`speed ${s.speed} pitch ${s.pitch}`}</Text>
    </View>
  </ScrollView>;
}
document.documentElement.dataset.theme=params.get("theme")??"light";
if(params.get("dir")==="rtl")document.documentElement.dir="rtl";
AppRegistry.registerComponent("TimelineAcceptance",()=>Fixture);
AppRegistry.runApplication("TimelineAcceptance",{rootTag:document.getElementById("root")});
