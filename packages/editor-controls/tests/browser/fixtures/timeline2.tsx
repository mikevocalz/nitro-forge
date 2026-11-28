import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {FRAME_RATES} from "../../../src/timebase.ts";
import {secondsToFrame} from "../../../src/timeline/time.ts";
import {defaultPxPerFrame} from "../../../src/timeline/ruler.ts";
import {clampViewport,type TimelineViewport} from "../../../src/timeline/viewport.ts";
import {timelineDuration,type InOutRange,type MoveMode,type RippleScope,type TimelineEdit,type TimelineTrack,type TrackKind} from "../../../src/timeline/edits.ts";
import {TimelineRuler} from "../../../src/timeline/TimelineRuler.tsx";
import {TimelinePlayhead} from "../../../src/timeline/TimelinePlayhead.tsx";
import {InOutRangeHandles} from "../../../src/timeline/InOutRangeHandles.tsx";
import type {TimelineTool} from "../../../src/timeline/TimelineClipLane.tsx";
import {JKLShuttleController} from "../../../src/timeline/JKLShuttleController.tsx";
import {LoopRangeBar} from "../../../src/timeline/LoopRangeBar.tsx";
import type {LoopRange} from "../../../src/timeline/loop-range.ts";
import {RollSlipSlideControls} from "../../../src/timeline/RollSlipSlideControls.tsx";
import {DragReorderAndRipple} from "../../../src/timeline/DragReorderAndRipple.tsx";
import {TransitionHandles} from "../../../src/timeline/TransitionHandles.tsx";
import {clipsOfCut,maxTransitionFrames,transitionAt,transitionTarget,type TimelineCut,type TimelineTransition} from "../../../src/timeline/transitions.ts";
import {TimelineMarkers} from "../../../src/timeline/TimelineMarkers.tsx";
import {nextMarkerName,type TimelineMarker} from "../../../src/timeline/markers.ts";
import {OverlayAndEffectsTrackStack} from "../../../src/timeline/OverlayAndEffectsTrackStack.tsx";
import {stackOrder} from "../../../src/timeline/track-stack.ts";
import {TransitionPresetBrowser} from "../../../src/timeline/TransitionPresetBrowser.tsx";
import {BatchEditPanel} from "../../../src/timeline/BatchEditPanel.tsx";
import type {BatchEdit} from "../../../src/timeline/batch.ts";

const params=new URLSearchParams(location.search);
const rate=FRAME_RATES.FILM_24;
const fps=24;
const EPS=1e-9;

/*
 * Test stand-in for Splice. Clips, markers, the loop and transitions are
 * stored in seconds, and each callback is applied as the engine op it maps to
 * (names in `ops`), with the engine's validation: a rejected op throws and
 * changes nothing. `batch` runs a list on a copy and keeps it only if every op
 * succeeds, which is the one-undo-step contract.
 */
