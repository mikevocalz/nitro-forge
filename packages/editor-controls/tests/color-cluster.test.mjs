import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {hsvToRgb,rgbToHsv,rgbaToHex} from "../src/color.ts";
import {assertHsl,hslToHsv,hslToRgb,hsvToHsl,rgbToHsl} from "../src/color/hsl.ts";
import {compositeOver,contrastRating,contrastRatio,relativeLuminance} from "../src/color/contrast.ts";
import {HARMONY_KINDS,harmonyColors} from "../src/color/harmony.ts";
import {
  FINE_HUE_RATE,HUE_RETAIN_RADIUS,RING_INNER_FRACTION,angleDelta,createRingDrag,discPointToHsv,fromPolar,
  hsvToDiscPoint,hueToRingPoint,isOnRing,toPolar,
} from "../src/color/wheel-geometry.ts";
import {
  FLOATING_PALETTE_WIDTH,UNDOCK_DISTANCE,nudgePalette,placeFloatingPalette,positionFromGrab,shouldUndock,
} from "../src/color/floating-palette.ts";
import {filterSwatchGroups,pushRecentSwatch,swatchColumns,swatchGridMove,swatchKey} from "../src/color/swatches.ts";
import {DEFAULT_COLOR_PAIR,sameColorPair,swapColorPair} from "../src/color/color-pair.ts";
import {channelFields,parseChannel,parseOpacityPercent,readChannels,writeChannel} from "../src/color/channel-fields.ts";
import {checkerColumns,hueSegments,mixRgba,saturationAtRing,saturationLayerAlphas,trackSegments} from "../src/color/segments.ts";

const close=(a,b,eps=1e-9,msg)=>assert.ok(Math.abs(a-b)<=eps,msg??`${a} != ${b}`);
const colorDir=new URL("../src/color/",import.meta.url);

test("HSV and HSL convert exactly in both directions and keep hue at gray",()=>{
  for(let h=0;h<360;h+=17)for(const s of [0,0.13,0.5,0.99,1])for(const v of [0,0.2,0.5,0.8,1]){
    const hsv={h,s,v,alpha:0.4};
    const hsl=hsvToHsl(hsv);
    assertHsl(hsl);
    const back=hslToHsv(hsl);
    assert.equal(back.h,h);
    close(back.v,v,1e-12);
    // HSV saturation is undefined at black; everywhere else it survives.
    if(v>0)close(back.s,s,1e-12,`s ${h}/${s}/${v}`);
  }
  assert.deepEqual(hsvToHsl({h:200,s:0,v:1,alpha:1}),{h:200,s:0,l:1,alpha:1});
  assert.deepEqual(hsvToHsl({h:200,s:1,v:0,alpha:1}),{h:200,s:0,l:0,alpha:1});
  assert.equal(rgbToHsl({r:128,g:128,b:128,alpha:1},217).h,217);
  assert.deepEqual(hslToRgb({h:0,s:1,l:0.5,alpha:1}),{r:255,g:0,b:0,alpha:1});
  assert.deepEqual(hslToRgb({h:120,s:1,l:0.25,alpha:1}),{r:0,g:128,b:0,alpha:1});
  const hsl=rgbToHsl({r:30,g:87,b:210,alpha:1});
  assert.deepEqual(hslToRgb(hsl),{r:30,g:87,b:210,alpha:1});
  assert.throws(()=>assertHsl({h:0,s:1.2,l:0.5,alpha:1}),/lightness/);
  assert.throws(()=>hslToHsv({h:Number.NaN,s:0,l:0,alpha:1}));
});

test("WCAG contrast matches reference values and composites translucent text",()=>{
  const black={r:0,g:0,b:0,alpha:1},white={r:255,g:255,b:255,alpha:1};
  close(relativeLuminance(white),1);
  close(relativeLuminance(black),0);
  close(contrastRatio(black,white),21);
  close(contrastRatio(white,black),21);
  // #767676 is the lightest gray that passes 4.5:1 on white; #777777 fails.
  const gray76={r:0x76,g:0x76,b:0x76,alpha:1},gray77={r:0x77,g:0x77,b:0x77,alpha:1};
  assert.equal(contrastRating(gray76,white).aa,true);
  assert.equal(contrastRating(gray77,white).aa,false);
  assert.equal(contrastRating(gray77,white).aaLarge,true);
  assert.equal(contrastRating(gray77,white).ratio,4.47);
  // The displayed ratio rounds down so a failing value never reads as 4.50.
  const r=contrastRating(gray77,white);
  assert.ok(r.ratio<4.5);
  assert.deepEqual(compositeOver({r:0,g:0,b:0,alpha:0.5},white),{r:128,g:128,b:128,alpha:1});
  close(contrastRatio({...black,alpha:0},white),1);
  assert.equal(contrastRating(black,white).aaa,true);
});

