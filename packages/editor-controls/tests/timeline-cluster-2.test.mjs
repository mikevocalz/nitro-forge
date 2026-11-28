import test from "node:test";
import assert from "node:assert/strict";
import {FRAME_RATES} from "../src/timebase.ts";
import {compatibleKinds,deltaSeconds,rippleDeleteEdit,trackSilenced} from "../src/timeline/edits.ts";
import {
  TRIM_MODE_PROBLEM_TEXT,nextTouching,previousTouching,rippleDeletePreview,rippleTrimEdit,rippleTrimPreview,
  rollEdit,rollPair,rollPreview,slideEdit,slidePreview,slipEdit,slipLimits,slipPreview,
} from "../src/timeline/trim-modes.ts";
import {placementEdit,placementPreview,trackAtOffset} from "../src/timeline/placement.ts";
import {
  AUDIO_CROSSFADE,clampTransitionFrames,clipsOfCut,cutsOf,maxTransitionFrames,transitionAt,transitionRequest,transitionTarget,
} from "../src/timeline/transitions.ts";
import {adjacentMarker,moveMarker,nextMarkerName,resizeMarker,sortMarkers} from "../src/timeline/markers.ts";
import {loopCommit,loopFromMarks,loopNext,setLoopEdge} from "../src/timeline/loop-range.ts";
import {DEFAULT_SHUTTLE_LADDER,shuttleLabel,shuttleRate} from "../src/timeline/shuttle.ts";
import {SPEED_RANGE,batchRemove,batchRippleDelete,batchShift,batchSpeed,selectedClips} from "../src/timeline/batch.ts";
import {transitionDiagram,TRANSITION_KINDS} from "../src/timeline/transition-presets.ts";
import {stackOrder,stackMoveTarget} from "../src/timeline/track-stack.ts";

const R24=FRAME_RATES.FILM_24;
const clip=(id,startFrame,sourceIn,sourceOut,extra={})=>({id,startFrame,sourceIn,sourceOut,speed:1,sourceDuration:240,label:id,...extra});
// a: 0..48 (media 24..72), b: 48..96 (media 48..96), c: 120..144 (media 0..24)
const video=(over={})=>({id:"v1",kind:"video",label:"Video 1",clips:[clip("a",0,24,72),clip("b",48,48,96),clip("c",120,0,24)],...over});
const audio=(over={})=>({id:"a1",kind:"audio",label:"Audio 1",clips:[clip("x",0,0,100),clip("y",130,0,20)],...over});

test("track kinds, silencing and delta seconds",()=>{
  assert.equal(compatibleKinds("video","overlay"),true);
  assert.equal(compatibleKinds("overlay","audio"),false);
  assert.equal(compatibleKinds("audio","audio"),true);
  const a=audio(),b={...audio({id:"a2"}),solo:true},v={...video(),hidden:true};
  assert.equal(trackSilenced(a,[a,b]),true,"another track soloed");
  assert.equal(trackSilenced(b,[a,b]),false);
  assert.equal(trackSilenced({...a,muted:true},[a]),true);
  assert.equal(trackSilenced(a,[a]),false);
  assert.equal(trackSilenced(v,[v]),true);
  assert.equal(deltaSeconds(-12,R24),-0.5);
  assert.equal(deltaSeconds(48,R24),2);
  assert.throws(()=>deltaSeconds(0.5,R24),/whole/);
  assert.deepEqual(rippleDeleteEdit("a","v1","all"),{kind:"rippleDelete",clipId:"a",trackId:"v1",scope:"all"});
});

test("slip keeps the clip in place and stops at the media's ends",()=>{
  const t=video(),a=t.clips[0];
  assert.deepEqual(slipLimits(a),{min:-24,max:168});
  const p=slipPreview(t,a,-10);
  assert.equal(p.valid,true);
  assert.deepEqual(p.clips.a,{startFrame:0,sourceIn:14,sourceOut:62});
  assert.equal(slipPreview(t,a,-25).problem,"media");
  assert.equal(slipPreview(t,a,169).problem,"media");
  assert.equal(slipPreview({...t,locked:true},a,1).problem,"locked");
  assert.deepEqual(slipEdit(a,"v1",p,R24),{kind:"slip",clipId:"a",trackId:"v1",deltaFrames:-10,deltaSeconds:-10/24});
  assert.equal(slipEdit(a,"v1",slipPreview(t,a,0),R24),undefined);
  assert.throws(()=>slipPreview(t,a,0.5),/whole/);
});

