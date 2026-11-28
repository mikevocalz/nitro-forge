import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inflateSync} from "node:zlib";
import {
  CHECKER_MAX_CELLS,checkerCells,createThumbnailCache,decodeBase64,encodeBase64,encodePng,fitContain,isRasterEmpty,
  rasterFromBase64,rasterToImage,thumbnailCacheId,thumbnailAccessibilityLabel,thumbnailRequestMax,upscaleNearest,validateRaster,
} from "../src/layers/layer-thumbnail-model.ts";
import {
  MASK_FILLS,maskFillReason,maskStateLabel,maskStatusText,maskThumbnailId,normalizeRefine,refineOp,refineReason,
} from "../src/layers/mask-model.ts";
import {clipAccessibilityPhrase,clipReason,clipTarget,clipToggleLabel,resolveClipping} from "../src/layers/clipping-model.ts";
import {
  artboardColumns,artboardDropIndex,artboardKeyAction,newArtboardOp,nextArtboardName,validateArtboards,
} from "../src/layers/artboard-model.ts";
import {
  compareFrame,compareReason,normalizeFraction,resolveCompareSource,sideBySideDirection,splitFromDrag,splitFromKey,splitValueText,
} from "../src/layers/compare-model.ts";
import {layerAccessibilityLabel,validateLayers} from "../src/layers/layer-model.ts";

const dir=new URL("../src/layers/",import.meta.url);
const read=name=>readFileSync(new URL(name,dir),"utf8");
const rgba=(w,h,fill)=>({width:w,height:h,pixels:new Uint8Array(w*h*4).fill(fill)});
const tick=()=>new Promise(r=>setTimeout(r,0));

test("base64 round-trips every byte value and engine results decode to rasters",()=>{
  const bytes=Uint8Array.from({length:256},(_,i)=>i);
  for(const n of [0,1,2,3,255,256])assert.deepEqual(decodeBase64(encodeBase64(bytes.subarray(0,n))),bytes.subarray(0,n));
  assert.equal(encodeBase64(new TextEncoder().encode("Man")),"TWFu");
  assert.equal(encodeBase64(new TextEncoder().encode("Ma")),"TWE=");
  const r=rasterFromBase64({width:1,height:1,pixels_b64:encodeBase64(Uint8Array.of(1,2,3,4))});
  assert.deepEqual([...r.pixels],[1,2,3,4]);
  assert.throws(()=>rasterFromBase64({width:2,height:1,pixels_b64:"AQIDBA=="}),/8 RGBA bytes/);
  assert.throws(()=>decodeBase64("ab$c"),/Invalid base64/);
});

test("PNG encoder writes a valid RGBA PNG whose pixels inflate back unchanged",()=>{
  const raster={width:3,height:2,pixels:Uint8Array.from({length:24},(_,i)=>i*10)};
  const png=encodePng(raster);
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const view=new DataView(png.buffer);
  assert.equal(view.getUint32(16),3);assert.equal(view.getUint32(20),2);
  assert.equal(png[24],8);assert.equal(png[25],6,"color type 6 = RGBA");
  const idatLen=view.getUint32(33);
  const raw=inflateSync(png.subarray(41,41+idatLen));
  assert.equal(raw.length,2*(3*4+1));
  assert.deepEqual([...raw.subarray(1,13)],[...raster.pixels.subarray(0,12)]);
  assert.equal(raw[0],0,"filter byte none");
  // Large enough to need several stored blocks.
  const big=rgba(200,100,7);
  assert.equal(inflateSync(encodePng(big).subarray(41)).length>0,true);
  assert.throws(()=>encodePng({width:2,height:2,pixels:new Uint8Array(3)}),/RGBA bytes/);
  assert.throws(()=>validateRaster({width:0,height:1,pixels:new Uint8Array(0)}),/whole and positive/);
});