test("harmonies rotate hue only and wrap",()=>{
  const base={h:350,s:0.6,v:0.7,alpha:0.5};
  assert.deepEqual(harmonyColors(base,"complementary").map(c=>c.h),[350,170]);
  assert.deepEqual(harmonyColors(base,"analogous").map(c=>c.h),[350,320,20]);
  assert.deepEqual(harmonyColors(base,"triadic").map(c=>c.h),[350,110,230]);
  assert.deepEqual(harmonyColors(base,"split-complementary").map(c=>c.h),[350,140,200]);
  assert.deepEqual(harmonyColors(base,"square").map(c=>c.h),[350,80,170,260]);
  for(const k of HARMONY_KINDS)for(const c of harmonyColors(base,k.kind)){
    assert.equal(c.s,0.6);assert.equal(c.v,0.7);assert.equal(c.alpha,0.5);
  }
  assert.throws(()=>harmonyColors(base,"pentagon"),/Unknown/);
});

const box={width:200,height:200};
test("polar angles run anticlockwise from 3 o'clock and invert",()=>{
  close(toPolar({x:200,y:100},box).angle,0);
  close(toPolar({x:100,y:0},box).angle,90);
  close(toPolar({x:0,y:100},box).angle,180);
  close(toPolar({x:100,y:200},box).angle,270);
  for(let a=0;a<360;a+=7.5){
    const p=fromPolar(a,63,box);
    const back=toPolar(p,box);
    close(back.angle,a,1e-9);close(back.distance,63,1e-9);
  }
  assert.equal(toPolar({x:100,y:100},{width:300,height:200}).radius,100);
  assert.throws(()=>toPolar({x:Number.NaN,y:0},box),/finite/);
  assert.throws(()=>toPolar({x:0,y:0},{width:0,height:10}),/positive/);
});

test("ring hit test splits halfway between the disc and the ring",()=>{
  const r=100,disc=0.5,split=r*(disc+RING_INNER_FRACTION)/2;
  assert.equal(isOnRing(split+0.01,r,disc),true);
  assert.equal(isOnRing(split-0.01,r,disc),false);
  close(RING_INNER_FRACTION,124/182);
});

test("disc maps angle to hue, radius to saturation, clamps and retains hue near gray",()=>{
  const current={h:217,s:0.4,v:0.6,alpha:0.8};
  const edge=discPointToHsv({x:200,y:100},box,current);
  assert.deepEqual(edge,{h:0,s:1,v:0.6,alpha:0.8});
  const far=discPointToHsv({x:100,y:-500},box,current);
  close(far.h,90);assert.equal(far.s,1);
  const center=discPointToHsv({x:100,y:100},box,current);
  assert.deepEqual(center,{h:217,s:0,v:0.6,alpha:0.8});
  const nearly=discPointToHsv({x:100+HUE_RETAIN_RADIUS*0.9,y:100},box,current);
  assert.equal(nearly.h,217);
  for(const c of [{h:10,s:0.3,v:1,alpha:1},{h:200,s:1,v:0.2,alpha:1},{h:359,s:0.75,v:0.5,alpha:1}]){
    const back=discPointToHsv(hsvToDiscPoint(c,box),box,c);
    close(back.h,c.h,1e-9);close(back.s,c.s,1e-12);
  }
  const ring=hueToRingPoint(90,box);
  close(ring.x,100);close(ring.y,100-100*(1+RING_INNER_FRACTION)/2);
});

