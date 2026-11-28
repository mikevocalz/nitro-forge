import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {FRAME_RATES,formatTimecode} from "../src/timebase.ts";
import {
  formatSampleClock,formatTime,framesToSamples,framesToSeconds,parseTime,parseTimecode,positionToSeconds,samplesToFrames,
  secondsToFrame,supportsDropFrame,
} from "../src/timeline/time.ts";
import {clockLabel,defaultPxPerFrame,rulerStep,rulerTicks,speedLabel,zoomLimits} from "../src/timeline/ruler.ts";
import {
  clampViewport,fitRange,followPlayhead,frameToX,minimapScroll,minimapWindow,scrollBy,visibleFrames,visibleRange,xToFrame,zoomAt,
} from "../src/timeline/viewport.ts";
import {
  clipEnd,clipLength,clipsAt,fitsOnTrack,markedRange,moveEdit,movePreview,setMark,snapFrame,snapTargets,splitEdit,
  timelineDuration,trimEdit,trimPreview,visibleClips,
} from "../src/timeline/edits.ts";
import {FRAME_GUIDES,fitAspect,guideRect,insetRect,safeAreas} from "../src/timeline/safe-area.ts";
import {frameForKey} from "../src/timeline/frame-keys.ts";

const R30=FRAME_RATES.VIDEO_30,R24=FRAME_RATES.FILM_24,NTSC=FRAME_RATES.NTSC_2997,NTSC60=FRAME_RATES.NTSC_5994,PAL=FRAME_RATES.PAL_25;
const close=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);

test("frames, seconds and samples convert exactly at rational rates",()=>{
  // Whole frames go through forge/timebase, re-exported here.
  close(framesToSeconds(1,NTSC),1001/30000);
  assert.equal(secondsToFrame(1001/30000,NTSC),1);
  for(const rate of [R24,PAL,R30,NTSC,NTSC60])for(const f of [0,1,29,30,1799,108000,2589408]){
    assert.equal(secondsToFrame(framesToSeconds(f,rate),rate),f,`${rate.numerator}/${rate.denominator} ${f}`);
  }
  // Fractional media positions (speed other than 1x) use positionToSeconds.
  close(positionToSeconds(13.5,R30),0.45);
  close(positionToSeconds(1.5,NTSC),1.5*1001/30000);
  assert.throws(()=>positionToSeconds(-1,R30),/nonnegative/);
  // Frame 1 at 29.97 starts at sample 1601.6 at 48 kHz: its first whole sample is 1602.
  assert.equal(framesToSamples(1,NTSC,48000),1602);
  assert.equal(samplesToFrames(1601,NTSC,48000),0);
  assert.equal(samplesToFrames(1602,NTSC,48000),1);
  assert.equal(framesToSamples(5,NTSC,48000),8008);
  assert.equal(samplesToFrames(8008,NTSC,48000),5);
  assert.equal(samplesToFrames(8007,NTSC,48000),4);
  // A 24-hour NTSC position stays exact (well past 2^53 as an intermediate product in floats).
  const day=Math.floor(24*3600*30000/1001);
  const s=framesToSamples(day,NTSC,192000);
  assert.equal(samplesToFrames(s,NTSC,192000),day);
  for(const f of [0,1,2,999,30000])assert.equal(samplesToFrames(framesToSamples(f,NTSC,44100),NTSC,44100),f);
  assert.throws(()=>framesToSamples(1,NTSC,7999),/Sample rate/);
  assert.throws(()=>framesToSamples(-1,NTSC,48000),/nonnegative/);
  assert.throws(()=>framesToSeconds(1.5,R30),/safe integer/);
});