test("small drawings upscale by whole pixels, and empty rasters are detected",()=>{
  const r={width:2,height:1,pixels:Uint8Array.of(255,0,0,255, 0,0,255,255)};
  const up=upscaleNearest(r,56);
  assert.equal(up.width,56);assert.equal(up.height,28);
  assert.deepEqual([...up.pixels.subarray(27*4,28*4)],[255,0,0,255],"left half stays red");
  assert.deepEqual([...up.pixels.subarray(28*4,29*4)],[0,0,255,255]);
  assert.equal(upscaleNearest(r,3),r,"factor 1 returns the input");
  assert.equal(upscaleNearest(rgba(4,4,1),100000).width,512,"capped at 512 px");
  assert.equal(isRasterEmpty(rgba(2,2,0)),true);
  assert.equal(isRasterEmpty(r),false);
  const img=rasterToImage(rgba(2,2,0),28);
  assert.equal(img.empty,true);assert.match(img.uri,/^data:image\/png;base64,/);
  assert.equal(img.width,2,"reported size is the source size, not the upscale");
});

test("thumbnail geometry: request size, fit and bounded checkerboard",()=>{
  assert.equal(thumbnailRequestMax(28,28,3),84);
  assert.equal(thumbnailRequestMax(800,600,2),1024,"engine max is 1024");
  assert.throws(()=>thumbnailRequestMax(0,28,2),RangeError);
  assert.deepEqual(fitContain(200,100,28,28),{x:0,y:7,width:28,height:14});
  const small=checkerCells(28,28);
  assert.equal(small.cell,6);
  assert.equal(small.cells.length,12);
  const large=checkerCells(320,200);
  assert.ok(Math.ceil(320/large.cell)<=CHECKER_MAX_CELLS);
  assert.ok(large.cells.length<=CHECKER_MAX_CELLS*CHECKER_MAX_CELLS/2);
});

test("cache loads once per id+revision+size, keeps the stale preview while revalidating, and separates error from empty",async()=>{
  const cache=createThumbnailCache({capacity:8});
  const calls=[];
  let fail=false;
  const load=async(id,max)=>{calls.push(id+"@"+max);if(fail)throw new Error("engine busy");return rgba(2,2,id==="empty"?0:200);};
  let notified=0;cache.subscribe(()=>notified++);
  assert.deepEqual(cache.get("a",1,56),{status:"loading"});
  cache.request("a",1,56,load);cache.request("a",1,56,load);
  await tick();
  assert.equal(calls.length,1,"concurrent requests share one load");
  const ready=cache.get("a",1,56);
  assert.equal(ready.status,"ready");
  assert.equal(cache.get("a",1,56),ready,"snapshots are stable for useSyncExternalStore");
  assert.ok(notified>=1);
  const next=cache.get("a",2,56);
  assert.equal(next.status,"loading");
  assert.equal(next.stale,ready.image,"stale-while-revalidate");
  fail=true;
  cache.request("a",2,56,load);await tick();
  const failed=cache.get("a",2,56);
  assert.equal(failed.status,"error");assert.equal(failed.message,"engine busy");assert.equal(failed.stale,ready.image);
  assert.equal(thumbnailAccessibilityLabel("Photo",failed),"Photo, couldn't render preview");
  fail=false;
  cache.retry("a",2,56);cache.request("a",2,56,load);await tick();
  assert.equal(cache.get("a",2,56).status,"ready");
  cache.request("empty",1,56,load);await tick();
  const empty=cache.get("empty",1,56);
  assert.equal(empty.image.empty,true);
  assert.equal(thumbnailAccessibilityLabel("Blank",empty),"Blank, empty");
  assert.equal(cache.get("a",1,56).status,"ready","older revision still cached");
});

test("cache evicts least recently read entries past its capacity but never loads in flight",async()=>{
  const cache=createThumbnailCache({capacity:2});
  const load=async()=>rgba(1,1,255);
  for(const id of ["a","b","c"]){cache.request(id,1,10,load);await tick();}
  assert.equal(cache.get("c",1,10).status,"ready");
  assert.equal(cache.get("a",1,10).status,"loading","a was evicted and reads as not loaded");
  assert.ok(cache.byteSize>0);
  cache.clear();
  assert.equal(cache.byteSize,0);
  assert.throws(()=>createThumbnailCache({capacity:0}),RangeError);
});

