import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 MAX_SELECTION_RADIUS,appendLassoPoint,boxFromCorners,buildSelectRegion,closesPolygon,describeSelection,describeShape,
 initialKeyboardRect,modeFromModifiers,moveKeyboardRect,pathSegments,resizeKeyboardRect,resolveSelectionKey,
 shapeProblem,thinPoints,validateMapping,validateSelectionProps,viewToDoc,docRectToView,
} from "../src/selection/selection-model.ts";
import {
 buildMagicWand,buildModifySelection,describeWand,formatTolerance,modifyProblem,validateWandSettings,wandProblem,
} from "../src/selection/magic-selection-model.ts";
import {
 DROP_DOT_SIZE,DROP_SLOP,buildFill,clampToTarget,classifyPress,describeDropTarget,dropKeyMove,dropToDocument,
 thresholdLabel,validateDrop,
} from "../src/canvas-tools/color-drop-model.ts";
import {
 REFERENCE_MIN_HEIGHT,REFERENCE_MIN_WIDTH,clampFrame,moveFrame,pictureRect,referenceA11yLabel,referenceEditProblem,
 resizeFrame,resolveReferenceKey,stepReferenceOpacity,validateReferences,
} from "../src/canvas-tools/reference-board-model.ts";
import {
 CANVAS_QUICK_ACTIONS,DEFAULT_GESTURE_MAP,DEFAULT_HOLD_DELAY_S,MAX_HOLD_DELAY_S,MIN_HOLD_DELAY_S,TABLET_GESTURES,
 assignGesture,clampHoldDelay,conflictMessage,conflictsForAction,findGestureConflicts,keepGestureFor,sameGestureMap,
 saveProblem,usesHeldGesture,validateGestureCatalog,
} from "../src/canvas-tools/gesture-map-model.ts";

const src=p=>readFileSync(new URL("../src/"+p,import.meta.url),"utf8");
const FILES=["selection/selection-model.ts","selection/selection-overlay.tsx","selection/switch-row.tsx",
 "selection/SelectionMarquee.tsx","selection/magic-selection-model.ts","selection/MagicSelectionControls.tsx",
 "canvas-tools/color-drop-model.ts","canvas-tools/ColorDropCanvasTarget.tsx","canvas-tools/reference-board-model.ts",
 "canvas-tools/ReferenceImageBoard.tsx","canvas-tools/gesture-map-model.ts","canvas-tools/GestureCustomizationPanel.tsx"];
const map={viewWidth:400,viewHeight:200,docWidth:800,docHeight:400};