test("ring drag jumps on the ring, then tracks relatively with a fine zone",()=>{
  close(angleDelta(350,10),20);close(angleDelta(10,350),-20);close(angleDelta(0,180),180);
  const drag=createRingDrag();
  const outer=a=>fromPolar(a,95,box);
  const inner=a=>fromPolar(a,20,box);
  let s=drag.begin(outer(40),box,300);
  close(s.hue,40);assert.equal(s.fine,false);
  s=drag.move(outer(60),box);close(s.hue,60);
  s=drag.move(outer(-10),box);close(s.hue,350);
  // Slide inward without changing angle: no jump.
  s=drag.move(inner(-10),box);close(s.hue,350);assert.equal(s.fine,true);
  s=drag.move(inner(40),box);close(s.hue,350+50*FINE_HUE_RATE-360);
  // Back out: relative again, from where the hue got to.
  s=drag.move(outer(40),box);close(s.hue,0);assert.equal(s.fine,false);
  s=drag.move(outer(50),box);close(s.hue,10);
  // Starting in the hole never jumps.
  const d2=createRingDrag();
  s=d2.begin(inner(180),box,123);assert.equal(s.hue,123);assert.equal(s.fine,true);
  // Crossing the exact center holds the hue.
  s=d2.move({x:100,y:100},box);assert.equal(s.hue,123);
});

test("floating palette undocks past 30 units and stays in bounds and off the hinge",()=>{
  assert.equal(UNDOCK_DISTANCE,30);assert.equal(FLOATING_PALETTE_WIDTH,260);
  assert.equal(shouldUndock(18,24),false);
  assert.equal(shouldUndock(18,24.1),true);
  assert.deepEqual(positionFromGrab({x:300,y:50},{x:130,y:8}),{x:170,y:42});
  const size={width:260,height:300};
  const bounds={x:0,y:0,width:1080,height:800};
  assert.deepEqual(placeFloatingPalette({x:-40,y:900},size,bounds),{position:{x:0,y:500},overlapsObstacle:false});
  // Surface Duo-style vertical hinge at x 540..560: a palette crossing it moves to the nearer side.
  const hinge={x:540,y:0,width:20,height:800};
  const left=placeFloatingPalette({x:400,y:100},size,bounds,[hinge]);
  assert.deepEqual(left,{position:{x:280,y:100},overlapsObstacle:false});
  const right=placeFloatingPalette({x:480,y:100},size,bounds,[hinge]);
  assert.deepEqual(right,{position:{x:560,y:100},overlapsObstacle:false});
  // Restoring a position saved on the far side of a posture change.
  const restored=placeFloatingPalette({x:2000,y:40},size,bounds,[hinge]);
  assert.deepEqual(restored.position,{x:820,y:40});
  // Too small to clear the hinge: report it instead of hiding the palette.
  const tiny=placeFloatingPalette({x:0,y:0},size,{x:0,y:0,width:300,height:300},[{x:100,y:0,width:20,height:300}]);
  assert.equal(tiny.overlapsObstacle,true);
  // Horizontal fold (tabletop): move above or below.
  const fold={x:0,y:390,width:1080,height:20};
  assert.deepEqual(placeFloatingPalette({x:100,y:300},size,bounds,[fold]).position,{x:100,y:410});
  assert.deepEqual(placeFloatingPalette({x:100,y:200},size,bounds,[fold]).position,{x:100,y:90});
  assert.throws(()=>placeFloatingPalette({x:Number.NaN,y:0},size,bounds),/finite/);
  assert.deepEqual(nudgePalette({x:10,y:10},"ArrowLeft"),{x:2,y:10});
  assert.deepEqual(nudgePalette({x:10,y:10},"PageDown"),{x:10,y:42});
  assert.equal(nudgePalette({x:10,y:10},"a"),undefined);
});

const red={r:255,g:0,b:0,alpha:1},ocean={r:0x1f,g:0x5f,b:0xd1,alpha:1};
const groups=[
  {id:"recent",label:"Recent",kind:"recent",swatches:[{id:"r1",color:red}]},
  {id:"doc",label:"Document",kind:"document",swatches:[]},
  {id:"named",label:"Named",kind:"named",swatches:[{id:"o",color:ocean,name:"Ocean blue"},{id:"r",color:red,name:"Signal red"}]},
];
test("swatch search matches names and hex prefixes and drops empty groups",()=>{
  assert.equal(filterSwatchGroups(groups,"").length,3);
  assert.equal(filterSwatchGroups(groups,"   ").length,3);
  const ocean1=filterSwatchGroups(groups,"OCEAN");
  assert.deepEqual(ocean1.map(g=>g.id),["named"]);
  assert.deepEqual(ocean1[0].swatches.map(s=>s.id),["o"]);
  assert.deepEqual(filterSwatchGroups(groups,"#ff00").map(g=>g.swatches.length),[1,1]);
  assert.deepEqual(filterSwatchGroups(groups,"1f5f").map(g=>g.id),["named"]);
  assert.deepEqual(filterSwatchGroups(groups,"zzz"),[]);
  // "red" is a name match, not a hex query.
  assert.deepEqual(filterSwatchGroups(groups,"red").map(g=>g.id),["named"]);
  assert.equal(swatchKey(groups[2].swatches[0]),"#1F5FD1FF");
});