test("mask model: create options explain themselves; refine clamps and refuses no-ops",()=>{
  assert.deepEqual(MASK_FILLS.map(f=>f.fill),["reveal","hide","selection"]);
  assert.equal(maskFillReason("selection",{locked:false,hasSelection:false}),"Make a selection first");
  assert.equal(maskFillReason("reveal",{locked:false,hasSelection:false}),undefined);
  assert.equal(maskFillReason("reveal",{locked:true,hasSelection:true}),"Unlock the layer to edit its mask");
  assert.deepEqual(normalizeRefine({feather:300.4,grow:-999}),{feather:250,grow:-250});
  assert.deepEqual(refineOp("7",{feather:12.6,grow:-3}),{id:"7",feather:13,grow:-3});
  assert.equal(refineReason({feather:0,grow:0},false),"Set a feather or grow amount first");
  assert.equal(refineReason({feather:4,grow:0},false),undefined);
  assert.throws(()=>normalizeRefine({feather:Number.NaN,grow:0}),RangeError);
  assert.equal(maskStateLabel(null),"No mask");
  assert.equal(maskStateLabel({enabled:false,inverted:true,revision:1}),"Mask, off, inverted");
  assert.equal(maskStatusText({enabled:true,inverted:false,revision:1}),"On");
  assert.equal(maskThumbnailId("4"),"mask:4");
});

const stack=[
  {id:"shade",name:"Shade",clipped:true},
  {id:"tint",name:"Tint",clipped:true},
  {id:"photo",name:"Photo",clipped:false},
  {id:"g1",name:"Inner",clipped:true,parent:"grp"},
  {id:"g2",name:"Inner base",clipped:false,parent:"grp"},
  {id:"bg",name:"Background",clipped:false},
];
test("clipping resolves each clipped layer to the nearest unclipped sibling below",()=>{
  const roles=resolveClipping(stack);
  assert.deepEqual(roles.get("shade"),{kind:"clipped",baseId:"photo",baseName:"Photo"});
  assert.deepEqual(roles.get("photo"),{kind:"base",clippedIds:["shade","tint"]});
  assert.deepEqual(roles.get("g1"),{kind:"clipped",baseId:"g2",baseName:"Inner base"},"groups clip within themselves");
  assert.deepEqual(roles.get("bg"),{kind:"none"});
  assert.deepEqual(resolveClipping([{id:"x",name:"X",clipped:true}]).get("x"),{kind:"orphan"});
  assert.equal(clipAccessibilityPhrase(roles.get("tint")),"clipped to Photo");
  assert.equal(clipAccessibilityPhrase(roles.get("photo")),"clipping base for 2 layers");
  assert.throws(()=>resolveClipping([stack[0],stack[0]]),/Duplicate/);
});
test("clip toggle names its base and explains why the bottom layer cannot clip",()=>{
  assert.equal(clipReason(stack,"bg"),"The bottom layer has no layer below to clip to");
  assert.equal(clipReason(stack,"g2"),"The bottom layer has no layer below to clip to","bottom of a group");
  assert.equal(clipReason(stack,"shade"),undefined,"unclipping is always allowed");
  assert.equal(clipReason(stack,"photo"),undefined);
  assert.equal(clipReason([{id:"a",name:"A",clipped:false},{id:"b",name:"B",clipped:true}],"a"),"Every layer below is already clipped");
  assert.equal(clipTarget(stack,"photo").id,"bg");
  assert.equal(clipToggleLabel(stack,"photo"),"Clip to Background");
  assert.equal(clipToggleLabel(stack,"bg"),"Clip to layer below");
  assert.throws(()=>clipReason(stack,"nope"),/Unknown/);
});
test("LayerStack rows carry clippedTo into the label and reject a blank one",()=>{
  const row={id:"t",name:"Tint",visible:true,opacity:1,kind:"raster",clippedTo:"Photo"};
  assert.equal(layerAccessibilityLabel(row,0,2),"Tint, Pixel layer, clipped to Photo, 1 of 2, visible, 100% opacity");
  assert.throws(()=>validateLayers([{...row,clippedTo:" "}]),/clippedTo/);
  const source=read("LayerStack.tsx");
  assert.ok(source.includes("layer.clippedTo?<ClipIndicator"));
});