test("selection: modifiers pick the combine mode",()=>{
 assert.equal(modeFromModifiers("replace",{}),"replace");
 assert.equal(modeFromModifiers("replace",{shift:true}),"add");
 assert.equal(modeFromModifiers("intersect",{alt:true}),"subtract");
 assert.equal(modeFromModifiers("replace",{shift:true,alt:true}),"intersect");
});
test("selection: view points map to clamped document pixels",()=>{
 assert.deepEqual(viewToDoc(map,100,50),[200,100]);
 assert.deepEqual(viewToDoc(map,-5,999),[0,400]);
 assert.deepEqual(docRectToView(map,{x:200,y:100,w:400,h:200}),{x:100,y:50,w:200,h:100});
 assert.throws(()=>validateMapping({...map,viewWidth:0}),/positive/);
});
test("selection: boxes normalise and Shift-after-start constrains to a square",()=>{
 assert.deepEqual(boxFromCorners([50,40],[10,10]),{x:10,y:10,w:40,h:30});
 assert.deepEqual(boxFromCorners([0,0],[30,-10],true),{x:0,y:-30,w:30,h:30});
});
test("selection: one request per gesture, too-small shapes commit nothing",()=>{
 assert.deepEqual(buildSelectRegion({kind:"rect",x:10.123,y:5,w:20,h:30},"add",0),{shape:{kind:"rect",x:10.12,y:5,w:20,h:30},mode:"add"});
 assert.deepEqual(buildSelectRegion({kind:"ellipse",x:0,y:0,w:9,h:9},"replace",12.4).feather,12);
 assert.equal(buildSelectRegion({kind:"rect",x:0,y:0,w:0.4,h:30},"replace",0),undefined);
 assert.equal(buildSelectRegion({kind:"polygon",points:[[0,0],[5,5]]},"replace",0),undefined);
 assert.equal(buildSelectRegion({kind:"polygon",points:[[0,0],[10,0],[10,10]]},"subtract",0).shape.points.length,3);
 assert.match(shapeProblem({kind:"polygon",points:[[0,0]]}),/three points/);
 assert.equal(buildSelectRegion({kind:"rect",x:0,y:0,w:10,h:10},"replace",999).feather,MAX_SELECTION_RADIUS);
});
test("selection: lasso drops close points and thins long strokes; polygon closes on the first point",()=>{
 let pts=[[0,0]];
 pts=appendLassoPoint(pts,[1,1]);
 assert.equal(pts.length,1);
 pts=appendLassoPoint(pts,[10,0]);
 assert.equal(pts.length,2);
 const many=Array.from({length:5000},(_,i)=>[i,i]);
 const thin=thinPoints(many,100);
 assert.equal(thin.length,100);
 assert.deepEqual(thin[0],[0,0]);
 assert.deepEqual(thin[99],[4999,4999]);
 assert.equal(closesPolygon([[0,0],[50,0],[50,50]],[5,5]),true);
 assert.equal(closesPolygon([[0,0],[50,0]],[1,1]),false,"needs three points first");
 assert.equal(closesPolygon([[0,0],[50,0],[50,50]],[30,30]),false);
 assert.equal(pathSegments([[0,0],[10,0],[10,10]],true).length,3);
 assert.equal(Math.round(pathSegments([[0,0],[0,10]],false)[0].angle),90);
});
test("selection: keyboard commands and the keyboard marquee stay in the document",()=>{
 assert.deepEqual(resolveSelectionKey({key:"a",metaKey:true}),{type:"selectAll"});
 assert.deepEqual(resolveSelectionKey({key:"d",ctrlKey:true}),{type:"deselect"});
 assert.deepEqual(resolveSelectionKey({key:"I",ctrlKey:true,shiftKey:true}),{type:"invert"});
 assert.equal(resolveSelectionKey({key:"i",ctrlKey:true}),undefined);
 assert.deepEqual(resolveSelectionKey({key:"ArrowLeft"}),{type:"move",dx:-10,dy:0});
 assert.deepEqual(resolveSelectionKey({key:"ArrowDown",altKey:true}),{type:"move",dx:0,dy:100});
 assert.deepEqual(resolveSelectionKey({key:"ArrowRight",shiftKey:true}),{type:"resize",dw:10,dh:0});
 assert.deepEqual(resolveSelectionKey({key:"Escape"}),{type:"cancel"});
 const r=initialKeyboardRect(800,400);
 assert.deepEqual(r,{x:200,y:100,w:400,h:200});
 assert.deepEqual(moveKeyboardRect(r,9999,-9999,800,400),{x:400,y:0,w:400,h:200});
 assert.deepEqual(resizeKeyboardRect(r,-9999,9999,800,400),{x:200,y:100,w:1,h:300});
});
test("selection: labels and validation",()=>{
 assert.equal(describeShape({kind:"rect",x:40,y:30,w:200,h:120}),"Rectangle 200 by 120 px at 40, 30");
 assert.match(describeShape({kind:"polygon",points:[[0,0],[10,0],[10,10]]}),/^Polygon of 3 points/);
 assert.equal(describeSelection(undefined),"Nothing selected");
 assert.throws(()=>validateSelectionProps({tool:"wand",mode:"replace",feather:0}),/tool/);
 assert.throws(()=>validateSelectionProps({tool:"rect",mode:"xor",feather:0}),/mode/);
 assert.throws(()=>validateSelectionProps({tool:"rect",mode:"add",feather:251}),/Feather/);
});

const wand={tolerance:32,contiguous:true,sample:"composite"};
test("magic wand: requests mirror magicWand, layer sampling needs a layer",()=>{
 assert.deepEqual(buildMagicWand(10.6,20.2,wand,"add",undefined),{x:11,y:20,tolerance:32,contiguous:true,sample:"composite",mode:"add"});
 assert.deepEqual(buildMagicWand(1,2,{...wand,sample:"layer"},"replace",7).sample,{layer:7});
 assert.match(wandProblem({...wand,sample:"layer"},undefined),/layer/);
 assert.throws(()=>buildMagicWand(1,2,{...wand,sample:"layer"},"replace",undefined),/layer/);
 assert.throws(()=>validateWandSettings({...wand,tolerance:256}),/0\.\.255/);
 assert.throws(()=>validateWandSettings({...wand,tolerance:3.5}),/whole/);
 assert.equal(formatTolerance(32),"13%");
 assert.equal(describeWand(wand),"Tolerance 32, contiguous, all layers");
});
test("magic wand: edge changes mirror modifySelection and explain why they are off",()=>{
 assert.deepEqual(buildModifySelection("grow",4.4,true),{op:"grow",radius:4});
 assert.deepEqual(buildModifySelection("feather",900,true),{op:"feather",radius:250});
 assert.equal(modifyProblem(false,4),"Nothing is selected");
 assert.match(modifyProblem(true,0),/at least 1 px/);
 assert.throws(()=>buildModifySelection("shrink",4,false),/Nothing is selected/);
});

