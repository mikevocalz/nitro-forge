import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {docToScreen,screenToDoc,validateViewport,visibleDocRect} from "../src/canvas/canvas-viewport.ts";
import {
 RULER_MAX_TICKS,centerGuidePosition,formatLength,fromPixels,guideAccessibilityLabel,guideKeyCommand,guidePositionAt,
 isOverOwnRuler,rulerSpacing,rulerTicks,toPixels,validateGuides,
} from "../src/canvas/ruler-model.ts";
import {
 DEFAULT_SNAP,gridLines,gridStep,magneticPull,snapPoint,snapRect,snapSummary,validateGrid,validateSnap,
} from "../src/canvas/snap-grid-model.ts";
import {computeSmartGuides,smartGuideSummary} from "../src/canvas/smart-guides-model.ts";
import {
 anchorPoint,contentToDoc,currentAnchor,cycleAnchor,docToContent,nearestAnchor,originKeyCommand,originPayload,
 pivotInDoc,rectCorners,rotationFromDrag,snapRotation,validateTransform,
} from "../src/canvas/transform-origin-model.ts";
import {
 alignAvailability,arrangeAvailability,arrangeTarget,distributeAvailability,planAlign,planDistribute,validateAlignItems,
} from "../src/canvas/align-distribute-model.ts";

const src=name=>readFileSync(new URL(`../src/canvas/${name}`,import.meta.url),"utf8");
const view={zoom:2,panX:100,panY:50,width:800,height:600};

test("viewport maps document to screen without mirroring and validates",()=>{
 assert.equal(docToScreen(view,"x",10),120);
 assert.equal(screenToDoc(view,"y",70),10);
 assert.deepEqual(visibleDocRect(view),{x:-50,y:-25,w:400,h:300});
 assert.throws(()=>validateViewport({...view,zoom:0}),/zoom/);
 assert.throws(()=>validateViewport({...view,width:-1}),/size/);
});

test("ruler units convert through dpi, pixels ignore it",()=>{
 assert.equal(toPixels(1,"in",300),300);
 assert.equal(toPixels(25.4,"mm",300),300);
 assert.equal(toPixels(72,"pt",144),144);
 assert.equal(toPixels(5,"px",300),5);
 assert.equal(fromPixels(150,"cm",150),2.54);
 assert.equal(formatLength(300,"mm",300),"25.4 mm");
 assert.throws(()=>toPixels(1,"in",0),/dpi/);
 assert.throws(()=>toPixels(1,"furlong"),/unit/);
});

test("ruler ticks re-space with zoom and keep labels apart",()=>{
 const near=rulerSpacing(1,"px");
 assert.deepEqual(near,{majorUnits:100,divisions:10});
 const far=rulerSpacing(8,"px");
 assert.equal(far.majorUnits,10);
 assert.ok(rulerSpacing(0.05,"px").majorUnits>=1000);
 assert.deepEqual(rulerSpacing(1,"in",72),{majorUnits:1,divisions:8});
 assert.equal(rulerSpacing(4,"in",72).majorUnits,0.25);
 for(const zoom of [0.01,0.3,1,3,40]){
  for(const unit of ["px","in","cm","mm","pt"]){
   const ticks=rulerTicks({viewport:{...view,zoom},orientation:"horizontal",unit,dpi:300});
   const majors=ticks.filter(t=>t.level==="major");
   for(let i=1;i<majors.length;i++)assert.ok(majors[i].offset-majors[i-1].offset>=55.9,`${unit} at ${zoom}`);
   assert.ok(ticks.length<=RULER_MAX_TICKS);
   assert.ok(ticks.every(t=>t.offset>=0&&t.offset<=800));
  }
 }
});

test("ruler labels count from the origin",()=>{
 const v={zoom:1,panX:0,panY:0,width:400,height:300};
 const ticks=rulerTicks({viewport:v,orientation:"horizontal",unit:"px",origin:{x:50,y:0}});
 const zero=ticks.find(t=>t.label==="0");
 assert.equal(zero.offset,50);
 assert.ok(ticks.some(t=>t.label==="100"&&t.offset===150));
 assert.ok(ticks.some(t=>t.label===undefined&&t.offset===0),"the minor tick at -50 is drawn unlabeled");
 const vertical=rulerTicks({viewport:v,orientation:"vertical",unit:"px"});
 assert.ok(vertical.at(-1).offset<=300);
});