const boards=[
  {id:"1",name:"Artboard 1",x:0,y:0,w:390,h:844},
  {id:"2",name:"Tablet",x:490,y:-40,w:834,h:1194},
];
test("artboard model validates, names and places new artboards without overlap",()=>{
  assert.doesNotThrow(()=>validateArtboards(boards));
  assert.throws(()=>validateArtboards([...boards,boards[0]]),/Duplicate/);
  assert.throws(()=>validateArtboards([{...boards[0],w:0}]),/geometry/);
  assert.throws(()=>validateArtboards([{...boards[0],name:" "}]),/blank/);
  assert.equal(nextArtboardName(boards),"Artboard 2");
  assert.equal(nextArtboardName([]),"Artboard 1");
  assert.deepEqual(newArtboardOp(boards),{name:"Artboard 2",x:1424,y:-40,w:834,h:1194});
  assert.deepEqual(newArtboardOp(boards,"1"),{name:"Artboard 2",x:1424,y:-40,w:390,h:844},"copies the selected size");
  assert.deepEqual(newArtboardOp([]),{name:"Artboard 1",x:0,y:0,w:1920,h:1080});
});
test("artboard grid columns, drop targets and keys",()=>{
  assert.equal(artboardColumns(358),2);
  assert.equal(artboardColumns(800),5);
  assert.equal(artboardColumns(0),1);
  const m={count:7,columns:3,cellWidth:100,cellHeight:120};
  assert.equal(artboardDropIndex({...m,from:0,dx:110,dy:0}),1);
  assert.equal(artboardDropIndex({...m,from:0,dx:0,dy:130}),3);
  assert.equal(artboardDropIndex({...m,from:0,dx:-110,dy:0,rtl:true}),1,"RTL grids read right to left");
  assert.equal(artboardDropIndex({...m,from:4,dx:900,dy:900}),6,"clamped to the last tile");
  assert.equal(artboardDropIndex({count:3,columns:1,cellWidth:1,cellHeight:68,from:0,dx:500,dy:70}),1,"lists ignore dx");
  assert.throws(()=>artboardDropIndex({...m,from:7,dx:0,dy:0}),RangeError);
  const k={index:1,count:5,columns:2,layout:"grid"};
  assert.deepEqual(artboardKeyAction("ArrowRight",k),{kind:"focus",index:2});
  assert.deepEqual(artboardKeyAction("ArrowRight",{...k,rtl:true}),{kind:"focus",index:0});
  assert.deepEqual(artboardKeyAction("ArrowDown",k),{kind:"focus",index:3});
  assert.deepEqual(artboardKeyAction("ArrowDown",{...k,alt:true}),{kind:"move",to:3});
  assert.deepEqual(artboardKeyAction("End",{...k,alt:true}),{kind:"move",to:4});
  assert.equal(artboardKeyAction("ArrowRight",{...k,layout:"list",alt:true}),null,"lists reorder on up/down only");
  assert.deepEqual(artboardKeyAction("ArrowUp",{...k,layout:"list"}),{kind:"focus",index:0});
  assert.equal(artboardKeyAction("Home",{...k,index:0}),null);
  assert.deepEqual(artboardKeyAction("Enter",k),{kind:"select"});
  assert.deepEqual(artboardKeyAction("F2",k),{kind:"rename"});
  assert.deepEqual(artboardKeyAction("Delete",k),{kind:"remove"});
  assert.equal(artboardKeyAction("q",k),null);
});

