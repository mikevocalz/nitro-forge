import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  IDENTITY_TRANSFORM,deltaToContent,describeRgba,nudgeDelta,rgbaToCss,toContent,toView,validatePaint,validateStroke,
  validateTransform,
} from "../src/vector/vector-types.ts";
import {
  PEN_MAX_NODES,closeAvailability,convertNodeKind,hitPath,insertAfterAvailability,moveHandle,moveNode,
  nodeAccessibilityLabel,pointOnSegment,removeAvailability,sampleSegment,segmentControls,segmentCount,splitSegment,
  stepSelection,validateSubpaths,
} from "../src/vector/pen-node-model.ts";
import {
  BOOLEAN_OPS,booleanAvailability,booleanIds,groupAvailability,operandAccessibilityLabel,validateBooleanGroup,
} from "../src/vector/shape-builder-model.ts";
import {
  convertPaint,dashForPreset,defaultStroke,fillTypeOf,formatDash,miterAvailability,paintSupport,parseDash,presetForDash,
  withPaintColor,
} from "../src/vector/fill-stroke-model.ts";
import {
  FOCAL_LIMIT,addStop,addStopAvailability,colorAt,gradientHandles,moveGradientHandle,moveStop,projectOnAxis,removeStop,
  removeStopAvailability,snapAngle,stopPoint,toggleFocal,validateGradient,
} from "../src/vector/gradient-handles-model.ts";

const src=name=>readFileSync(new URL("../src/vector/"+name,import.meta.url),"utf8");
const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const RED=[255,0,0,255],BLUE=[0,0,255,255];
const square=(closed=true)=>[{closed,nodes:[
  {x:0,y:0,kind:"corner"},{x:100,y:0,kind:"corner"},{x:100,y:100,kind:"corner"},{x:0,y:100,kind:"corner"},
]}];
const curve=[{closed:false,nodes:[
  {x:0,y:0,out:[50,0],kind:"smooth"},{x:100,y:100,in:[0,-50],kind:"smooth"},
]}];

test("view transform maps content to the overlay and back, including drag deltas",()=>{
  const t=[2,0,0,2,10,20];
  assert.deepEqual(toView(t,{x:5,y:5}),{x:20,y:30});
  assert.deepEqual(toContent(t,{x:20,y:30}),{x:5,y:5});
  assert.deepEqual(deltaToContent(t,10,-4),{x:5,y:-2});
  assert.doesNotThrow(()=>validateTransform(IDENTITY_TRANSFORM));
  assert.throws(()=>validateTransform([0,0,0,0,0,0]),/invertible/);
  assert.throws(()=>validateTransform([1,0,0,1,NaN,0]),/finite/);
});
test("paint and stroke validation mirror the engine's rules",()=>{
  assert.doesNotThrow(()=>validatePaint({type:"solid",color:RED}));
  assert.throws(()=>validatePaint({type:"solid",color:[256,0,0,255]}),/0\.\.255/);
  const stops=[{offset:0,color:RED},{offset:1,color:BLUE}];
  assert.throws(()=>validatePaint({type:"linear",x0:0,y0:0,x1:1,y1:0,stops:[stops[0]]}),/two stops/);
  assert.throws(()=>validatePaint({type:"linear",x0:0,y0:0,x1:1,y1:0,stops:[stops[1],stops[0]]}),/decrease/);
  assert.throws(()=>validatePaint({type:"radial",cx:0,cy:0,r:0,stops}),/positive radius/);
  assert.throws(()=>validatePaint({type:"radial",cx:0,cy:0,r:10,fx:10,fy:0,stops}),/strictly inside/);
  assert.throws(()=>validatePaint({type:"radial",cx:0,cy:0,r:10,fx:1,stops}),/both fx and fy/);
  const stroke=defaultStroke(RED);
  assert.doesNotThrow(()=>validateStroke(stroke));
  assert.throws(()=>validateStroke({...stroke,width:0}),/positive/);
  assert.throws(()=>validateStroke({...stroke,miter_limit:0.5}),/1\.\.1000/);
  assert.throws(()=>validateStroke({...stroke,dash:[0,0]}),/positive total/);
  assert.throws(()=>validateStroke({...stroke,dash:[-1,2]}),/negative/);
  assert.equal(rgbaToCss([31,122,109,128]),"rgba(31,122,109,0.502)");
  assert.equal(describeRgba([31,122,109,255]),"#1F7A6D");
  assert.equal(describeRgba([31,122,109,128]),"#1F7A6D, 50% opacity");
});
test("keyboard nudge is 1 unit, 10 with Shift, arrows only",()=>{
  assert.deepEqual(nudgeDelta("ArrowLeft",false),{x:-1,y:0});
  assert.deepEqual(nudgeDelta("ArrowDown",true),{x:0,y:10});
  assert.equal(nudgeDelta("a",false),undefined);
});