test("slide trades media with touching neighbours and needs room on open sides",()=>{
  const t=video(),b=t.clips[1];
  assert.equal(previousTouching(t,b).id,"a");
  assert.equal(nextTouching(t,b),undefined);
  const p=slidePreview(t,b,10);
  assert.equal(p.valid,true);
  assert.deepEqual(p.clips.b,{startFrame:58,sourceIn:48,sourceOut:96});
  assert.deepEqual(p.clips.a,{startFrame:0,sourceIn:24,sourceOut:82},"a's tail grows into the gap");
  // Sliding b right until it meets c (starts 120) is the limit on the open side.
  assert.equal(slidePreview(t,b,24).valid,true);
  assert.equal(slidePreview(t,b,25).problem,"overlap");
  // Left: a shrinks; it keeps at least a frame.
  assert.equal(slidePreview(t,b,-47).valid,true);
  assert.equal(slidePreview(t,b,-48).problem,"length");
  // a's media ends at 240: growing past it is out of media.
  const short={...t,clips:[clip("a",0,24,72,{sourceDuration:80}),t.clips[1],t.clips[2]]};
  assert.equal(slidePreview(short,short.clips[1],9).problem,"media");
  assert.deepEqual(slideEdit(b,"v1",p,R24),{kind:"slide",clipId:"b",trackId:"v1",deltaFrames:10,deltaSeconds:10/24});
  // A clip with neighbours on both sides.
  const three={...t,clips:[clip("p",0,0,24),clip("m",24,0,24),clip("n",48,24,72)]};
  const q=slidePreview(three,three.clips[1],5);
  assert.equal(q.valid,true);
  assert.deepEqual(q.clips.n,{startFrame:53,sourceIn:29,sourceOut:72});
  assert.equal(slidePreview(three,three.clips[1],-25).problem,"overlap","cannot start before 0");
});

test("roll moves the cut between touching clips",()=>{
  const t=video(),[a,b]=t.clips;
  assert.deepEqual(rollPair(t,b,"head"),{left:a,right:b});
  assert.deepEqual(rollPair(t,a,"tail"),{left:a,right:b});
  assert.equal(rollPair(t,b,"tail"),undefined);
  const p=rollPreview(t,a,b,6);
  assert.equal(p.valid,true);
  assert.deepEqual(p.clips.a,{startFrame:0,sourceIn:24,sourceOut:78});
  assert.deepEqual(p.clips.b,{startFrame:54,sourceIn:54,sourceOut:96});
  const long={...t,clips:[clip("l",0,0,96),clip("r",96,30,96)]};
  assert.equal(rollPreview(long,long.clips[0],long.clips[1],-30).valid,true);
  assert.equal(rollPreview(long,long.clips[0],long.clips[1],-31).problem,"media","r has 30 frames of head media");
  assert.equal(rollPreview(t,a,b,48).problem,"length");
  assert.equal(rollPreview(t,a,t.clips[2],1).problem,"adjacent");
  assert.deepEqual(rollEdit(a,b,"v1",p,R24),{kind:"roll",leftClipId:"a",rightClipId:"b",trackId:"v1",deltaFrames:6,deltaSeconds:0.25});
});