test("guides land on whole pixels, drop back on their ruler, and step by key",()=>{
 assert.equal(guidePositionAt(view,"horizontal",{x:0,y:71}),11);
 assert.equal(guidePositionAt(view,"vertical",{x:121.4,y:0}),11);
 assert.equal(isOverOwnRuler("horizontal",{x:300,y:10}),true);
 assert.equal(isOverOwnRuler("horizontal",{x:10,y:300}),false,"a horizontal guide is removed only over the top ruler");
 assert.equal(isOverOwnRuler("vertical",{x:10,y:300}),true);
 assert.equal(centerGuidePosition(view,"vertical"),150);
 assert.deepEqual(guideKeyCommand("horizontal","ArrowDown"),{kind:"move",delta:1});
 assert.deepEqual(guideKeyCommand("horizontal","ArrowUp",true),{kind:"move",delta:-10});
 assert.equal(guideKeyCommand("horizontal","ArrowLeft"),undefined);
 assert.deepEqual(guideKeyCommand("vertical","ArrowRight"),{kind:"move",delta:1},"Right is +x even in RTL");
 assert.deepEqual(guideKeyCommand("vertical","Delete"),{kind:"remove"});
 assert.equal(guideAccessibilityLabel({id:"g",orientation:"horizontal",position:300},"mm",300),"Horizontal guide at 25.4 mm");
 assert.throws(()=>validateGuides([{id:"a",orientation:"vertical",position:1},{id:"a",orientation:"vertical",position:2}]),/Duplicate/);
 assert.throws(()=>validateGuides([{id:"a",orientation:"diagonal",position:1}]),/orientation/);
});

const grid={spacing:32,subdivisions:4,visible:true};
const ctx=(over={})=>({zoom:1,snap:{...DEFAULT_SNAP},grid,guides:[],artboards:[],...over});

test("grid draws and snaps to what is visible at the zoom",()=>{
 assert.equal(gridStep(grid,1),8);
 assert.equal(gridStep(grid,0.5),32,"subdivisions closer than 6 units are dropped");
 assert.equal(gridStep(grid,0.1),undefined);
 const lines=gridLines(grid,{zoom:1,panX:0,panY:0,width:64,height:16});
 assert.equal(lines.vertical.length,9);
 assert.deepEqual(lines.vertical.filter(l=>l.major).map(l=>l.offset),[0,32,64]);
 assert.deepEqual(gridLines({...grid,visible:false},view),{vertical:[],horizontal:[]});
 assert.throws(()=>validateGrid({...grid,subdivisions:1.5}),/whole/);
 assert.throws(()=>validateGrid({...grid,spacing:0}),/spacing/);
 assert.throws(()=>validateSnap({...DEFAULT_SNAP,strength:2}),/strength/);
});

test("points snap to grid, guides and artboard edges, meeting at intersections",()=>{
 const g=snapPoint({x:14.5,y:21},ctx());
 assert.deepEqual(g.point,{x:16,y:24});
 assert.equal(g.x.line.source.kind,"grid");
 const art=snapPoint({x:103,y:198},ctx({grid:undefined,artboards:[{id:"a1",x:0,y:0,w:100,h:200}]}));
 assert.deepEqual(art.point,{x:100,y:200},"artboard corner");
 assert.equal(art.x.line.source.edge,"end");
 const guide=snapPoint({x:42.5,y:3},ctx({guides:[{id:"g",orientation:"vertical",position:43}]}));
 assert.equal(guide.point.x,43,"the nearer guide beats the grid line at 40");
 assert.equal(guide.x.line.source.kind,"guide");
 const far=snapPoint({x:300.5,y:3},ctx({grid:undefined}));
 assert.deepEqual(far.point,{x:300.5,y:3});
 const off=snapPoint({x:14.5,y:21},ctx({snap:{...DEFAULT_SNAP,enabled:false}}));
 assert.deepEqual(off.point,{x:14.5,y:21});
 assert.equal(off.x,undefined);
 assert.equal(snapSummary(art),"Snapped to artboard edge");
});