test("color drop: tap versus drag uses the ProCraft slop and dot size",()=>{
 assert.equal(DROP_SLOP,8);
 assert.equal(DROP_DOT_SIZE,56);
 assert.equal(classifyPress(5,5),"tap");
 assert.equal(classifyPress(6,6),"drag");
});
test("color drop: only drops inside the target map to document pixels",()=>{
 const r={x:20,y:100,width:200,height:100};
 assert.deepEqual(dropToDocument({x:120,y:150},r,1000,500),{x:500,y:250});
 assert.deepEqual(dropToDocument({x:220,y:200},r,1000,500),{x:999,y:499},"far edge clamps inside");
 assert.equal(dropToDocument({x:120,y:99},r,1000,500),undefined,"outside cancels");
 assert.deepEqual(buildFill({x:4.4,y:5.6},"coral",40,false),{x:4,y:6,color:"coral",tolerance:40,contiguous:false});
 assert.equal(thresholdLabel(32),"Threshold 13%");
 assert.deepEqual(dropKeyMove("ArrowUp"),{x:0,y:-8});
 assert.deepEqual(dropKeyMove("ArrowLeft",true),{x:-80,y:0});
 assert.equal(dropKeyMove("a"),undefined);
 assert.deepEqual(clampToTarget({x:-5,y:500},100,80),{x:0,y:80});
 assert.match(describeDropTarget({x:1,y:2},"Coral",32),/Fill at 1, 2 with Coral, Threshold 13%/);
 assert.match(describeDropTarget(undefined,"Coral",32),/Release over the canvas/);
 assert.throws(()=>validateDrop({color:" ",tolerance:1,width:1,height:1,documentWidth:1,documentHeight:1}),/blank/);
 assert.throws(()=>validateDrop({color:"red",tolerance:300,width:1,height:1,documentWidth:1,documentHeight:1}),/tolerance/);
});

const ref={id:"a",label:"Skyline",imageWidth:1000,imageHeight:500,x:10,y:10,width:200,height:160,fit:"fit",
 opacity:0.6,locked:false,pinned:false,placement:"float"};
test("reference: fit shows the whole picture, crop covers the frame",()=>{
 assert.deepEqual(pictureRect("fit",400,400,1000,500),{x:0,y:100,width:400,height:200});
 assert.deepEqual(pictureRect("crop",400,400,1000,500),{x:-200,y:0,width:800,height:400});
});
test("reference: frames stay on the board and above the minimum size",()=>{
 assert.deepEqual(moveFrame(ref,-500,9999,600,400),{x:0,y:240,width:200,height:160});
 const small=resizeFrame(ref,-9999,-9999,600,400);
 assert.equal(small.width,REFERENCE_MIN_WIDTH);
 assert.equal(small.height,REFERENCE_MIN_HEIGHT);
 assert.equal(resizeFrame(ref,9999,0,600,400).width,590);
 assert.deepEqual(clampFrame({x:0,y:0,width:900,height:900},600,400),{x:0,y:0,width:600,height:400});
 assert.equal(stepReferenceOpacity(0.6,1),0.7);
 assert.equal(stepReferenceOpacity(0.1,-1),0.1);
 assert.equal(stepReferenceOpacity(1,1),1);
});
test("reference: lock refuses everything, pin refuses moving, both say why",()=>{
 assert.equal(referenceEditProblem(ref,"move"),undefined);
 assert.match(referenceEditProblem({...ref,pinned:true},"move"),/pinned/);
 assert.equal(referenceEditProblem({...ref,pinned:true},"opacity"),undefined);
 assert.match(referenceEditProblem({...ref,locked:true},"opacity"),/locked/);
 assert.match(referenceEditProblem({...ref,placement:"side"},"resize"),/Float/);
 assert.deepEqual(resolveReferenceKey({key:"ArrowRight",shiftKey:true}),{type:"resize",dw:8,dh:0});
 assert.deepEqual(resolveReferenceKey({key:"Delete"}),{type:"remove"});
 assert.match(referenceA11yLabel({...ref,pinned:true}),/Skyline reference, floating, whole picture, 60% opacity, pinned/);
 assert.throws(()=>validateReferences([ref,ref]),/Duplicate/);
 assert.throws(()=>validateReferences([{...ref,opacity:0}]),/opacity/);
 assert.throws(()=>validateReferences([ref],"zz"),/not on the board/);
});