test("ripple trim shifts later clips by the change in length",()=>{
  const t=video(),a=t.clips[0];
  const tail=rippleTrimPreview([t],t,a,"tail",12,"track");
  assert.equal(tail.valid,true);
  assert.equal(tail.clips.a.sourceOut,84);
  assert.equal(tail.clips.b.startFrame,60);
  assert.equal(tail.clips.c.startFrame,132);
  const head=rippleTrimPreview([t],t,a,"head",12,"track");
  assert.deepEqual(head.clips.a,{startFrame:0,sourceIn:36,sourceOut:72},"head keeps the start");
  assert.equal(head.clips.b.startFrame,36);
  assert.equal(rippleTrimPreview([t],t,a,"head",-25,"track").problem,"media");
  assert.equal(rippleTrimPreview([t],t,a,"tail",-48,"track").problem,"length");
  assert.deepEqual(rippleTrimEdit(a,"v1","head","track",head,R24),
    {kind:"rippleTrim",clipId:"a",trackId:"v1",edge:"head",scope:"track",deltaFrames:12,deltaSeconds:0.5});
  // All tracks: audio x (0..100) spans a's end at 48 and stays; y (130) shifts left by 12 into nothing.
  const au=audio();
  const all=rippleTrimPreview([t,au],t,a,"head",12,"all");
  assert.equal(all.valid,true);
  assert.equal(all.clips.y.startFrame,118);
  assert.equal(all.clips.x,undefined);
  // Shifting y left past x's end (100) collides.
  assert.equal(rippleTrimPreview([t,au],t,a,"head",40,"all").problem,"overlap");
  // Locked tracks hold still and are not checked.
  assert.equal(rippleTrimPreview([t,{...au,locked:true}],t,a,"head",40,"all").valid,true);
  assert.equal(TRIM_MODE_PROBLEM_TEXT.media,"Not enough media");
});

test("ripple delete closes the gap",()=>{
  const t=video(),b=t.clips[1];
  const p=rippleDeletePreview([t],t,b,"track");
  assert.equal(p.valid,true);
  assert.equal(p.clips.c.startFrame,72);
  assert.equal(p.clips.b,undefined);
  assert.equal(rippleDeletePreview([{...t,locked:true}],{...t,locked:true},b,"track").problem,"locked");
});

test("placement across tracks follows kind and lock rules",()=>{
  const v=video(),o={id:"o1",kind:"overlay",label:"Overlay 1",clips:[]},au=audio();
  const tracks=[o,v,au];
  assert.equal(trackAtOffset(tracks,"v1",-1).id,"o1");
  assert.equal(trackAtOffset(tracks,"v1",5).id,"a1");
  assert.equal(trackAtOffset(tracks,"zz",1),undefined);
  const a=v.clips[0];
  assert.equal(placementPreview(v,o,a,10).valid,true);
  assert.equal(placementPreview(v,au,a,10).problem,"kind");
  assert.equal(placementPreview(v,{...o,locked:true},a,10).problem,"locked");
  assert.equal(placementPreview(v,v,a,100).problem,"overlap");
  assert.equal(placementPreview(v,v,a,100,"insert").valid,true);
  assert.deepEqual(placementEdit(a,v,placementPreview(v,o,a,24),R24,"overwrite"),
    {kind:"move",clipId:"a",trackId:"v1",startFrame:24,startSeconds:1,targetTrackId:"o1",mode:"overwrite"});
  assert.deepEqual(placementEdit(a,v,placementPreview(v,v,a,100,"insert"),R24,"insert","all"),
    {kind:"move",clipId:"a",trackId:"v1",startFrame:100,startSeconds:100/24,mode:"insert",scope:"all"});
  assert.equal(placementEdit(a,v,placementPreview(v,v,a,0),R24),undefined,"no change");
});