test("reach is in screen units and magnetism fades toward its edge",()=>{
 const zoomed=snapPoint({x:14.5,y:0},ctx({zoom:4,grid:{...grid,subdivisions:1}}));
 assert.equal(zoomed.point.x,14.5,"8 screen units is 2 document pixels at 4x");
 assert.equal(magneticPull(4,8,1),4);
 assert.equal(magneticPull(4,8,0),2);
 assert.equal(magneticPull(7.9,8,0)<0.1,true,"no jump at the edge of reach");
 assert.equal(magneticPull(9,8,1),0);
 const weak=snapPoint({x:14,y:0},ctx({snap:{...DEFAULT_SNAP,strength:0}}));
 assert.ok(weak.point.x>14&&weak.point.x<16);
 assert.equal(weak.x,undefined,"a partial pull is not reported as snapped");
});

test("rects snap by the nearest edge or centre and are never resized",()=>{
 const r=snapRect({x:97,y:10,w:50,h:20},ctx({grid:undefined,guides:[{id:"g",orientation:"vertical",position:100}]}));
 assert.deepEqual(r.rect,{x:100,y:10,w:50,h:20});
 assert.equal(r.x.feature,"start");
 const c=snapRect({x:73,y:0,w:50,h:20},ctx({grid:undefined,guides:[{id:"g",orientation:"vertical",position:100}]}));
 assert.equal(c.rect.x,75);
 assert.equal(c.x.feature,"center");
});

const L=(id,x,y,w,h)=>({id,x,y,w,h});
test("smart guides align edges and centres with other layers' bounds",()=>{
 const others=[L("a",0,0,100,50),L("b",300,200,80,40),{id:"empty",empty:true},L("self",500,500,10,10)];
 const r=computeSmartGuides({moving:{x:3,y:120,w:100,h:30},others,movingIds:["self"],zoom:1});
 assert.equal(r.dx,-3);
 assert.equal(r.rect.x,0);
 const left=r.alignments.find(g=>g.axis==="x"&&g.feature==="start");
 assert.deepEqual(left.targets,["a"]);
 assert.equal(left.from,0);
 assert.equal(left.to,150);
 assert.ok(r.alignments.some(g=>g.axis==="x"&&g.feature==="end"),"same width, so right edges align too");
 assert.match(smartGuideSummary(r,{a:"Logo"}),/Left edge aligned with Logo/);
 const off=computeSmartGuides({moving:{x:3,y:120,w:100,h:30},others,zoom:1,enabled:false});
 assert.deepEqual([off.dx,off.dy,off.alignments.length],[0,0,0]);
 assert.throws(()=>computeSmartGuides({moving:{x:0,y:0,w:-1,h:1},others,zoom:1}),/negative/);
});

test("smart guides find equal spacing and centre between neighbours",()=>{
 const others=[L("a",0,0,40,40),L("b",60,0,40,40)];
 const r=computeSmartGuides({moving:{x:122,y:0,w:40,h:40},others,zoom:1});
 assert.equal(r.rect.x,120,"gap to b matches the 20 px gap between a and b");
 const s=r.spacings.find(g=>g.axis==="x");
 assert.equal(s.gap,20);
 assert.equal(s.gaps.length,2);
 const between=computeSmartGuides({moving:{x:103,y:300,w:40,h:40},others:[L("l",0,300,40,40),L("r",200,300,40,40)],zoom:1});
 assert.equal(between.rect.x,100,"centred between neighbours");
 assert.equal(between.spacings[0].gap,60);
 const zoomedOut=computeSmartGuides({moving:{x:130,y:0,w:40,h:40},others,zoom:0.5});
 assert.equal(zoomedOut.rect.x,120,"6 screen units reach 12 document pixels at half zoom");
});

const T={tx:10,ty:20,sx:2,sy:1,rotation:90,ox:5,oy:5};
test("pivot maths matches Prism's affine and round-trips",()=>{
 assert.deepEqual(pivotInDoc(T),{x:15,y:25});
 const p={x:7,y:3};
 const d=contentToDoc(T,p);
 assert.deepEqual(d,{x:17,y:29},"A·(p−o)+o+t with A = R(90°)·S(2,1)");
 assert.deepEqual(docToContent(T,d),p);
 assert.deepEqual(originPayload({...T,rotation:0,sx:1},{x:15,y:25}),{ox:5,oy:5});
 assert.throws(()=>validateTransform({...T,sx:0}),/zero scale/);
});