type Clip={id:number;start:number;in:number;out:number;speed:number;name:string;dur:number};
type Track={id:number;kind:TrackKind;name:string;locked:boolean;hidden:boolean;muted:boolean;solo:boolean;clips:Clip[]};
type Trans={id:number;track:number;left:number;right:number;kind:string;d:number};
type Doc={tracks:Track[];trans:Trans[];markers:{id:number;t:number;d:number;name:string;note:string}[];loop?:{in:number;out:number};next:number};
const len=(c:Clip)=>(c.out-c.in)/c.speed;
const end=(c:Clip)=>c.start+len(c);
const mk=(id:number,start:number,inS:number,out:number,name:string,dur=20,speed=1):Clip=>({id,start,in:inS,out,speed,name,dur});
let doc:Doc={
  tracks:[
    {id:1,kind:"overlay",name:"Titles",locked:false,hidden:false,muted:false,solo:false,clips:[mk(11,1,0,3,"Lower third",6)]},
    {id:2,kind:"video",name:"Video 1",locked:false,hidden:false,muted:false,solo:false,
      clips:[mk(21,0,2,6,"Harbor wide"),mk(22,4,3,8,"Ferry close-up"),mk(23,9,0,3,"Gulls",8),mk(24,14,1,4,"Pier")]},
    {id:3,kind:"audio",name:"Music",locked:false,hidden:false,muted:false,solo:false,clips:[mk(31,0,0,12,"Score",60)]},
    {id:4,kind:"audio",name:"Ambience",locked:params.get("locked")==="1",hidden:false,muted:false,solo:false,clips:[mk(41,2,0,8,"Wind",30)]},
  ],
  trans:params.get("trans")==="1"?[{id:51,track:2,left:21,right:22,kind:"cross_dissolve",d:0.5}]:[],
  markers:[{id:61,t:4,d:0,name:"Ferry arrives",note:""},{id:62,t:9,d:2,name:"Gulls",note:"Hold on the birds"}],
  loop:params.get("loop")==="1"?{in:2,out:6}:undefined,
  next:100,
};
const respondMarker=(update:()=>void)=>params.has("markerDelay")?setTimeout(update,250):update();
const ops:string[]=[];
const clone=(d:Doc):Doc=>JSON.parse(JSON.stringify(d));
const loc=(d:Doc,id:number)=>{for(const t of d.tracks){const c=t.clips.find(x=>x.id===id);if(c)return {t,c};}throw new Error("no clip "+id);};
const sort=(t:Track)=>t.clips.sort((a,b)=>a.start-b.start);
const unlocked=(t:Track)=>{if(t.locked)throw new Error("track "+t.name+" is locked");};
function check(d:Doc){
  for(const t of d.tracks){
    sort(t);
    for(const c of t.clips){
      if(c.start<-EPS)throw new Error("clip before 0");
      if(c.in<-EPS||c.out>c.dur+EPS||c.out-c.in<EPS)throw new Error("out of media");
    }
    for(let i=1;i<t.clips.length;i++)if(t.clips[i]!.start<end(t.clips[i-1]!)-EPS)throw new Error("overlap on "+t.name);
  }
  // The engine drops transitions whose clips no longer touch or lack handles.
  d.trans=d.trans.filter(x=>{
    const t=d.tracks.find(t=>t.id===x.track);const l=t?.clips.find(c=>c.id===x.left),r=t?.clips.find(c=>c.id===x.right);
    return !!l&&!!r&&Math.abs(end(l)-r.start)<EPS&&l.out+x.d/2*l.speed<=l.dur+EPS&&r.in-x.d/2*r.speed>=-EPS&&x.d/2<=len(l)+EPS&&x.d/2<=len(r)+EPS;
  });
}
function splitAt(t:Track,c:Clip,at:number,d:Doc){
  const m=c.in+(at-c.start)*c.speed;
  const right={...c,id:d.next++,start:at,in:m};c.out=m;t.clips.push(right);
  for(const x of d.trans)if(x.left===c.id)x.left=right.id;
}
function shiftAfter(d:Doc,t:Track,from:number,delta:number,scope:RippleScope,except:number){
  for(const u of scope==="all"?d.tracks.filter(x=>x.id===t.id||!x.locked):[t])
    for(const c of u.clips)if(c.id!==except&&c.start>=from-EPS)c.start+=delta;
}
const engine={
  moveClip(d:Doc,id:number,start:number,track?:number,mode?:MoveMode,scope:RippleScope="track"){
    const {t,c}=loc(d,id);unlocked(t);
    const target=track===undefined?t:d.tracks.find(x=>x.id===track)!;unlocked(target);
    t.clips=t.clips.filter(x=>x!==c);
    const L=len(c),e=start+L;
    if(mode==="overwrite"){
      for(const o of [...target.clips]){
        if(end(o)<=start+EPS||o.start>=e-EPS)continue;
        if(o.start>=start-EPS&&end(o)<=e+EPS)target.clips=target.clips.filter(x=>x!==o);
        else if(o.start<start&&end(o)>e){splitAt(target,o,start,d);const r=target.clips.at(-1)!;r.in+= (e-start)*r.speed;r.start=e;}
        else if(o.start<start)o.out=o.in+(start-o.start)*o.speed;
        else{o.in+=(e-o.start)*o.speed;o.start=e;}
      }
    }else if(mode==="insert"){
      for(const u of scope==="all"?d.tracks.filter(x=>x.id===target.id||!x.locked):[target])
        for(const o of [...u.clips])if(o.start<start-EPS&&end(o)>start+EPS)splitAt(u,o,start,d);
      shiftAfter(d,target,start,L,scope,-1);
    }
    c.start=start;target.clips.push(c);
  },
  slipClip(d:Doc,id:number,delta:number){const {t,c}=loc(d,id);unlocked(t);c.in+=delta;c.out+=delta;},
  slideClip(d:Doc,id:number,delta:number){
    const {t,c}=loc(d,id);unlocked(t);
    const p=t.clips.find(x=>x!==c&&Math.abs(end(x)-c.start)<EPS),n=t.clips.find(x=>x!==c&&Math.abs(x.start-end(c))<EPS);
    if(p)p.out+=delta*p.speed;
    if(n){n.in+=delta*n.speed;n.start+=delta;}
    c.start+=delta;
  },
  rollEdit(d:Doc,l:number,r:number,delta:number){
    const a=loc(d,l),b=loc(d,r);unlocked(a.t);
    if(a.t!==b.t||Math.abs(end(a.c)-b.c.start)>EPS)throw new Error("clips do not touch");
    a.c.out+=delta*a.c.speed;b.c.in+=delta*b.c.speed;b.c.start+=delta;
  },
  rippleTrim(d:Doc,id:number,edge:"head"|"tail",delta:number,scope:RippleScope){
    const {t,c}=loc(d,id);unlocked(t);const old=end(c);
    if(edge==="tail")c.out+=delta*c.speed;else c.in+=delta*c.speed;
    shiftAfter(d,t,old,edge==="tail"?delta:-delta,scope,id);
  },
  rippleDelete(d:Doc,id:number,scope:RippleScope){
    const {t,c}=loc(d,id);unlocked(t);t.clips=t.clips.filter(x=>x!==c);shiftAfter(d,t,end(c),-len(c),scope,id);
  },
  removeClip(d:Doc,id:number){const {t,c}=loc(d,id);unlocked(t);t.clips=t.clips.filter(x=>x!==c);},
  setSpeed(d:Doc,id:number,speed:number){const {t,c}=loc(d,id);unlocked(t);if(speed<0.1||speed>10)throw new Error("speed");c.speed=speed;},
};
function run(name:string,f:(d:Doc)=>void){
  const next=clone(doc);
  f(next);check(next);
  doc=next;ops.push(name);
}