test("transitions: cuts, handles and requests",()=>{
  const t=video();
  const cuts=cutsOf(t);
  assert.deepEqual(cuts,[{trackId:"v1",leftClipId:"a",rightClipId:"b",frame:48}]);
  const [a,b]=t.clips;
  // a has 168 frames after its out, b 48 before its in, both clips are 48 long: 2*48.
  assert.equal(maxTransitionFrames(a,b),96);
  assert.equal(maxTransitionFrames({...a,sourceDuration:undefined},b),0);
  assert.equal(maxTransitionFrames(a,{...b,sourceIn:0}),0);
  assert.equal(maxTransitionFrames(a,{...b,speed:2}),48,"b at 2x: 48 media frames is 24 timeline frames, its length 24");
  assert.equal(clampTransitionFrames(500,96),96);
  assert.equal(clampTransitionFrames(0,96),1);
  assert.equal(clampTransitionFrames(12,0),undefined);
  assert.deepEqual(transitionRequest(cuts[0],[t],"cross_dissolve",24,R24),
    {trackId:"v1",leftClipId:"a",rightClipId:"b",kind:"cross_dissolve",durationFrames:24,durationSeconds:1});
  assert.equal(transitionRequest({...cuts[0],leftClipId:"zz"},[t],"x",24,R24),undefined);
  assert.equal(clipsOfCut([t],cuts[0]).left.id,"a");
  assert.equal(transitionAt([{id:"t1",trackId:"v1",leftClipId:"a",rightClipId:"b",kind:"x",durationFrames:4}],cuts[0]).id,"t1");
  assert.equal(transitionTarget(audio()),"audio");
  assert.equal(transitionTarget({...t,kind:"overlay"}),"visual");
  assert.equal(AUDIO_CROSSFADE,"cross_fade");
});

test("transition presets cover the engine kinds with a diagram each",()=>{
  assert.deepEqual(TRANSITION_KINDS.map(k=>k.kind),
    ["cross_dissolve","dip_to_black","dip_to_white","wipe_left","wipe_right","push_left","push_right","cross_fade"]);
  for(const k of TRANSITION_KINDS)assert.ok(transitionDiagram(k.kind),k.kind);
  assert.equal(TRANSITION_KINDS.find(k=>k.kind==="cross_fade").tracks,"audio");
  assert.equal(transitionDiagram("unknown").shape,"overlap");
});

test("markers sort, step, move and resize inside the timeline",()=>{
  const ms=[{id:"b",frame:50,name:"B"},{id:"a",frame:10,name:"A",durationFrames:20},{id:"c",frame:50,name:"C"}];
  assert.deepEqual(sortMarkers(ms).map(m=>m.id),["a","b","c"]);
  assert.equal(adjacentMarker(ms,10,1).id,"b");
  assert.equal(adjacentMarker(ms,50,-1).id,"a");
  assert.equal(adjacentMarker(ms,50,1),undefined);
  assert.deepEqual(moveMarker(ms[1],-5,100,R24),{frame:0,seconds:0});
  assert.deepEqual(moveMarker(ms[1],95,100,R24),{frame:80,seconds:80/24},"a range keeps its end inside");
  assert.equal(moveMarker(ms[0],50,100,R24),undefined);
  assert.deepEqual(resizeMarker(ms[0],24,100,R24),{frame:50,seconds:50/24,durationFrames:24,durationSeconds:1});
  assert.equal(resizeMarker(ms[0],0,100,R24),undefined);
  assert.equal(resizeMarker(ms[0],80,100,R24).durationFrames,50);
  assert.equal(nextMarkerName([{id:"1",frame:0,name:"Marker 2"}]),"Marker 3");
});

test("loop range stays at least a frame long",()=>{
  const r={inFrame:10,outFrame:40};
  assert.deepEqual(setLoopEdge(r,"in",50,100),{inFrame:39,outFrame:40});
  assert.deepEqual(setLoopEdge(r,"out",0,100),{inFrame:10,outFrame:11});
  assert.deepEqual(setLoopEdge(r,"out",500,100),{inFrame:10,outFrame:100});
  assert.throws(()=>setLoopEdge(r,"in",0,0),/at least one frame/);
  assert.deepEqual(loopFromMarks({inFrame:5},60),{inFrame:5,outFrame:60});
  assert.equal(loopFromMarks({},60),undefined);
  assert.equal(loopFromMarks({inFrame:60},60),undefined);
  assert.deepEqual(loopCommit(r,R24),{inFrame:10,outFrame:40,inSeconds:10/24,outSeconds:40/24});
  assert.throws(()=>loopCommit({inFrame:4,outFrame:4},R24),/after/);
  assert.equal(loopNext(40,r,true),10);
  assert.equal(loopNext(20,r,true),20);
  assert.equal(loopNext(40,r,false),40);
});