test("anchors sit on the transformed bounds and the pivot snaps to them",()=>{
 const c=rectCorners({x:0,y:0,w:100,h:50});
 assert.deepEqual(anchorPoint(c,"bottom-right"),{x:100,y:50});
 assert.deepEqual(anchorPoint(c,"top"),{x:50,y:0});
 const rotated=[[0,0],[0,100],[-50,100],[-50,0]];
 assert.deepEqual(anchorPoint(rotated,"right"),{x:-25,y:100});
 assert.equal(nearestAnchor(c,{x:96,y:47},6),"bottom-right");
 assert.equal(nearestAnchor(c,{x:80,y:30},6),undefined);
 assert.equal(currentAnchor(c,{tx:0,ty:0,sx:1,sy:1,rotation:0,ox:50,oy:25}),"center");
 assert.equal(cycleAnchor("bottom-right",1),"top-left");
 assert.equal(cycleAnchor(undefined,-1),"center");
 assert.deepEqual(originKeyCommand("7"),{kind:"anchor",anchor:"top-left"});
 assert.deepEqual(originKeyCommand("ArrowRight",true),{kind:"move",dx:10,dy:0});
 assert.equal(originKeyCommand("x"),undefined);
});

test("rotation snaps the resulting angle to 15 degrees with Shift",()=>{
 assert.equal(snapRotation(22),22);
 assert.equal(snapRotation(22,true),15);
 assert.equal(snapRotation(23,true),30);
 assert.equal(snapRotation(190),-170);
 assert.equal(snapRotation(-180),180);
 const pivot={x:0,y:0};
 assert.equal(rotationFromDrag(pivot,{x:10,y:0},{x:0,y:10},5),95);
 assert.equal(rotationFromDrag(pivot,{x:10,y:0},{x:0,y:10},5,true),90,"start 5 + 90 = 95 rounds to 90");
});

const items=n=>Array.from({length:n},(_,i)=>({id:"L"+i,name:"Layer "+i}));
test("align and distribute are disabled with reasons below their minimums",()=>{
 assert.deepEqual(alignAvailability(items(1),"selection"),{enabled:false,reason:"Select 2 or more layers to align them to each other"});
 assert.deepEqual(alignAvailability(items(1),"canvas"),{enabled:true});
 assert.deepEqual(alignAvailability(items(0),"canvas"),{enabled:false,reason:"Select a layer to align"});
 assert.deepEqual(alignAvailability(items(2),"artboard",false),{enabled:false,reason:"Add an artboard to align to it"});
 assert.deepEqual(alignAvailability([...items(1),{id:"x",name:"Logo",locked:true}],"selection"),{enabled:false,reason:"Unlock Logo to align"});
 assert.deepEqual(distributeAvailability(items(2)),{enabled:false,reason:"Select 3 or more layers to distribute"});
 assert.deepEqual(distributeAvailability(items(3)),{enabled:true});
 assert.throws(()=>validateAlignItems([{id:"a",name:"A"},{id:"a",name:"A"}]),/twice/);
});

test("commands are shaped like the Prism ops",()=>{
 assert.deepEqual(planAlign(items(2),"hcenter","selection"),{ids:["L0","L1"],align:"hcenter",to:"selection"});
 assert.deepEqual(planAlign(items(1),"top","artboard","7"),{ids:["L0"],align:"top",to:{artboard:"7"}});
 assert.throws(()=>planAlign(items(1),"left","selection"),/Select 2/);
 assert.deepEqual(planDistribute(items(3),"horizontal","centers",12),{ids:["L0","L1","L2"],axis:"horizontal",mode:"centers"});
 assert.deepEqual(planDistribute(items(3),"vertical","spacing",12),{ids:["L0","L1","L2"],axis:"vertical",mode:"spacing",spacing:12});
 assert.deepEqual(planDistribute(items(3),"vertical","spacing"),{ids:["L0","L1","L2"],axis:"vertical",mode:"spacing"});
 assert.throws(()=>planDistribute(items(3),"vertical","spacing",-1),/Spacing/);
});

test("arrange moves one layer with moveLayer indices (0 = bottom)",()=>{
 const s={index:2,count:5};
 assert.deepEqual(arrangeTarget(s,"forward"),{to_index:3});
 assert.deepEqual(arrangeTarget(s,"front"),{to_index:4});
 assert.deepEqual(arrangeTarget(s,"backward"),{to_index:1});
 assert.deepEqual(arrangeTarget(s,"back"),{to_index:0});
 assert.deepEqual(arrangeTarget({index:4,count:5},"forward"),{reason:"Already at the front"});
 assert.deepEqual(arrangeTarget({index:0,count:5},"back"),{reason:"Already at the back"});
 assert.throws(()=>arrangeTarget({index:5,count:5},"back"),/out of range/);
 assert.equal(arrangeAvailability(items(2),s).reason,"Select one layer to change its order");
 assert.equal(arrangeAvailability([{id:"a",name:"Logo",locked:true}],s).reason,"Unlock Logo to change its order");
 assert.equal(arrangeAvailability(items(1),{index:0,count:1}).reason,"This is the only layer at its level");
});