const fr=(s:number)=>secondsToFrame(Math.max(0,s),rate);
const read=():TimelineTrack[]=>doc.tracks.map(t=>({id:String(t.id),kind:t.kind,label:t.name,locked:t.locked,hidden:t.hidden,muted:t.muted,solo:t.solo,
  clips:[...t.clips].sort((a,b)=>a.start-b.start).map(c=>({id:String(c.id),label:c.name,speed:c.speed,startFrame:fr(c.start),
    sourceIn:c.in*fps,sourceOut:c.out*fps,sourceDuration:c.dur*fps}))}));
const readTrans=():TimelineTransition[]=>doc.trans.map(x=>({id:String(x.id),trackId:String(x.track),leftClipId:String(x.left),rightClipId:String(x.right),kind:x.kind,durationFrames:fr(x.d)}));
const readMarkers=():TimelineMarker[]=>doc.markers.map(m=>({id:String(m.id),frame:fr(m.t),...(m.d?{durationFrames:fr(m.d)}:{}),name:m.name,...(m.note?{note:m.note}:{})}));
const readLoop=():LoopRange|undefined=>doc.loop?{inFrame:fr(doc.loop.in),outFrame:fr(doc.loop.out)}:undefined;

type Host={
  tracks:TimelineTrack[];transitions:TimelineTransition[];markers:TimelineMarker[];loop:LoopRange|undefined;looping:boolean;
  frame:number;shuttle:number;steps:number;range:InOutRange;selected:string|undefined;multi:string[];tool:TimelineTool;
  moveMode:MoveMode|undefined;scope:RippleScope;cut:TimelineCut|undefined;transitionId:string|undefined;marker:string|undefined;
  viewport:TimelineViewport;commits:number;last:string;cutTargets:boolean;
};
const useHost=create<Host>(()=>({
  tracks:read(),transitions:readTrans(),markers:readMarkers(),loop:readLoop(),looping:false,
  frame:Number(params.get("frame")??96),shuttle:0,steps:0,range:{},selected:params.get("select")??undefined,
  multi:(params.get("multi")??"").split(",").filter(Boolean),tool:(params.get("tool") as TimelineTool)??"select",
  moveMode:(params.get("mode") as MoveMode)??undefined,scope:"track",cut:undefined,transitionId:undefined,marker:undefined,
  viewport:{startFrame:0,pxPerFrame:4,widthPx:0},commits:0,last:"none",cutTargets:params.get("cuts")!=="0",
}));
const refresh=(label:string)=>useHost.setState(s=>({tracks:read(),transitions:readTrans(),markers:readMarkers(),loop:readLoop(),
  commits:s.commits+1,last:label+" "+ops.slice(-1).join("")}));