test("J/K/L climbs, stops and steps down through pause",()=>{
  assert.deepEqual([...DEFAULT_SHUTTLE_LADDER],[1,2,4,8]);
  let r=0;
  const press=(k,rev=true)=>{r=shuttleRate(r,k,DEFAULT_SHUTTLE_LADDER,rev);return r;};
  assert.deepEqual(["l","l","l","l","l"].map(k=>press(k)),[1,2,4,8,8]);
  assert.deepEqual(["j","j","j","j","j","j"].map(k=>press(k)),[4,2,1,0,-1,-2]);
  assert.equal(press("k"),0);
  r=4;assert.equal(press("j",false),2,"no reverse: J slows forward play");
  r=0;assert.equal(press("j",false),0);
  r=1.5;assert.equal(shuttleRate(r,"l"),2,"off-ladder rates climb to the next rung");
  assert.equal(Object.is(shuttleRate(-1,"l",DEFAULT_SHUTTLE_LADDER,true),0),true,"stops at +0");
  assert.throws(()=>shuttleRate(0,"l",[2,1]),/ascending/);
  assert.equal(shuttleLabel(0),"Stopped");
  assert.equal(shuttleLabel(-4),"Reverse 4x");
  assert.equal(shuttleLabel(0.5),"0.5x");
});

test("batch edits validate against clips that stay and order safely",()=>{
  const t=video(),au=audio();
  assert.deepEqual(selectedClips([t,au],["c","a","nope"]).map(s=>s.clip.id),["a","c"]);
  const right=batchShift([t],["a","b"],10,R24);
  assert.equal(right.valid,true);
  assert.deepEqual(right.edits.map(e=>e.clipId),["b","a"],"latest first when moving later");
  assert.equal(right.edits[0].startFrame,58);
  assert.equal(batchShift([t],["a","b"],-1,R24).valid,false);
  assert.match(batchShift([t],["b"],30,R24).reason,/overlap/);
  assert.match(batchShift([t],[],3,R24).reason,/Select/);
  assert.match(batchShift([{...t,locked:true}],["a"],3,R24).reason,/locked/);
  assert.match(batchShift([t],["a"],0,R24).reason,/other than 0/);
  const left=batchShift([t],["b","c"],-1,R24);
  assert.equal(left.valid,false,"b would overlap a");
  const leftOk=batchShift([t],["c"],-24,R24);
  assert.deepEqual(leftOk.edits,[{kind:"move",clipId:"c",startFrame:96,startSeconds:4}]);
  // Speed: a at 0.5x would be 96 long and hit b; a and b together at 0.5x hit each other.
  assert.equal(batchSpeed([t],["a"],0.5).valid,false);
  assert.equal(batchSpeed([t],["c"],0.5).valid,true,"c at 0.5x is 48 long and nothing follows it");
  const fast=batchSpeed([t],["a","b"],2);
  assert.equal(fast.valid,true);
  assert.deepEqual(fast.edits,[{kind:"speed",clipId:"a",speed:2},{kind:"speed",clipId:"b",speed:2}]);
  assert.match(batchSpeed([t],["a"],20).reason,new RegExp(String(SPEED_RANGE.max)));
  assert.deepEqual(batchRemove([t],["b","a"]).edits,[{kind:"remove",clipId:"a"},{kind:"remove",clipId:"b"}]);
  assert.deepEqual(batchRippleDelete([t],["a","c"],"all").edits.map(e=>e.clipId),["c","a"]);
});

test("track stack groups overlay above video above audio and moves within a group",()=>{
  const tracks=[{id:"a1",kind:"audio"},{id:"v1",kind:"video"},{id:"o1",kind:"overlay"},{id:"v2",kind:"video"},{id:"o2",kind:"overlay"}]
    .map(t=>({...t,label:t.id,clips:[]}));
  assert.deepEqual(stackOrder(tracks).map(t=>t.id),["o1","o2","v1","v2","a1"]);
  assert.equal(stackMoveTarget(tracks,"v2",-1),1,"v2 moves to v1's index in the host list");
  assert.equal(stackMoveTarget(tracks,"v1",-1),undefined,"top of its group");
  assert.equal(stackMoveTarget(tracks,"o1",1),4);
  assert.equal(stackMoveTarget(tracks,"a1",1),undefined);
});