test("recent swatches dedupe by hex, newest first, and cap",()=>{
  let recent=[];
  for(const c of [red,ocean,red,{...red,alpha:0.5}])recent=pushRecentSwatch(recent,c,3);
  assert.deepEqual(recent.map(s=>s.id),["#FF000080","#FF0000FF","#1F5FD1FF"]);
  recent=pushRecentSwatch(recent,{r:1,g:2,b:3,alpha:1},3);
  assert.equal(recent.length,3);
  assert.equal(recent[0].id,"#010203FF");
  assert.throws(()=>pushRecentSwatch([],red,0),/limit/);
});

test("swatch grid keyboard moves in rows, flips under RTL and clamps",()=>{
  assert.equal(swatchColumns(0),1);
  assert.equal(swatchColumns(44),1);
  assert.equal(swatchColumns(94),2);
  assert.equal(swatchColumns(358),7);
  assert.equal(swatchGridMove(0,"ArrowRight",4,10),1);
  assert.equal(swatchGridMove(0,"ArrowRight",4,10,true),0);
  assert.equal(swatchGridMove(3,"ArrowLeft",4,10,true),4);
  assert.equal(swatchGridMove(1,"ArrowDown",4,10),5);
  assert.equal(swatchGridMove(7,"ArrowDown",4,10),7);
  assert.equal(swatchGridMove(5,"ArrowUp",4,10),1);
  assert.equal(swatchGridMove(5,"Home",4,10),0);
  assert.equal(swatchGridMove(5,"End",4,10),9);
  assert.equal(swatchGridMove(9,"ArrowRight",4,10),9);
  assert.equal(swatchGridMove(0,"Enter",4,10),undefined);
  assert.equal(swatchGridMove(0,"ArrowRight",4,0),undefined);
});

test("foreground/background swap twice is identity; defaults are black on white",()=>{
  const pair={foreground:ocean,background:{...red,alpha:0.5}};
  assert.deepEqual(swapColorPair(swapColorPair(pair)),pair);
  assert.deepEqual(swapColorPair(pair).foreground,pair.background);
  assert.equal(sameColorPair(DEFAULT_COLOR_PAIR,{foreground:{r:0,g:0,b:0,alpha:1},background:{r:255,g:255,b:255,alpha:1}}),true);
  assert.equal(sameColorPair(pair,DEFAULT_COLOR_PAIR),false);
  assert.throws(()=>swapColorPair({foreground:{r:999,g:0,b:0,alpha:1},background:red}),/RGB/);
});

test("channel fields read rounded values and write one channel without drifting the others",()=>{
  const v={h:217.4,s:0.4321,v:0.6789,alpha:0.5};
  assert.deepEqual(readChannels(v,"hsv"),[217,43,68]);
  assert.deepEqual(readChannels({...v,h:359.7},"hsv")[0],0);
  assert.deepEqual(readChannels(v,"rgb"),Object.values(hsvToRgb(v)).slice(0,3));
  const hsl=hsvToHsl(v);
  assert.deepEqual(readChannels(v,"hsl"),[217,Math.round(hsl.s*100),Math.round(hsl.l*100)]);
  // HSV: setting brightness keeps exact h and s.
  assert.deepEqual(writeChannel(v,"hsv",2,50),{...v,v:0.5});
  // HSL: setting lightness keeps hue exactly and HSL saturation within float error.
  const w=writeChannel(v,"hsl",2,30);
  assert.equal(w.h,217.4);
  close(hsvToHsl(w).s,hsl.s,1e-12);close(hsvToHsl(w).l,0.3,1e-12);
  // HSL lightness 100 is white; hue must survive it.
  const white=writeChannel(v,"hsl",2,100);
  assert.equal(white.h,217.4);assert.equal(white.v,1);
  // RGB: alpha and hue survive an edit through gray.
  const gray=writeChannel({h:200,s:0,v:0.5,alpha:0.3},"rgb",0,hsvToRgb({h:200,s:0,v:0.5,alpha:1}).r);
  assert.equal(gray.h,200);assert.equal(gray.alpha,0.3);
  const redder=writeChannel(v,"rgb",0,255);
  assert.equal(hsvToRgb(redder).r,255);
  assert.equal(hsvToRgb(redder).g,hsvToRgb(v).g);
  assert.equal(channelFields("hsl")[2].label,"Lightness");
  assert.equal(parseChannel("255",255),255);
  assert.equal(parseChannel(" 42% ",100),42);
  assert.equal(parseChannel("120°",359),120);
  assert.equal(parseChannel("256",255),undefined);
  assert.equal(parseChannel("-1",255),undefined);
  assert.equal(parseChannel("1.5",255),undefined);
  assert.equal(parseChannel("",255),undefined);
  assert.equal(parseOpacityPercent("40"),40);
  assert.equal(parseOpacityPercent("12.5%"),12.5);
  assert.equal(parseOpacityPercent("101"),undefined);
  assert.equal(parseOpacityPercent("abc"),undefined);
});

