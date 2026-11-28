// Ported from Nitro Forge color-ui PR #34 (vitest) to node:test.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  alphaPercent,assertHsv,assertRgba,hsvToRgb,parseHexColor,rgbToHsv,rgbaEditToHsv,rgbaToHex,wrapHue,
} from "../src/color.ts";
import {hsvToPoint,pointToHsv} from "../src/color/fieldGeometry.ts";
import {createFieldGesture} from "../src/color/fieldGesture.ts";

const src=p=>readFileSync(new URL("../src/"+p,import.meta.url),"utf8");

test("hex parsing covers short and long rgb/rgba forms",()=>{
  assert.deepEqual(parseHexColor("#F0A"),{r:255,g:0,b:170,alpha:1});
  assert.equal(rgbaToHex({r:255,g:0,b:170,alpha:1}),"#FF00AAFF");
  assert.equal(rgbaToHex({r:255,g:0,b:170,alpha:1},false),"#FF00AA");
  assert.deepEqual(parseHexColor("f08c"),{r:255,g:0,b:136,alpha:204/255});
  assert.ok(Math.abs(parseHexColor("#33669980").alpha-128/255)<1e-9);
  assert.deepEqual(parseHexColor("  #102030  "),{r:16,g:32,b:48,alpha:1});
});
test("RGB channels round-trip through HSV",()=>{
  for(const c of [
    {r:255,g:0,b:0,alpha:1},{r:0,g:255,b:0,alpha:0.6},{r:0,g:0,b:255,alpha:0.25},
    {r:30,g:87,b:210,alpha:1},{r:255,g:0,b:128,alpha:1},{r:0,g:0,b:0,alpha:1},{r:255,g:255,b:255,alpha:1},
  ])assert.deepEqual(hsvToRgb(rgbToHsv(c)),c);
});
test("hue is retained at zero saturation and wrapped everywhere",()=>{
  assert.equal(rgbToHsv({r:128,g:128,b:128,alpha:1},217).h,217);
  assert.equal(rgbToHsv({r:128,g:128,b:128,alpha:1},-90).h,270);
  const magenta=rgbToHsv({r:255,g:0,b:128,alpha:1}).h;
  assert.ok(magenta>=0&&magenta<360,String(magenta));
  assert.ok(Math.abs(magenta-329.88)<0.01,String(magenta));
  assert.equal(wrapHue(360),0);
  assert.equal(wrapHue(-30),330);
  assert.deepEqual(hsvToRgb({h:360,s:1,v:1,alpha:1}),hsvToRgb({h:0,s:1,v:1,alpha:1}));
  assert.deepEqual(hsvToRgb({h:-120,s:1,v:1,alpha:1}),{r:0,g:0,b:255,alpha:1});
});
test("invalid colors are rejected",()=>{
  assert.throws(()=>parseHexColor("#12345"),/Expected #RGB/);
  assert.throws(()=>assertRgba({r:-1,g:0,b:0,alpha:1}),/RGB/);
  assert.throws(()=>assertRgba({r:255,g:0,b:0,alpha:Infinity}),/Alpha/);
  assert.throws(()=>hsvToRgb({h:0,s:2,v:1,alpha:1}),/saturation/);
  assert.throws(()=>assertHsv({h:Number.NaN,s:0,v:0,alpha:1}),/finite/);
  assert.throws(()=>rgbToHsv({r:1,g:2,b:3,alpha:1},Infinity),/Hue/);
});
test("every whole opacity percent survives an 8-bit hex round trip",()=>{
  for(let percent=0;percent<=100;percent++){
    const color={r:10,g:20,b:30,alpha:percent/100};
    assert.equal(alphaPercent(color.alpha),percent);
    assert.equal(alphaPercent(parseHexColor(rgbaToHex(color)).alpha),percent);
  }
  assert.equal(rgbaToHex({r:0,g:0,b:0,alpha:0.01}),"#00000003");
  assert.equal(parseHexColor("#00000003").alpha,3/255);
  assert.throws(()=>alphaPercent(Number.NaN));
  assert.throws(()=>alphaPercent(1.5));
});

const white={h:240,s:0,v:1,alpha:1};
const size={width:300,height:200};
test("field maps corners and clamps to the drawable area",()=>{
  assert.deepEqual(pointToHsv({x:0,y:0},size,white),white);
  assert.deepEqual(pointToHsv({x:300,y:0},size,white),{h:240,s:1,v:1,alpha:1});
  assert.deepEqual(pointToHsv({x:300,y:200},size,white),{h:240,s:1,v:0,alpha:1});
  assert.deepEqual(pointToHsv({x:-50,y:400},size,white),{h:240,s:0,v:0,alpha:1});
});
test("field round-trips normalized xy and keeps hue and alpha",()=>{
  const hsv={h:327,s:0.35,v:0.63,alpha:0.4};
  const next=pointToHsv(hsvToPoint(hsv,size),size,hsv);
  assert.ok(Math.abs(next.s-hsv.s)<1e-9);
  assert.ok(Math.abs(next.v-hsv.v)<1e-9);
  assert.equal(next.alpha,0.4);
  assert.equal(next.h,327);
});
test("field rejects corrupt geometry",()=>{
  assert.throws(()=>pointToHsv({x:0,y:Number.NaN},size,white),/coordinates/);
  assert.throws(()=>pointToHsv({x:0,y:0},{width:0,height:10},white),/dimensions/);
  assert.throws(()=>hsvToPoint({...white,s:4},size),/saturation/);
});

function setup(width,height,disabled=false){
  let value={h:200,s:0.2,v:0.8,alpha:1};
  const changes=[];
  const gesture=createFieldGesture({
    getSize:()=>({width,height}),getValue:()=>value,getDisabled:()=>disabled,
    onChange:next=>{value=next;changes.push(next);},
  });
  return {gesture,changes,get value(){return value;}};
}
test("gesture ignores touches before the field is measured",()=>{
  const t=setup(0,0);
  assert.equal(t.gesture.shouldStart(),false);
  assert.doesNotThrow(()=>t.gesture.grant({x:10,y:10}));
  assert.doesNotThrow(()=>t.gesture.move({x:20,y:20}));
  assert.deepEqual(t.changes,[]);
});
test("gesture ignores input while disabled",()=>{
  const t=setup(200,100,true);
  assert.equal(t.gesture.shouldStart(),false);
  t.gesture.grant({x:10,y:10});
  t.gesture.move({x:20,y:20});
  assert.deepEqual(t.changes,[]);
});
test("gesture keeps the responder for the whole drag",()=>{
  const t=setup(200,100);
  assert.equal(t.gesture.shouldStart(),true);
  t.gesture.grant({x:100,y:50});
  assert.equal(t.gesture.terminationRequest(),false);
  t.gesture.release();
  assert.equal(t.gesture.terminationRequest(),true);
});
test("forced platform cancel restores the drag-start color",()=>{
  const t=setup(200,100);
  t.gesture.grant({x:100,y:50});
  t.gesture.move({x:200,y:0});
  assert.equal(t.value.s,1);
  assert.equal(t.value.v,1);
  t.gesture.terminate();
  assert.deepEqual(t.value,{h:200,s:0.2,v:0.8,alpha:1});
});
test("normal release keeps the last color",()=>{
  const t=setup(200,100);
  t.gesture.grant({x:0,y:100});
  t.gesture.release();
  t.gesture.terminate();
  assert.equal(t.value.s,0);
  assert.equal(t.value.v,0);
});

test("HsvPicker contract: shared math, controlled, accessible, motion-free",()=>{
  const picker=src("color/HsvPicker.tsx");
  const channels=src("ColorChannels.tsx");
  assert.ok(!/from\s+["']@nitro-forge\//.test(picker+channels));
  // One color module: no second copy of the conversion math.
  for(const file of [picker,channels,src("color/fieldGeometry.ts"),src("color/fieldGesture.ts")]){
    assert.ok(!/function\s+(?:hsvToRgb|rgbToHsv|parseHexColor|rgbaToHex|assertHsv)\b/.test(file));
  }
  assert.match(picker,/from "\.\.\/color\.ts"/);
  assert.match(channels,/from "\.\/color\.ts"/);
  assert.match(picker,/<ColorChannels /);
  assert.ok(!/useState|useReducer|createStore/.test(picker),"picker must not own color state");
  for(const a of ["increment","decrement","increaseBrightness","decreaseBrightness","increaseHue","decreaseHue"])
    assert.ok(picker.includes(`name:"${a}"`),a);
  assert.match(picker,/minWidth:tokens\.spacing\.fixedTarget,minHeight:tokens\.spacing\.fixedTarget/);
  assert.ok(!/Animated|LayoutAnimation|react-native-reanimated|withTiming|withSpring/.test(picker),
    "picker introduces no animation");
  assert.ok(!/onPanResponderRelease:[^,]*onApply/.test(picker),"apply is explicit, never on release");
});

test("an opacity-only channel edit keeps hue, saturation and brightness exactly",()=>{
  for(const c of [{h:200.4,s:0.123,v:0.5,alpha:1},{h:120,s:0.8,v:0,alpha:1},{h:359.9,s:0.5,v:0.5,alpha:1}]){
    const next=rgbaEditToHsv({...hsvToRgb(c),alpha:0.25},c);
    assert.deepEqual(next,{...c,alpha:0.25});
  }
  const red=rgbaEditToHsv({r:255,g:0,b:0,alpha:1},{h:90,s:0.1,v:0.1,alpha:1});
  assert.equal(red.h,0);
  assert.equal(red.s,1);
});
test("rgbToHsv always reports hue in [0, 360)",()=>{
  for(let r=0;r<256;r+=15)for(let g=0;g<256;g+=15)for(let b=0;b<256;b+=15){
    const {h}=rgbToHsv({r,g,b,alpha:1});
    assert.ok(h>=0&&h<360,`${r},${g},${b} -> ${h}`);
  }
});
test("moves that land on the same color are not re-emitted",()=>{
  const t=setup(200,100);
  t.gesture.grant({x:100,y:50});
  t.gesture.move({x:100,y:50});
  t.gesture.move({x:100,y:50});
  t.gesture.move({x:150,y:50});
  assert.equal(t.changes.length,2);
});