test("compare model: split keys stay left-to-right, drags and frames line up",()=>{
  assert.equal(splitFromKey(0.5,"ArrowLeft"),0.49);
  assert.equal(splitFromKey(0.5,"ArrowRight",true),0.6);
  assert.equal(splitFromKey(0.05,"PageDown"),0);
  assert.equal(splitFromKey(0.5,"Home"),0);
  assert.equal(splitFromKey(0.5,"End"),1);
  assert.equal(splitFromKey(0.5,"x"),null);
  assert.equal(splitFromDrag(0.5,100,400),0.75);
  assert.equal(splitFromDrag(0.5,-900,400),0);
  assert.equal(normalizeFraction(0.12345),0.123);
  assert.deepEqual(compareFrame({width:200,height:100},400,400),{x:0,y:100,width:400,height:200});
  assert.equal(sideBySideDirection(390,500),"column");
  assert.equal(sideBySideDirection(834,600),"row");
  assert.equal(splitValueText(0.4,"Before","After"),"40% before, 60% after");
  assert.equal(compareReason(1,undefined,"Before","After"),"No after image yet");
  assert.equal(compareReason(undefined,undefined,"Snapshot","Current"),"No snapshot or current image yet");
  assert.equal(compareReason(1,1,"Before","After"),undefined);
  const img=resolveCompareSource({kind:"pixels",raster:rgba(2,1,255)});
  assert.equal(img.width,2);assert.match(img.uri,/^data:image\/png/);
  assert.throws(()=>resolveCompareSource({kind:"uri",uri:"",width:1,height:1}),/empty/);
});