test("drop-frame timecode parses back to every frame for twenty minutes at 29.97 and 59.94",()=>{
  for(const rate of [NTSC,NTSC60]){
    const last=Math.round(20*60*rate.numerator/rate.denominator);
    for(let f=0;f<=last;f++){
      const tc=formatTimecode(f,rate,{dropFrame:true});
      assert.equal(parseTimecode(tc,rate),f,tc);
    }
  }
  assert.equal(formatTimecode(1800,NTSC,{dropFrame:true}),"00:01:00;02");
  assert.equal(parseTimecode("00:01:00;02",NTSC),1800);
  // Labels that drop-frame skips do not exist.
  assert.equal(parseTimecode("00:01:00;00",NTSC),undefined);
  assert.equal(parseTimecode("00:01:00;01",NTSC),undefined);
  assert.equal(parseTimecode("00:10:00;00",NTSC),17982);
  assert.equal(parseTimecode("00:01:00;03",NTSC60),undefined);
  assert.equal(parseTimecode("00:01:00;00",R30),undefined);
});

test("non-drop timecode parses, and malformed or out-of-range fields are rejected",()=>{
  for(const rate of [R24,PAL,R30,NTSC])for(const f of [0,1,23,24,1439,86399,107892]){
    assert.equal(parseTimecode(formatTimecode(f,rate),rate),f);
  }
  assert.equal(parseTimecode("01:00:00:00",R24),86400);
  assert.equal(parseTimecode("00:00:01:24",R24),undefined);
  assert.equal(parseTimecode("00:60:00:00",R24),undefined);
  assert.equal(parseTimecode("1:2:3:4",R24),undefined);
  assert.equal(parseTimecode("",R24),undefined);
  assert.equal(parseTimecode(" 00:00:02:05 ",R24),53);
  assert.equal(supportsDropFrame(NTSC),true);assert.equal(supportsDropFrame(R30),false);
});

test("display formats round-trip through typed entry",()=>{
  const opts={sampleRate:48000};
  for(const rate of [R24,NTSC])for(const f of [0,1,17,1000,54321]){
    for(const fmt of ["timecode","frames","seconds","samples"]){
      const text=formatTime(f,rate,fmt,opts);
      assert.equal(parseTime(text,rate,fmt,opts),f,`${fmt} ${text}`);
    }
  }
  assert.equal(formatTime(48,R24,"seconds"),"2.000 s");
  assert.equal(formatTime(48,R24,"frames"),"48 f");
  assert.equal(formatSampleClock(48000*3661+24000,48000),"01:01:01.500");
  assert.equal(parseTime("4.5",R24,"seconds"),108);
  assert.equal(parseTime("abc",R24,"frames"),undefined);
  assert.throws(()=>formatTime(1,R24,"samples"),/sample rate/);
});

test("ruler steps match FilmCraft's table and label frames between seconds",()=>{
  // 62 px a second with 100 px labels: every 2 seconds.
  assert.deepEqual(rulerStep(62/30,100,R30),{unit:"seconds",seconds:2});
  // Zoomed far out: at least a minute.
  const out=rulerStep(0.5/30,100,R30);
  assert.ok(out.unit==="seconds"&&out.seconds>=60);
  // Zoomed in: frames.
  assert.equal(rulerStep(3000/30,100,R30).unit,"frames");
  assert.deepEqual(rulerStep(10,72,R30),{unit:"frames",frames:10});
  // Frame steps divide the whole-number rate: at 24 fps, 20f is skipped for 12f or whole seconds.
  assert.deepEqual(rulerStep(4,40,R24),{unit:"frames",frames:12});
  assert.deepEqual(rulerStep(4.32,72,R24),{unit:"seconds",seconds:1});
  assert.deepEqual(rulerStep(4,40,R30),{unit:"frames",frames:10});
  assert.equal(clockLabel(0),"0:00");
  assert.equal(clockLabel(4.5),"0:04");
  assert.equal(clockLabel(65),"1:05");
  assert.equal(clockLabel(3723),"1:02:03");
  const ticks=rulerTicks(0,60,10,R30,72);
  const labels=ticks.filter(t=>t.label).map(t=>t.label);
  assert.deepEqual(labels,["0:00","10f","20f","0:01","10f","20f","0:02"]);
  assert.equal(ticks.filter(t=>!t.label).length,24);
  // NTSC second ticks sit on exact seconds: fractional frames.
  const ntsc=rulerTicks(0,100,1,NTSC,25).filter(t=>t.label);
  close(ntsc[1].frame,30000/1001);
  assert.equal(ntsc[1].label,"0:01");
  assert.ok(rulerTicks(0,1e7,0.001,R30).length<=600);
  assert.throws(()=>rulerStep(0,72,R30),/positive/);
});