const attempt=(label:string,f:()=>void)=>{try{f();refresh(label);}catch(e){useHost.setState({last:"rejected "+(e as Error).message});}};
const S=(id:string)=>Number(id);

function applyEdit(e:TimelineEdit){
  attempt(e.kind,()=>{
    if(e.kind==="move")run("moveClip",d=>engine.moveClip(d,S(e.clipId),e.startSeconds,e.targetTrackId?S(e.targetTrackId):undefined,e.mode,e.scope));
    else if(e.kind==="slip")run("slipClip",d=>engine.slipClip(d,S(e.clipId),e.deltaSeconds));
    else if(e.kind==="slide")run("slideClip",d=>engine.slideClip(d,S(e.clipId),e.deltaSeconds));
    else if(e.kind==="roll")run("rollEdit",d=>engine.rollEdit(d,S(e.leftClipId),S(e.rightClipId),e.deltaSeconds));
    else if(e.kind==="rippleTrim")run("rippleTrim",d=>engine.rippleTrim(d,S(e.clipId),e.edge,e.deltaSeconds,e.scope));
    else if(e.kind==="rippleDelete")run("rippleDelete",d=>engine.rippleDelete(d,S(e.clipId),e.scope));
    else if(e.kind==="split")run("splitClip",d=>{const {t,c}=loc(d,S(e.clipId));unlocked(t);splitAt(t,c,e.atSeconds,d);});
    else if(e.kind==="trim")run("trimClip",d=>{const {t,c}=loc(d,S(e.clipId));unlocked(t);c.in=e.inSeconds;c.out=e.outSeconds;c.start=e.startSeconds;});
  });
}
function applyBatch(edits:readonly BatchEdit[]){
  attempt("batch",()=>run("batch",d=>{
    for(const b of edits){
      if(b.kind==="move")engine.moveClip(d,S(b.clipId),b.startSeconds);
      else if(b.kind==="speed")engine.setSpeed(d,S(b.clipId),b.speed);
      else if(b.kind==="remove")engine.removeClip(d,S(b.clipId));
      else engine.rippleDelete(d,S(b.clipId),b.scope);
      check(d);
    }
  }));
  useHost.setState(s=>({multi:s.multi.filter(id=>s.tracks.some(t=>t.clips.some(c=>c.id===id)))}));
}