test("sources keep the cluster's contracts",()=>{
 // SettingSwitch.tsx moved to NYC-Tron (components/forms); its checks stay there.
 const files=["CanvasRuler.tsx","SnapGridOverlay.tsx","SnapGridSettings.tsx","SmartGuides.tsx","TransformOriginHandle.tsx","AlignDistributePanel.tsx",
  "canvas-viewport.ts","ruler-model.ts","snap-grid-model.ts","smart-guides-model.ts","transform-origin-model.ts","align-distribute-model.ts"];
 for(const f of files){
  const text=src(f);
  assert.ok(!/from\s+["']@nitro-forge\//.test(text),f+" imports the engine");
  assert.ok(!/\buseState\b/.test(text),f+" keeps app state in React state");
 }
 for(const f of ["ruler-model.ts","snap-grid-model.ts","transform-origin-model.ts"]){
  const text=src(f);
  assert.ok(text.includes("c2f7518d03141c746a365f90d8df05a44ddef002"),f+" names the pinned ProCraft commit");
  assert.ok(text.includes("licenses/ProCraft-LICENSE-MIT.txt")&&text.includes("Modified for NYC-Tron UI on 2026-11-05"),f);
 }
 const ruler=src("CanvasRuler.tsx");
 assert.ok(ruler.includes('direction:"ltr"'),"canvas geometry is not mirrored in RTL");
 assert.ok(ruler.includes('k.key==="Escape"'),"Escape cancels a drag");
 const origin=src("TransformOriginHandle.tsx");
 assert.ok(origin.includes("onSetOrigin(ox,oy)"));
 const panel=src("AlignDistributePanel.tsx");
 assert.ok(panel.includes('", unavailable"'),"unavailable buttons say so");
 assert.ok(!/disabled=\{!available/.test(panel),"unavailable buttons stay pressable to explain why");
 assert.ok(panel.includes("PrecisionScrubber"),"spacing uses the existing PrecisionScrubber");
});

test('smart guide metadata is bounded and rejects ambiguous identities',()=>{const moving={x:0,y:0,w:10,h:10};assert.throws(()=>computeSmartGuides({moving,zoom:1,others:Array.from({length:50001},(_,i)=>({id:String(i),empty:true}))}),/budget/);assert.throws(()=>computeSmartGuides({moving,zoom:1,others:[{id:'same',empty:true},{id:'same',x:0,y:0,w:1,h:1}]}),/unique/);assert.throws(()=>computeSmartGuides({moving,zoom:1,others:[{id:'bad',x:NaN,y:0,w:1,h:1}]}),/finite/);});
test('snapping validates guide and artboard metadata before calculation',()=>{const p={x:0,y:0},ctx={zoom:1,snap:DEFAULT_SNAP};assert.throws(()=>snapPoint(p,{...ctx,guides:[{id:'g',orientation:'horizontal',position:NaN}]}),/finite/);assert.throws(()=>snapPoint(p,{...ctx,artboards:[{id:'a',x:0,y:0,w:1,h:1},{id:'a',x:2,y:0,w:1,h:1}]}),/unique/);assert.throws(()=>validateGrid({spacing:32,subdivisions:4,visible:'yes'}),/boolean/);});

test('smart-guide announcements reject oversized feedback and ignore inherited names',()=>{const result={rect:{x:0,y:0,w:10,h:10},dx:0,dy:0,alignments:[{axis:'x',value:0,from:0,to:10,feature:'start',targets:['toString']}],spacings:[]};assert.equal(smartGuideSummary(result,{}),'Left edge aligned with another layer');assert.throws(()=>smartGuideSummary({...result,alignments:Array(7).fill(result.alignments[0])}),/budget/);assert.throws(()=>smartGuideSummary({...result,spacings:[{axis:'x',gap:10,gaps:[{from:10,to:0,at:0}]}]}),/feedback/);});