test("subpath validation refuses what the overlay cannot draw honestly",()=>{
  assert.doesNotThrow(()=>validateSubpaths(square()));
  assert.throws(()=>validateSubpaths([]),/at least one/);
  assert.throws(()=>validateSubpaths([{closed:false,nodes:[]}]),/no nodes/);
  assert.throws(()=>validateSubpaths([{closed:false,nodes:[{x:NaN,y:0,kind:"corner"}]}]),/finite/);
  assert.throws(()=>validateSubpaths([{closed:false,nodes:[{x:0,y:0,kind:"cusp"}]}]),/kind/);
  const many=[{closed:false,nodes:Array.from({length:PEN_MAX_NODES+1},(_,i)=>({x:i,y:0,kind:"corner"}))}];
  assert.throws(()=>validateSubpaths(many),/exceeds/);
});
test("segments: closed paths wrap, lines stay one piece, curves sample within bounds",()=>{
  assert.equal(segmentCount(square()[0]),4);
  assert.equal(segmentCount(square(false)[0]),3);
  const wrap=segmentControls(square()[0],3);
  assert.deepEqual([wrap.p0,wrap.p3],[{x:0,y:100},{x:0,y:0}]);
  assert.equal(sampleSegment(segmentControls(square()[0],0)).length,2);
  const c=segmentControls(curve[0],0);
  assert.equal(c.line,false);
  const pts=sampleSegment(c);
  assert.ok(pts.length>=3&&pts.length<=49);
  assert.deepEqual(pts[0],{x:0,y:0});
  assert.deepEqual(pts.at(-1),{x:100,y:100});
});
test("hitPath finds the nearest segment within tolerance, in view space",()=>{
  const hit=hitPath(square(),{x:50,y:4},6);
  assert.equal(hit.subpath,0);
  assert.equal(hit.segment,0);
  close(hit.t,0.5);
  assert.equal(hitPath(square(),{x:50,y:50},6),undefined);
  const zoomed=hitPath(square(),{x:100,y:6},8,q=>toView([2,0,0,2,0,0],q));
  assert.equal(zoomed.segment,0);
});
test("splitting a straight segment inserts a corner and leaves neighbours alone",()=>{
  const intent=splitSegment(square(),0,0,0.25);
  assert.equal(intent.index,1);
  assert.deepEqual(intent.node,{x:25,y:0,kind:"corner"});
  assert.equal(intent.neighborsChanged,false);
  assert.equal(intent.subpaths[0].nodes.length,5);
  const closing=splitSegment(square(),0,3,0.5);
  assert.equal(closing.index,4,"closing segment appends after the last node");
  assert.deepEqual(closing.node,{x:0,y:50,kind:"corner"});
  assert.throws(()=>splitSegment(square(),0,0,0),/strictly/);
});
test("splitting a curve keeps its shape (de Casteljau) and shortens the neighbour handles",()=>{
  const c=segmentControls(curve[0],0);
  const intent=splitSegment(curve,0,0,0.5);
  assert.equal(intent.neighborsChanged,true);
  assert.equal(intent.node.kind,"smooth");
  const mid=pointOnSegment(c,0.5);
  close(intent.node.x,mid.x,1e-3);close(intent.node.y,mid.y,1e-3);
  const [a,b]=[segmentControls(intent.subpaths[0],0),segmentControls(intent.subpaths[0],1)];
  for(const t of [0.2,0.5,0.8]){
    const left=pointOnSegment(a,t),right=pointOnSegment(b,t);
    const ol=pointOnSegment(c,t/2),or=pointOnSegment(c,0.5+t/2);
    close(left.x,ol.x,1e-2);close(left.y,ol.y,1e-2);
    close(right.x,or.x,1e-2);close(right.y,or.y,1e-2);
  }
  assert.deepEqual(intent.subpaths[0].nodes[0].out,[25,0]);
});
test("dragging handles: smooth stays collinear, symmetric mirrors, corner and Alt move one",()=>{
  const smooth={x:0,y:0,in:[-10,0],out:[20,0],kind:"smooth"};
  const s=moveHandle(smooth,"out",[0,30]);
  assert.deepEqual(s.out,[0,30]);
  assert.deepEqual(s.in,[0,-10],"opposite handle keeps its own length");
  const sym=moveHandle({...smooth,kind:"symmetric"},"in",[3,4]);
  assert.deepEqual(sym.out,[-3,-4]);
  const corner=moveHandle({...smooth,kind:"corner"},"out",[0,30]);
  assert.deepEqual(corner.in,[-10,0]);
  const broken=moveHandle(smooth,"out",[0,30],true);
  assert.equal(broken.kind,"corner");
  assert.deepEqual(broken.in,[-10,0]);
  assert.deepEqual(moveNode(smooth,5,-5),{...smooth,x:5,y:-5});
});
test("kind conversion makes handles consistent and pulls new ones from neighbours",()=>{
  const sp=[{closed:false,nodes:[{x:0,y:0,kind:"corner"},{x:30,y:0,kind:"corner"},{x:60,y:0,kind:"corner"}]}];
  const smooth=convertNodeKind(sp,{subpath:0,index:1},"smooth");
  assert.equal(smooth.handlesChanged,true);
  assert.deepEqual(smooth.node.in,[-10,0]);
  assert.deepEqual(smooth.node.out,[10,0]);
  const bent=[{closed:false,nodes:[{x:0,y:0,in:[0,-10],out:[20,20],kind:"corner"}]}];
  const sym=convertNodeKind(bent,{subpath:0,index:0},"symmetric");
  const [ix,iy]=sym.node.in,[ox,oy]=sym.node.out;
  close(ix,-ox,1e-3);close(iy,-oy,1e-3);
  close(Math.hypot(ix,iy),Math.hypot(ox,oy),1e-3);
  const corner=convertNodeKind(bent,{subpath:0,index:0},"corner");
  assert.equal(corner.handlesChanged,false);
  assert.deepEqual(corner.node,{...bent[0].nodes[0],kind:"corner"});
});
test("node commands are unavailable with a reason instead of failing silently",()=>{
  assert.equal(removeAvailability(square(),undefined).reason,"Select a node first");
  assert.equal(removeAvailability([{closed:false,nodes:[{x:0,y:0,kind:"corner"}]}],{subpath:0,index:0}).reason,
    "A subpath keeps at least one node");
  assert.equal(removeAvailability(square(),{subpath:0,index:2}).enabled,true);
  assert.match(insertAfterAvailability(square(false),{subpath:0,index:3}).reason,/last node of an open path/);
  assert.equal(insertAfterAvailability(square(),{subpath:0,index:3}).enabled,true);
  assert.match(closeAvailability([{closed:false,nodes:[{x:0,y:0,kind:"corner"}]}],{subpath:0,index:0}).reason,/second node/);
  assert.deepEqual(stepSelection(square(),{subpath:0,index:3},1),{subpath:0,index:0});
  assert.deepEqual(stepSelection(square(),undefined,-1),{subpath:0,index:3});
  assert.equal(nodeAccessibilityLabel(square(false),{subpath:0,index:0}),"Node 1 of 4, corner, x 0, y 0, no handles, start of open path");
});