function Fixture(){
  const s=useHost();
  const duration=Math.max(timelineDuration(s.tracks),24*20);
  const shown=stackOrder(s.tracks);
  const laneHeight=56;
  const phone=typeof window!=="undefined"&&window.innerWidth<600;
  const headerWidth=phone?56:232;
  const seek=(frame:number)=>useHost.setState(h=>({frame,commits:h.commits+1,last:"seek "+frame}));
  const setViewport=(viewport:TimelineViewport)=>useHost.setState({viewport});
  const cutPair=s.cut?clipsOfCut(s.tracks,s.cut):undefined;
  const cutInfo=cutPair?{target:transitionTarget(cutPair.track),maxFrames:maxTransitionFrames(cutPair.left,cutPair.right),
    ...(transitionAt(s.transitions,s.cut!)?{currentKind:transitionAt(s.transitions,s.cut!)!.kind}:{})}:undefined;
  const card={className:"rounded-card border border-border bg-surface-raised"};
  return <ScrollView contentContainerStyle={{padding:16,gap:14,maxWidth:1100,width:"100%",alignSelf:"center"}}>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:12,alignItems:"center"}}>
      <JKLShuttleController testID="jkl" rate={s.shuttle} supportsReverse onRateChange={shuttle=>useHost.setState({shuttle})}
        onStep={d=>useHost.setState(h=>({steps:h.steps+1,frame:Math.max(0,h.frame+d)}))}/>
    </View>
    <View {...card} style={{padding:12,gap:10}}
      onLayout={e=>{
        const w=e.nativeEvent.layout.width-24-headerWidth;
        useHost.setState(h=>({viewport:clampViewport({...h.viewport,widthPx:w,pxPerFrame:h.viewport.widthPx?h.viewport.pxPerFrame:defaultPxPerFrame(w,rate)*1.6},duration)}));
      }}>
      {s.viewport.widthPx>0?<>
        <View style={{marginStart:headerWidth,gap:10}}>
          <TimelineMarkers testID="markers" markers={s.markers} viewport={s.viewport} rate={rate} durationFrames={duration} playheadFrame={s.frame}
            selectedMarkerId={s.marker} onSelect={marker=>useHost.setState({marker})} onSeek={seek}
            onAdd={at=>attempt("marker",()=>run("addMarker",d=>{d.markers.push({id:d.next++,t:at.seconds,d:0,name:nextMarkerName(readMarkers()),note:""});}))}
            onUpdate={(id,u)=>respondMarker(()=>attempt("marker",()=>run("updateMarker",d=>{const m=d.markers.find(x=>x.id===S(id))!;m.t=u.seconds;
              if(u.durationSeconds!==undefined)m.d=u.durationSeconds;if(u.name!==undefined)m.name=u.name;if(u.note!==undefined)m.note=u.note;})))}
            onRemove={id=>{attempt("marker",()=>run("removeMarker",d=>{d.markers=d.markers.filter(x=>x.id!==S(id));}));useHost.setState({marker:undefined});}}/>
          <LoopRangeBar testID="loop" viewport={s.viewport} range={s.loop} durationFrames={duration} rate={rate} looping={s.looping}
            onLoopingChange={looping=>useHost.setState({looping})} marks={s.range}
            onCommit={r=>attempt("loop",()=>run(r?"setLoopRange":"clearLoopRange",d=>{d.loop=r?{in:r.inSeconds,out:r.outSeconds}:undefined;}))}/>
          <InOutRangeHandles testID="inout" viewport={s.viewport} range={s.range} durationFrames={duration} rate={rate}
            playheadFrame={s.frame} onCommit={range=>useHost.setState({range})}/>
          <TimelineRuler testID="ruler" viewport={s.viewport} rate={rate} durationFrames={duration} frame={s.frame} onSeek={seek}/>
        </View>
        <OverlayAndEffectsTrackStack testID="stack" tracks={s.tracks} viewport={s.viewport} onViewportChange={setViewport} rate={rate}
          durationFrames={duration} playheadFrame={s.frame} selectedClipId={s.selected} tool={s.tool} moveMode={s.moveMode}
          rippleScope={s.scope} laneHeight={laneHeight} headerWidth={headerWidth} compactHeaders={phone} selectedClipIds={s.multi}
          onToggleSelect={id=>useHost.setState(h=>({multi:h.multi.includes(id)?h.multi.filter(x=>x!==id):[...h.multi,id]}))}
          onSelect={selected=>useHost.setState({selected})} onEdit={applyEdit}
          onSetFlag={(id,flag,value)=>attempt("flag",()=>run("setTrackFlags",d=>{const t=d.tracks.find(x=>x.id===S(id))!;t[flag]=value;}))}
          onRename={(id,name)=>{const rename=()=>attempt("rename",()=>run("renameTrack",d=>{d.tracks.find(x=>x.id===S(id))!.name=name;}));if(params.has("renameDelay"))setTimeout(rename,Number(params.get("renameDelay")));else rename();}}
          onMoveTrack={(id,to)=>attempt("track",()=>run("moveTrack",d=>{const i=d.tracks.findIndex(x=>x.id===S(id));const [t]=d.tracks.splice(i,1);d.tracks.splice(to,0,t!);}))}
          onAddTrack={kind=>attempt("track",()=>run("addTrack",d=>{const n=d.tracks.filter(t=>t.kind===kind).length+1;
            d.tracks.push({id:d.next++,kind,name:(kind==="audio"?"Audio ":kind==="overlay"?"Overlay ":"Video ")+n,locked:false,hidden:false,muted:false,solo:false,clips:[]});}))}
          laneOverlay={<>
            <TransitionHandles testID="trans" tracks={shown} transitions={s.transitions} viewport={s.viewport} rate={rate} laneHeight={laneHeight}
              showCutTargets={s.cutTargets&&(s.tool==="select"||s.tool==="razor")} selectedCut={s.cut} onSelectCut={cut=>useHost.setState({cut})}
              selectedTransitionId={s.transitionId} onSelectTransition={transitionId=>useHost.setState({transitionId})}
              onAdd={r=>attempt("transition",()=>run("addTransition",d=>{d.trans.push({id:d.next++,track:S(r.trackId),left:S(r.leftClipId),right:S(r.rightClipId),kind:r.kind,d:r.durationSeconds});}))}
              onChange={(id,c)=>attempt("transition",()=>run("setTransition",d=>{d.trans.find(x=>x.id===S(id))!.d=c.durationSeconds;}))}
              onRemove={id=>attempt("transition",()=>run("removeTransition",d=>{d.trans=d.trans.filter(x=>x.id!==S(id));}))}/>
            <TimelinePlayhead testID="playhead" viewport={s.viewport} frame={s.frame} durationFrames={duration} rate={rate}
              height={laneHeight*shown.length} onSeek={seek}/>
          </>}/>
      </>:null}
    </View>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:14,alignItems:"flex-start"}}>
      <View {...card} style={{padding:12,gap:10,flexGrow:1,flexBasis:320}}>
        <Text {...{className:"text-text font-semibold"}}>Trim</Text>
        <RollSlipSlideControls testID="trim" tool={s.tool} onToolChange={tool=>useHost.setState({tool})} tracks={s.tracks}
          selectedClipId={s.selected} rate={rate} rippleScope={s.scope} onEdit={applyEdit}/>
        <Text {...{className:"text-text font-semibold"}}>Move and ripple</Text>
        <DragReorderAndRipple testID="move" moveMode={s.moveMode} onMoveModeChange={moveMode=>useHost.setState({moveMode})}
          rippleScope={s.scope} onRippleScopeChange={scope=>useHost.setState({scope})} tracks={s.tracks} selectedClipId={s.selected} onEdit={applyEdit}/>
      </View>
      <View {...card} style={{padding:12,gap:10,flexGrow:1,flexBasis:320}}>
        <Text {...{className:"text-text font-semibold"}}>Several clips</Text>
        <BatchEditPanel testID="batch" tracks={s.tracks} selectedClipIds={s.multi} rate={rate} rippleScope={s.scope}
          onApply={applyBatch} onClearSelection={()=>useHost.setState({multi:[]})}/>
      </View>
      <View {...card} style={{padding:12,gap:10,flexGrow:1,flexBasis:320}}>
        <Text {...{className:"text-text font-semibold"}}>Transitions</Text>
        <TransitionPresetBrowser testID="presets" cut={cutInfo} rate={rate}
          onApply={(kind,_f,seconds)=>attempt("transition",()=>{
            const cut=useHost.getState().cut!;const cur=transitionAt(useHost.getState().transitions,cut);
            if(cur)run("setTransition",d=>{const x=d.trans.find(t=>t.id===S(cur.id))!;x.kind=kind;x.d=seconds;});
            else run("addTransition",d=>{d.trans.push({id:d.next++,track:S(cut.trackId),left:S(cut.leftClipId),right:S(cut.rightClipId),kind,d:seconds});});
          })}/>
      </View>
    </View>
    <View style={{gap:4}}>
      <Text testID="commits" {...{className:"text-text-muted"}}>{"commits "+s.commits}</Text>
      <Text testID="last" {...{className:"text-text-muted"}}>{"last "+s.last}</Text>
      <Text testID="frame" {...{className:"text-text-muted"}}>{"frame "+s.frame+" steps "+s.steps}</Text>
      <Text testID="clips" {...{className:"text-text-muted"}}>{"clips "+s.tracks.map(t=>t.id+":"+t.clips.map(c=>`${c.id}@${c.startFrame}+${Math.round((c.sourceOut-c.sourceIn)/c.speed)}[${Math.round(c.sourceIn)}]`).join(",")).join(" ")}</Text>
      <Text testID="tracks" {...{className:"text-text-muted"}}>{"tracks "+s.tracks.map(t=>`${t.id}:${t.label}${t.locked?":L":""}${t.hidden?":H":""}${t.muted?":M":""}${t.solo?":S":""}`).join(" ")}</Text>
      <Text testID="trans-state" {...{className:"text-text-muted"}}>{"transitions "+s.transitions.map(t=>`${t.leftClipId}-${t.rightClipId}:${t.kind}:${t.durationFrames}`).join(" ")}</Text>
      <Text testID="markers-state" {...{className:"text-text-muted"}}>{"markers "+s.markers.map(m=>`${m.name}@${m.frame}+${m.durationFrames??0}${m.note?"("+m.note+")":""}`).join(", ")}</Text>
      <Text testID="loop-state" {...{className:"text-text-muted"}}>{"loop "+(s.loop?s.loop.inFrame+"-"+s.loop.outFrame:"none")+" looping "+s.looping}</Text>
      <Text testID="multi" {...{className:"text-text-muted"}}>{"multi "+s.multi.join(",")}</Text>
    </View>
  </ScrollView>;
}
document.documentElement.dataset.theme=params.get("theme")??"light";
if(params.get("dir")==="rtl")document.documentElement.dir="rtl";
AppRegistry.registerComponent("Timeline2Acceptance",()=>Fixture);
AppRegistry.runApplication("Timeline2Acceptance",{rootTag:document.getElementById("root")});
