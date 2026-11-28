import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {cancelPreview} from "../src/cancel-preview.ts";

test("cancel restores transient engine preview after clearing local gesture state",()=>{
 for(const value of [0.5,{x:0.2,y:0.7},{x:0.1,y:0.2,width:0.5,height:0.5}]){
  let active=true, local=null, engine="dragged";
  cancelPreview(value,next=>{active=false;local=next;},next=>{
   assert.equal(active,false);
   engine=next;
  });
  assert.equal(local,value);
  assert.equal(engine,value);
 }
});
test("cancel works without app preview and never requires a commit callback",()=>{
 let restored;
 cancelPreview(4,next=>{restored=next;});
 assert.equal(restored,4);
});
test("all gesture controls roll back previews and ignore release after termination",()=>{
 for(const file of ["inputs/InstrumentKnob.tsx","inputs/InstrumentXYPad.tsx","graphics/ImageCropOverlay.tsx"]){
  const source=readFileSync(new URL("../src/"+file,import.meta.url),"utf8");
  assert.match(source,/const cancel=\(\)=>cancelPreview\(/);
  if(file.startsWith("graphics/")){
   assert.match(source,/useEditorPan\(\{[^}]*onCancel:cancel/);
   assert.match(source,/onCancel=\{cancel\}/, "crop handles share the rollback callback");
  }else assert.match(source,/onPanResponderTerminate:cancel/);
  assert.match(source,/if\(store.getState\(\).active\)commit/);
 }
});