test("source contracts: controlled, token-only, engine-free, ported files carry the ProCraft header",()=>{
  const files=["LayerThumbnail.tsx","MaskThumbnailAndEditor.tsx","ClippingMaskControls.tsx","ArtboardNavigator.tsx",
    "CanvasCompareView.tsx","panel-button.tsx","layer-thumbnail-model.ts","mask-model.ts","clipping-model.ts",
    "artboard-model.ts","compare-model.ts"];
  for(const f of files){
    const s=read(f);
    assert.ok(!/from\s+["']@nitro-forge\//.test(s),f+" imports the engine");
    assert.ok(!/useState\b/.test(s),f+" keeps app state in useState");
    assert.ok(!/["'`]#[0-9A-Fa-f]{3,8}["'`]/.test(s),f+" hardcodes a color");
    assert.ok(!/<(div|span|img|canvas)\b/.test(s),f+" renders raw HTML");
  }
  for(const f of ["LayerThumbnail.tsx","layer-thumbnail-model.ts","MaskThumbnailAndEditor.tsx","ClippingMaskControls.tsx","clipping-model.ts"]){
    const s=read(f);
    assert.ok(s.includes("c2f7518d03141c746a365f90d8df05a44ddef002"),f);
    assert.ok(s.includes("ui/LayersPanel.kt"),f);
    assert.ok(s.includes("licenses/ProCraft-LICENSE-MIT.txt")&&s.includes("ProCraft-LICENSE-APACHE.txt"),f);
    assert.match(s,/Modified for NYC-Tron UI on 2026-11-05/,f);
  }
  const compare=read("CanvasCompareView.tsx");
  assert.ok(compare.includes('accessibilityRole="adjustable"')&&compare.includes("accessibilityActions="));
  assert.ok(compare.includes('key==="Escape"'),"Escape cancels a split drag");
  const board=read("ArtboardNavigator.tsx");
  for(const op of ["onAddArtboard(newArtboardOp(","onUpdateArtboard({id:","onRemoveArtboard({id})","onMoveArtboard({id,to_index:to})"])
    assert.ok(board.includes(op),op);
  const mask=read("MaskThumbnailAndEditor.tsx");
  for(const op of ["onAddMask({id:layerId,fill:","onRemoveMask({id:layerId,apply:true})","onRemoveMask({id:layerId,apply:false})",
    "onSetMaskEnabled({id:layerId,enabled:","onInvertMask({id:layerId})","onRefineMask(refineOp(layerId"])
    assert.ok(mask.includes(op),op);
  assert.ok(read("ClippingMaskControls.tsx").includes("onSetClipped({id:layerId,clipped:!layer.clipped},signal)"));
  const button=read("panel-button.tsx");
  assert.ok(button.includes('", unavailable"')&&button.includes("accessibilityHint={reason}"),"disabled controls say why");
});

test('malformed successful thumbnail loads become retryable failures',async()=>{const cache=createThumbnailCache();cache.request('invalid',1,28,async()=>({width:2,height:2,pixels:new Uint8Array(1)}));await tick();assert.equal(cache.get('invalid',1,28).status,'error');assert.match(cache.get('invalid',1,28).message,/RGBA/);cache.retry('invalid',1,28);cache.request('invalid',1,28,async()=>rgba(1,1,255));await tick();assert.equal(cache.get('invalid',1,28).status,'ready');});
test('clear aborts cooperative loaders and late completion cannot resurrect an old document',async()=>{const cache=createThumbnailCache();let complete,signal;cache.request('same',1,28,(_,__,s)=>{signal=s;return new Promise(resolve=>{complete=resolve;});});await tick();cache.clear();assert.equal(signal.aborted,true);cache.request('same',1,28,async()=>rgba(1,1,0));await tick();const fresh=cache.get('same',1,28);assert.equal(fresh.status,'ready');assert.equal(fresh.image.empty,true);complete(rgba(1,1,255));await tick();assert.equal(cache.get('same',1,28),fresh);});
test('pending work has an admission budget and clear before its microtask prevents loading',async()=>{const cache=createThumbnailCache({capacity:4,maxPending:1});let finish,calls=0;cache.request('held',1,28,()=>new Promise(resolve=>{finish=resolve;}));cache.request('busy',1,28,async()=>{calls++;return rgba(1,1,255);});await tick();assert.equal(calls,0);assert.match(cache.get('busy',1,28).message,/capacity/);finish(rgba(1,1,255));await tick();cache.retry('busy',1,28);cache.request('busy',1,28,async()=>{calls++;return rgba(1,1,255);});await tick();assert.equal(calls,1);cache.request('cancel-before-start',1,28,async()=>{assert.fail('cancelled loader must not start');});cache.clear();await tick();assert.equal(cache.byteSize,0);});
test('document cache namespaces separate reused layer IDs and oversized output has an honest error',async()=>{assert.notEqual(thumbnailCacheId('layer','a'),thumbnailCacheId('layer','b'));assert.notEqual(thumbnailCacheId('a:b','c'),thumbnailCacheId('a','b:c'));const cache=createThumbnailCache({maxBytes:20});cache.request('too-large',1,28,async()=>rgba(1,1,255));await tick();assert.equal(cache.get('too-large',1,28).status,'error');assert.match(cache.get('too-large',1,28).message,/byte budget/);assert.equal(cache.byteSize,0);});
test('thumbnail encoding bounds large input rasters before creating PNG data URIs',()=>{const image=rasterToImage(rgba(1200,1,255),28);assert.equal(image.width,1200);const png=decodeBase64(image.uri.split(',')[1]),header=new DataView(png.buffer,png.byteOffset,png.byteLength);assert.equal(header.getUint32(16),28);assert.equal(header.getUint32(20),1);assert.throws(()=>validateRaster({width:4097,height:1,pixels:new Uint8Array(4097*4)}),/budget/);});

test('evicted preview images cannot survive in an unbounded stale-image side cache',async()=>{const cache=createThumbnailCache({capacity:1});for(const id of ['a','b']){cache.request(id,1,1,async()=>rgba(1,1,255));await tick();}assert.deepEqual(cache.get('a',2,1),{status:'loading'});cache.clear();assert.equal(cache.byteSize,0);});
test('miss snapshots stay stable while every admitted slot is pending',async()=>{const cache=createThumbnailCache({capacity:1,maxPending:1});cache.request('held',1,1,()=>new Promise(()=>{}));assert.equal(cache.get('other',1,1),cache.get('other',1,1));cache.clear();});
test('base64 raster metadata is checked before decoding its payload',()=>{assert.throws(()=>rasterFromBase64({width:5000,height:1,pixels_b64:'!'}),/budget/);assert.throws(()=>rasterFromBase64({width:1,height:1,pixels_b64:'A'.repeat(2000)}),/4 RGBA bytes/);});

test('clearing a pending preview changes its snapshot so an active subscriber can request again',()=>{const cache=createThumbnailCache();const before=cache.get('a',1,28);cache.request('a',1,28,()=>new Promise(()=>{}));cache.clear();assert.notEqual(cache.get('a',1,28),before);});