const layer=(id,over={})=>({id,name:"Shape "+id,kind:"shape",parent:null,locked:false,...over});
test("boolean availability mirrors booleanLayers validation",()=>{
  assert.equal(booleanAvailability([layer(1)]).reason,"Select at least two shapes or paths");
  assert.match(booleanAvailability([layer(1),layer(2,{kind:"raster",name:"Photo"})]).reason,/“Photo” is a pixel layer/);
  assert.match(booleanAvailability([layer(1),layer(2,{parent:9})]).reason,/same group/);
  assert.match(booleanAvailability([layer(1,{parent:7,parentKind:"boolean"}),layer(2,{parent:7,parentKind:"boolean"})]).reason,/already in a boolean/);
  assert.match(booleanAvailability([layer(1),layer(2,{locked:true})]).reason,/is locked/);
  assert.equal(booleanAvailability([layer(1),layer(2,{kind:"path"})]).enabled,true);
  assert.deepEqual(booleanIds([layer(3),layer(1)]),[3,1]);
  assert.deepEqual(BOOLEAN_OPS.map(o=>o.value),["union","subtract","intersect","exclude"]);
  const group={id:5,name:"Badge",op:"subtract",locked:false,operands:[layer(1),layer(2)]};
  assert.equal(groupAvailability(group).enabled,true);
  assert.match(groupAvailability({...group,locked:true}).reason,/Unlock “Badge”/);
  assert.match(groupAvailability(undefined).reason,/Select a boolean/);
  assert.throws(()=>validateBooleanGroup({...group,operands:[layer(1),layer(1)]}),/Duplicate/);
  assert.throws(()=>validateBooleanGroup({...group,op:"xor"}),/Unknown/);
  assert.equal(operandAccessibilityLabel(layer(2,{locked:true}),1,2),"Shape 2, shape, operand 2 of 2, bottom, locked");
});