test("segment gradients sample stop interpolation at segment centers",()=>{
  assert.deepEqual(mixRgba(red,{r:0,g:0,b:255,alpha:0},0.5),{r:128,g:0,b:128,alpha:0.5});
  const seg=trackSegments([{r:0,g:0,b:0,alpha:1},{r:255,g:255,b:255,alpha:1}],4);
  assert.deepEqual(seg,["#202020FF","#606060FF","#9F9F9FFF","#DFDFDFFF"]);
  assert.equal(trackSegments([red,ocean,red],24).length,24);
  assert.throws(()=>trackSegments([red],4),/two stops/);
  assert.throws(()=>trackSegments([red,red],0),/1..512/);
  const hues=hueSegments(6);
  assert.deepEqual(hues.map(h=>h.angle),[30,90,150,210,270,330]);
  assert.equal(hues[0].color,rgbaToHex(hsvToRgb({h:30,s:1,v:1,alpha:1}),false));
  assert.equal(checkerColumns(0),0);assert.equal(checkerColumns(15),3);
});

test("saturation layers make white fall off linearly with radius",()=>{
  for(const layers of [2,8,24]){
    const alphas=saturationLayerAlphas(layers);
    assert.equal(alphas.length,layers);
    for(const a of alphas)assert.ok(a>=0&&a<=1,String(a));
    for(let j=1;j<=layers;j++)close(saturationAtRing(alphas,j),1-(j-0.5)/layers,1e-12,`ring ${j}/${layers}`);
  }
  assert.throws(()=>saturationLayerAlphas(1),/2..64/);
});

test("color cluster sources use tokens, no hex literals and no engine imports",()=>{
  const files=readdirSync(colorDir).filter(f=>/\.(ts|tsx)$/.test(f));
  for(const f of files){
    const text=readFileSync(new URL(f,colorDir),"utf8");
    assert.equal(text.match(/["'`]#[0-9A-Fa-f]{3,8}["'`]/g),null,f);
    assert.ok(!/from\s+["'](?:@nitro-forge\/|@acme\/|@expo\/ui|expo-linear-gradient|@shopify\/react-native-skia)/.test(text)||
      ["HsvPicker.tsx"].includes(f),f);
    if(f.endsWith(".tsx")&&f!=="HsvPicker.tsx")assert.ok(!/useState\b/.test(text),f+" uses useState");
  }
});

test("ported color files carry the pinned ProCraft notice",()=>{
  for(const f of ["wheel-geometry.ts","floating-palette.ts"]){
    const text=readFileSync(new URL(f,colorDir),"utf8");
    assert.match(text,/c2f7518d03141c746a365f90d8df05a44ddef002/);
    assert.match(text,/Copyright \(c\) 2026 ArtCraft Team and the ProCraft contributors/);
    assert.match(text,/MIT License or the Apache License, Version 2\.0/);
    assert.match(text,/Modified for NYC-Tron UI on 2026-11-05/);
  }
  for(const f of ["ProCraft-LICENSE-MIT.txt","ProCraft-LICENSE-APACHE.txt","ProCraft-NOTICE.txt"])
    assert.ok(readFileSync(new URL("../licenses/"+f,import.meta.url),"utf8").length>500,f);
});