test("zoom limits keep the whole timeline at the narrowest and about six frames at the widest",()=>{
  const w=1080;
  const lim=zoomLimits(w,60*30,R30);
  close(lim.min,Math.max(2,w/2/60)/30);
  close(lim.max,w/6);
  const d=defaultPxPerFrame(w,R30);
  assert.ok(lim.min<d&&d<lim.max);
  assert.equal(speedLabel(0.25),"0.25x");
  assert.equal(speedLabel(1.5),"1.5x");
  assert.equal(speedLabel(2),"2x");
  assert.equal(speedLabel(10),"10x");
  assert.equal(speedLabel(-1),"-1x");
});

const vp={startFrame:100,pxPerFrame:2,widthPx:600};
test("viewport maps frames and x, clamps, zooms about an anchor and fits ranges",()=>{
  assert.equal(frameToX(vp,130),60);
  assert.equal(xToFrame(vp,60),130);
  assert.equal(visibleFrames(vp),300);
  assert.deepEqual(visibleRange({...vp,startFrame:100.5}),{start:100,end:401});
  assert.equal(clampViewport({...vp,startFrame:-50},1000).startFrame,0);
  assert.equal(clampViewport({...vp,startFrame:2000},1000).startFrame,1000-225);
  assert.equal(clampViewport({...vp,startFrame:50},100).startFrame,0);
  // The frame under the anchor does not move.
  const mid={...vp,startFrame:1000};
  for(const [x,f] of [[0,2],[300,0.5],[599,1.5]]){
    const z=zoomAt(mid,x,f,10000,R30);
    close(xToFrame(z,x),xToFrame(mid,x),1e-9);
  }
  // Zooming out near the start clamps at frame 0 instead of showing negative time.
  assert.equal(zoomAt(vp,300,0.5,10000,R30).startFrame,0);
  const huge=zoomAt(vp,0,1e9,10000,R30);
  assert.equal(huge.pxPerFrame,zoomLimits(600,10000,R30).max);
  assert.equal(scrollBy(vp,200,10000).startFrame,200);
  const fit=fitRange(vp,{start:300,end:400},10000,R30,20);
  close(fit.pxPerFrame,560/100);
  close(xToFrame(fit,300),350);
  assert.throws(()=>zoomAt(vp,0,0,1000,R30),/positive/);
  assert.throws(()=>frameToX({...vp,pxPerFrame:0},1),/zoom/);
});

test("follow-playhead pages or centers and leaves a visible playhead alone",()=>{
  assert.equal(followPlayhead(vp,200,10000),vp);
  assert.equal(followPlayhead(vp,400,10000).startFrame,400);
  assert.equal(followPlayhead(vp,50,10000).startFrame,20);
  assert.equal(followPlayhead(vp,1000,10000,"center").startFrame,850);
});

test("mini-map window and scroll invert",()=>{
  const w=minimapWindow(vp,1200,400);
  close(w.width,100);close(w.left,100/1200*400);
  const back=minimapScroll(vp,w.left,1200,400);
  close(back.startFrame,100);
  const tiny=minimapWindow({...vp,pxPerFrame:600,widthPx:600},100000,400);
  assert.equal(tiny.width,12);
});

const rate=R30;
const clip=(id,startFrame,sourceIn,sourceOut,extra={})=>({id,startFrame,sourceIn,sourceOut,speed:1,...extra});
const track={id:"v1",kind:"video",label:"Video 1",clips:[clip("a",0,0,60),clip("b",90,100,160),clip("c",200,0,30,{speed:2,sourceDuration:40})]};