test("fill conversions keep colours and place gradients on the content bounds",()=>{
  const bounds={x:10,y:20,width:200,height:100};
  const linear=convertPaint({type:"solid",color:RED},"linear",bounds,BLUE);
  assert.deepEqual(linear,{type:"linear",x0:10,y0:70,x1:210,y1:70,stops:[{offset:0,color:RED},{offset:1,color:[255,0,0,0]}]});
  const radial=convertPaint(linear,"radial",bounds,BLUE);
  assert.deepEqual(radial,{type:"radial",cx:110,cy:70,r:100,stops:linear.stops});
  assert.deepEqual(convertPaint(radial,"solid",bounds,BLUE),{type:"solid",color:RED});
  assert.deepEqual(convertPaint(null,"solid",bounds,BLUE),{type:"solid",color:BLUE});
  assert.equal(convertPaint(radial,"none",bounds,BLUE),null);
  assert.equal(fillTypeOf(null),"none");
  assert.deepEqual(withPaintColor(linear,BLUE,1).stops[1].color,BLUE);
  assert.throws(()=>withPaintColor(linear,BLUE,5),/No stop/);
});
test("layer kinds explain what they cannot take",()=>{
  assert.equal(paintSupport("path").stroke.enabled,true);
  assert.match(paintSupport("shape").gradientFill.reason,/solid fill only/);
  assert.match(paintSupport("shape").stroke.reason,/Convert the shape to a path/);
  assert.equal(paintSupport("boolean").gradientFill.enabled,true);
  assert.match(paintSupport("boolean").stroke.reason,/fill only/);
  assert.match(miterAvailability({...defaultStroke(RED),join:"round"}).reason,/miter joins only/);
});
test("dash presets scale with width; typed patterns are validated",()=>{
  assert.deepEqual(dashForPreset("dash",2),[6,4]);
  assert.deepEqual(dashForPreset("solid",2),[]);
  assert.equal(presetForDash([6,4],2),"dash");
  assert.equal(presetForDash([],3),"solid");
  assert.equal(presetForDash([5,1],2),"custom");
  assert.deepEqual(parseDash("6, 3 1"),{ok:true,dash:[6,3,1]});
  assert.deepEqual(parseDash(""),{ok:true,dash:[]});
  assert.equal(parseDash("6 x").ok,false);
  assert.match(parseDash("0 0").error,/positive total/);
  assert.equal(formatDash([6,3.25]),"6 3.25");
});