const G=[...TABLET_GESTURES,{id:"swipe-up",label:"Three-finger swipe up",input:"touch",reservedBy:"iPadOS opens the app switcher"}];
const A=CANVAS_QUICK_ACTIONS;
test("gestures: ProCraft delay range and defaults",()=>{
 assert.equal(MIN_HOLD_DELAY_S,0.1);
 assert.equal(MAX_HOLD_DELAY_S,1.5);
 assert.equal(DEFAULT_HOLD_DELAY_S,0.4);
 assert.equal(clampHoldDelay(9),1.5);
 assert.equal(DEFAULT_GESTURE_MAP.bindings["hide-ui"],"four-finger-tap");
 assert.equal(DEFAULT_GESTURE_MAP.bindings.eyedropper,"long-press");
 assert.deepEqual(findGestureConflicts(DEFAULT_GESTURE_MAP,G,A),[]);
 assert.equal(usesHeldGesture(DEFAULT_GESTURE_MAP,G),true);
 assert.doesNotThrow(()=>validateGestureCatalog(G,A));
 assert.throws(()=>validateGestureCatalog([...G,G[0]],A),/Duplicate gesture/);
});
test("gestures: duplicates and reserved gestures are conflicts that block saving",()=>{
 const dup=assignGesture(DEFAULT_GESTURE_MAP,"hide-ui","two-finger-tap");
 const c=findGestureConflicts(dup,G,A);
 assert.deepEqual(c,[{kind:"duplicate",gestureId:"two-finger-tap",actionIds:["undo","hide-ui"]}]);
 assert.equal(conflictMessage(c[0],G,A),"Two-finger tap is set for both Undo and Hide interface");
 assert.equal(conflictsForAction(c,"undo").length,1);
 assert.equal(conflictsForAction(c,"redo").length,0);
 assert.match(saveProblem(dup,DEFAULT_GESTURE_MAP,c),/conflict/);
 const reserved=assignGesture(DEFAULT_GESTURE_MAP,"quick-menu","swipe-up");
 const rc=findGestureConflicts(reserved,G,A);
 assert.equal(rc[0].kind,"reserved");
 assert.match(conflictMessage(rc[0],G,A),/reserved: iPadOS/);
});
test("gestures: keeping a gesture for one action releases it elsewhere; drafts compare by value",()=>{
 const dup=assignGesture(DEFAULT_GESTURE_MAP,"hide-ui","two-finger-tap");
 const kept=keepGestureFor(dup,"hide-ui","two-finger-tap");
 assert.equal(kept.bindings.undo,undefined);
 assert.equal(kept.bindings["hide-ui"],"two-finger-tap");
 assert.deepEqual(findGestureConflicts(kept,G,A),[]);
 assert.equal(saveProblem(kept,DEFAULT_GESTURE_MAP,[]),undefined);
 assert.equal(saveProblem(DEFAULT_GESTURE_MAP,{...DEFAULT_GESTURE_MAP},[]),"No changes to save");
 assert.equal(sameGestureMap(assignGesture(DEFAULT_GESTURE_MAP,"redo",undefined),DEFAULT_GESTURE_MAP),false);
 assert.equal(sameGestureMap({bindings:{a:undefined},holdDelayS:0.4},{bindings:{},holdDelayS:0.4}),true);
});

test("sources: no engine imports, tokens only, host-owned state, one commit per gesture",()=>{
 for(const f of FILES){
  const text=src(f);
  assert.ok(!/from\s+["'](?:@nitro-forge\/|@acme\/)/.test(text),f+" imports an engine or app package");
  assert.ok(!/useState\b/.test(text),f+" uses useState");
  assert.ok(!/#[0-9A-Fa-f]{3,8}\b|rgba?\(/.test(text),f+" hardcodes a colour");
 }
 const marquee=src("selection/SelectionMarquee.tsx");
 assert.equal((marquee.match(/p\.onSelectRegion\(/g)??[]).length,1,"one commit path");
 assert.ok(marquee.includes('"Escape"')||marquee.includes("cancel"),"Escape cancels");
 const drop=src("canvas-tools/ColorDropCanvasTarget.tsx");
 assert.equal((drop.match(/p\.onFill\(/g)??[]).length,1,"one fill path");
 assert.ok(drop.includes("Dropped outside the canvas"));
 const panel=src("canvas-tools/GestureCustomizationPanel.tsx");
 assert.equal((panel.match(/onSave\(draft\)/g)??[]).length,1);
});
test("sources: ProCraft ports carry the pinned-commit header and both licenses",()=>{
 for(const f of ["canvas-tools/color-drop-model.ts","canvas-tools/ColorDropCanvasTarget.tsx",
  "canvas-tools/reference-board-model.ts","canvas-tools/ReferenceImageBoard.tsx",
  "canvas-tools/gesture-map-model.ts","canvas-tools/GestureCustomizationPanel.tsx"]){
  const text=src(f);
  assert.ok(text.includes("c2f7518d03141c746a365f90d8df05a44ddef002"),f);
  assert.ok(text.includes("procraft-android"),f);
  assert.ok(text.includes("ProCraft-LICENSE-MIT.txt")&&text.includes("ProCraft-LICENSE-APACHE.txt"),f);
  assert.match(text,/Modified for NYC-Tron UI on 2026-11-05/,f);
 }
});