test("clip geometry, overlap and visibility follow the engine's rules",()=>{
  assert.equal(clipLength(track.clips[2]),15);
  assert.equal(clipEnd(track.clips[1]),150);
  assert.equal(fitsOnTrack(track,60,30),true);
  assert.equal(fitsOnTrack(track,59,30),false);
  assert.equal(fitsOnTrack(track,150,50),true);
  assert.equal(fitsOnTrack(track,150,51),false);
  assert.equal(fitsOnTrack(track,0,60,"a"),true);
  assert.deepEqual(visibleClips(track,{start:61,end:95}).map(c=>c.id),["b"]);
  assert.equal(timelineDuration([track]),215);
  assert.equal(timelineDuration([{...track,clips:[clip("x",0,0,10,{speed:3})]}]),4);
  assert.throws(()=>clipLength(clip("bad",0,10,10)),/sourceIn/);
});

test("snapping picks the nearest target within the threshold",()=>{
  assert.deepEqual(snapFrame(98,[90,100,150],3),{frame:100,target:100});
  assert.deepEqual(snapFrame(95,[90,100],3),{frame:95});
  assert.deepEqual(snapFrame(94,[90,100],4),{frame:90,target:90});
  assert.deepEqual(snapTargets([track],"b",[77]).sort((x,y)=>x-y),[0,60,77,200,215]);
});

test("move previews round, snap either edge, clamp at zero and refuse overlaps",()=>{
  const b=track.clips[1];
  assert.deepEqual(movePreview(track,b,70.4),{startFrame:70,sourceIn:100,sourceOut:160,valid:true});
  assert.deepEqual(movePreview(track,b,40),{startFrame:40,sourceIn:100,sourceOut:160,valid:false});
  assert.equal(movePreview(track,b,140).valid,true);
  // End edge snaps to c's start at 200: start = 140.
  const snapEnd=movePreview(track,b,137.5,{targets:[200,60],threshold:4});
  assert.equal(snapEnd.startFrame,140);assert.equal(snapEnd.snappedTo,200);
  // Start edge snaps to a's end at 60.
  const snapStart=movePreview(track,b,62,{targets:[200,60],threshold:4});
  assert.equal(snapStart.startFrame,60);assert.equal(snapStart.valid,true);
  assert.equal(movePreview(track,track.clips[0],-30).startFrame,0);
  const edit=moveEdit(b,"v1",movePreview(track,b,140),rate);
  assert.deepEqual(edit,{kind:"move",clipId:"b",trackId:"v1",startFrame:140,startSeconds:140/30});
  assert.equal(moveEdit(b,"v1",movePreview(track,b,90),rate),undefined);
  assert.equal(moveEdit(b,"v1",movePreview(track,b,40),rate),undefined);
});

test("tail trims stop at neighbours, the media end and one frame",()=>{
  const b=track.clips[1];
  const longer=trimPreview(track,b,"tail",180);
  assert.deepEqual({out:longer.sourceOut,valid:longer.valid},{out:190,valid:true});
  assert.equal(trimPreview(track,b,"tail",230).valid,false);
  assert.equal(trimPreview(track,b,"tail",10).sourceOut,101);
  // c runs at 2x with 40 frames of media: the tail cannot pass in + 40.
  const c=track.clips[2];
  const capped=trimPreview(track,c,"tail",400);
  assert.equal(capped.sourceOut,40);
  const e=trimEdit(c,"v1","tail",capped,rate);
  assert.equal(e.order,"trim-only");assert.equal(e.outSeconds,40/30);
});