const lin={type:"linear",x0:0,y0:0,x1:100,y1:0,stops:[{offset:0,color:RED},{offset:1,color:BLUE}]};
const rad={type:"radial",cx:50,cy:50,r:40,stops:lin.stops};
test("gradient handles: linear ends move and the end rotates, Shift snaps to 15 degrees",()=>{
  assert.deepEqual(gradientHandles(lin).map(h=>h.handle),["start","end"]);
  const turned=moveGradientHandle(lin,"end",{x:0,y:100});
  assert.deepEqual([turned.x1,turned.y1],[0,100]);
  const snapped=moveGradientHandle(lin,"end",{x:100,y:10},true);
  assert.equal(snapped.y1,0);
  close(snapped.x1,Math.hypot(100,10),1e-3);
  const p=snapAngle({x:0,y:0},{x:10,y:9});
  close(Math.atan2(p.y,p.x),Math.PI/4);
  assert.throws(()=>moveGradientHandle(lin,"focal",{x:0,y:0}),/no focal/);
});
test("radial: center carries the focal point, radius cannot swallow it, focal stays inside",()=>{
  const focal=toggleFocal(rad);
  assert.deepEqual([focal.fx,focal.fy],[70,50]);
  assert.deepEqual(gradientHandles(focal).map(h=>h.handle),["center","radius","focal"]);
  const moved=moveGradientHandle(focal,"center",{x:60,y:60});
  assert.deepEqual([moved.cx,moved.cy,moved.fx,moved.fy],[60,60,80,60]);
  const shrunk=moveGradientHandle(focal,"radius",{x:51,y:50});
  assert.ok(shrunk.r>20,"radius stays outside the focal point");
  assert.doesNotThrow(()=>validateGradient(shrunk));
  const out=moveGradientHandle(focal,"focal",{x:500,y:50});
  assert.ok(Math.hypot(out.fx-out.cx,out.fy-out.cy)<out.r);
  close(out.fx-out.cx,out.r*FOCAL_LIMIT,0.5);
  assert.doesNotThrow(()=>validateGradient(out));
  assert.equal(toggleFocal(focal).fx,undefined);
  assert.ok(!("fy" in toggleFocal(focal)));
});
test("stops: offsets project onto the axis, stay ordered, and add or delete with reasons",()=>{
  assert.deepEqual(stopPoint(lin,0.25),{x:25,y:0});
  assert.deepEqual(projectOnAxis(lin,{x:40,y:30}),{offset:0.4,distance:30});
  assert.deepEqual(stopPoint(rad,0.5),{x:70,y:50});
  assert.deepEqual(colorAt(lin.stops,0.5),[128,0,128,255]);
  const added=addStop(lin,0.5);
  assert.equal(added.index,1);
  assert.deepEqual(added.paint.stops[1],{offset:0.5,color:[128,0,128,255]});
  const three=added.paint;
  assert.equal(moveStop(three,1,1.5).stops[1].offset,1,"clamped to its right neighbour");
  assert.equal(moveStop(three,1,0.3).stops[1].offset,0.3);
  assert.equal(removeStop(three,1).stops.length,2);
  assert.equal(removeStopAvailability(lin,0).reason,"A gradient keeps at least two stops");
  assert.equal(removeStopAvailability(lin,undefined).reason,"Select a stop first");
  assert.throws(()=>removeStop(lin,0),/two stops/);
  const full={...lin,stops:Array.from({length:256},(_,i)=>({offset:i/255,color:RED}))};
  assert.match(addStopAvailability(full).reason,/256/);
});

test("components stay engine-free, token-styled, and commit through callbacks",()=>{
  for(const file of ["PenNodeEditor.tsx","ShapeBuilder.tsx","FillStrokeInspector.tsx","GradientOnCanvasHandles.tsx",
    "vector-controls.tsx","vector-types.ts","pen-node-model.ts","shape-builder-model.ts","fill-stroke-model.ts","gradient-handles-model.ts"]){
    const text=src(file);
    assert.ok(!/from\s+["'](?:@nitro-forge\/|@acme\/|@reactvision\/|react-native-svg)/.test(text),file);
    assert.ok(!/\buseState\b/.test(text),file+" keeps app state in the host");
  }
  const pen=src("PenNodeEditor.tsx");
  for(const cb of ["onSetPathNode","onInsertNode","onRemoveNode","onSetNodeKind","onSetClosed"])assert.ok(pen.includes(cb),cb);
  assert.ok(pen.includes('direction:"ltr"'),"canvas geometry stays LTR in RTL");
  assert.ok(pen.includes('key==="Escape"'));
  const grad=src("GradientOnCanvasHandles.tsx");
  assert.ok(grad.includes("onSetFill")&&grad.includes("onPreview"));
  assert.ok(grad.includes('key==="Delete"'));
  const insp=src("FillStrokeInspector.tsx");
  assert.ok(insp.includes("<PrecisionScrubber")&&insp.includes("onSetFillRule")&&insp.includes("onSetPaintOrder"));
  const knob=src("vector-controls.tsx");
  assert.ok(knob.includes("VECTOR_TOUCH_TARGET=44"));
  assert.ok(knob.includes("onPanResponderTerminationRequest:()=>false"));
});