test("head trims move start and in-point together, speed-aware, with the right apply order",()=>{
  const b=track.clips[1];
  const later=trimPreview(track,b,"head",100);
  assert.deepEqual({s:later.startFrame,i:later.sourceIn,o:later.sourceOut,v:later.valid},{s:100,i:110,o:160,v:true});
  assert.equal(trimEdit(b,"v1","head",later,rate).order,"trim-then-move");
  const earlier=trimPreview(track,b,"head",70);
  assert.deepEqual({s:earlier.startFrame,i:earlier.sourceIn},{s:70,i:80});
  assert.equal(trimEdit(b,"v1","head",earlier,rate).order,"move-then-trim");
  // Past a's end: overlap.
  assert.equal(trimPreview(track,b,"head",50).valid,false);
  // The media starts at 0: b (in 100) can reach at most 100 frames earlier.
  const lone={...track,clips:[b]};
  assert.equal(trimPreview(lone,b,"head",-500).startFrame,0);
  const c2=clip("c2",200,10,30);
  assert.equal(trimPreview({...track,clips:[c2]},c2,"head",0).startFrame,190);
  // 2x speed: each timeline frame is two media frames.
  const c=track.clips[2];
  const cut=trimPreview(track,c,"head",205);
  assert.deepEqual({s:cut.startFrame,i:cut.sourceIn},{s:205,i:10});
  // One frame minimum.
  assert.equal(trimPreview(track,b,"head",500).startFrame,149);
  const edit=trimEdit(b,"v1","head",later,rate);
  assert.deepEqual(edit,{kind:"trim",clipId:"b",trackId:"v1",edge:"head",startFrame:100,startSeconds:100/30,
    sourceIn:110,sourceOut:160,inSeconds:110/30,outSeconds:160/30,order:"trim-then-move"});
  assert.equal(trimEdit(b,"v1","head",trimPreview(track,b,"head",90),rate),undefined);
  // A non-dyadic speed: returning an edge to where it was is not an edit, even
  // though recomputing the media point through the speed adds float error.
  const odd=clip("odd",37,3.3,47.3,{speed:1.1});
  const oddTrack={...track,clips:[odd]};
  assert.equal(trimEdit(odd,"v1","head",trimPreview(oddTrack,odd,"head",37),rate),undefined);
  assert.equal(trimEdit(odd,"v1","tail",trimPreview(oddTrack,odd,"tail",clipEnd(odd)),rate),undefined);
  // Snapping an edge to a target.
  assert.equal(trimPreview(track,b,"head",63,{targets:[60],threshold:4}).startFrame,60);
});

test("splits are strictly inside a clip and carry seconds",()=>{
  const b=track.clips[1];
  assert.deepEqual(splitEdit(b,"v1",120.2,rate),{kind:"split",clipId:"b",trackId:"v1",atFrame:120,atSeconds:4});
  assert.equal(splitEdit(b,"v1",90,rate),undefined);
  assert.equal(splitEdit(b,"v1",150,rate),undefined);
  assert.deepEqual(clipsAt([track],100).map(x=>x.clip.id),["b"]);
  assert.deepEqual(clipsAt([track],90),[]);
});

test("in/out marks clamp and never form an empty or reversed range",()=>{
  let r=setMark({},"in",50,1000);
  assert.deepEqual(r,{inFrame:50});
  r=setMark(r,"out",120.4,1000);
  assert.deepEqual(r,{inFrame:50,outFrame:120});
  assert.deepEqual(setMark(r,"in",120,1000),{inFrame:120});
  assert.deepEqual(setMark(r,"out",40,1000),{outFrame:40});
  assert.deepEqual(setMark(r,"out",5000,1000),{inFrame:50,outFrame:1000});
  assert.deepEqual(setMark({},"in",-5,1000),{inFrame:0});
  assert.deepEqual(markedRange({outFrame:80},300),{start:0,end:80});
  assert.throws(()=>setMark({},"in",Number.NaN,10),/Invalid/);
});

test("frame keys step a frame, page a second and clamp",()=>{
  assert.equal(frameForKey("ArrowRight",10,100,R30),11);
  assert.equal(frameForKey("ArrowLeft",0,100,R30),0);
  assert.equal(frameForKey("PageUp",10,100,R30),40);
  assert.equal(frameForKey("PageUp",10,100,NTSC),40);
  assert.equal(frameForKey("PageDown",10,100,R24),0);
  assert.equal(frameForKey("End",10,100,R30),100);
  assert.equal(frameForKey("Escape",10,100,R30),undefined);
  assert.equal(frameForKey("x",10,100,R30),undefined);
});

test("safe areas follow SMPTE and the picture's aspect fit",()=>{
  const a=safeAreas({width:1920,height:1080},16/9);
  assert.deepEqual(a.picture,{x:0,y:0,width:1920,height:1080});
  close(a.action.width,1920*0.93);close(a.action.x,1920*0.035);
  close(a.title.height,1080*0.9);
  const pillar=fitAspect({width:1000,height:1000},16/9);
  close(pillar.height,562.5);close(pillar.y,218.75);
  const letter=fitAspect({width:1600,height:900},4/3);
  close(letter.width,1200);close(letter.x,200);
  const scope=guideRect(a.picture,FRAME_GUIDES.scope);
  close(scope.width,1920);close(scope.height,1920/2.39);close(scope.y,(1080-1920/2.39)/2);
  assert.deepEqual(insetRect({x:0,y:0,width:100,height:50},1),{x:0,y:0,width:100,height:50});
  assert.deepEqual(safeAreas({width:100,height:100},1,"legacy").fractions,{action:0.9,title:0.8});
  assert.throws(()=>safeAreas({width:100,height:100},1,{action:0.8,title:0.9}),/inside/);
  assert.throws(()=>insetRect(a.picture,0),/fraction/);
  assert.deepEqual(fitAspect({width:0,height:10},1),{x:0,y:0,width:0,height:0});
});

const tlDir=new URL("../src/timeline/",import.meta.url);
test("timeline sources use tokens, no hex literals, no engine or optional renderer imports, no useState",()=>{
  for(const f of readdirSync(tlDir).filter(n=>/\.(ts|tsx)$/.test(n))){
    const text=readFileSync(new URL(f,tlDir),"utf8");
    assert.equal(text.match(/["'`]#[0-9A-Fa-f]{3,8}["'`]/g),null,f);
    assert.ok(!/from\s+["'](?:@nitro-forge\/|@acme\/|@expo\/ui|expo-linear-gradient|(?:@shopify\/)?react-native-skia)/.test(text),f);
    assert.ok(!/useState\b/.test(text),f+" uses useState");
    // Pure timeline models remain importable without React or the state peer.
    // The decoded-waveform cache deliberately owns a vanilla Zustand store.
    if(["time.ts","ruler.ts","viewport.ts","edits.ts","safe-area.ts","frame-keys.ts"].includes(f))
      assert.doesNotMatch(text,/from\s+["'](?:react|react-native|zustand)(?:["'/])/,f);
  }
});

test("ported timeline files carry the pinned FilmCraft notice",()=>{
  for(const f of ["ruler.ts","ClipTrimHandles.tsx"]){
    const text=readFileSync(new URL(f,tlDir),"utf8");
    assert.match(text,/c41b58467edd28d098336286528159b24c5203b5/);
    assert.match(text,/Copyright \(c\) 2026 ArtCraft Team and the FilmCraft contributors/);
    assert.match(text,/MIT License or the Apache License, Version 2\.0/);
    assert.match(text,/Modified for NYC-Tron UI on 2026-11-05/);
  }
  for(const f of ["FilmCraft-LICENSE-MIT.txt","FilmCraft-LICENSE-APACHE.txt","FilmCraft-NOTICE.txt"])
    assert.ok(readFileSync(new URL("../licenses/"+f,import.meta.url),"utf8").length>500,f);
  // Nothing from CapCraft (AGPL) in the timeline.
  for(const f of readdirSync(tlDir))assert.ok(!/capcraft/i.test(readFileSync(new URL(f,tlDir),"utf8")),f);
});
