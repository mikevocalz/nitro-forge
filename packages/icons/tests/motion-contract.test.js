import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolveIconState,riveIconInputs} from "../src/state.js";

test("state semantics cannot imply ready when no native proof exists",()=>{
 const idle=riveIconInputs({selected:false,status:"idle"});
 const success=riveIconInputs({status:"success"});
 assert.equal(idle.State,"idle");
 assert.equal(idle.Selected,false);
 assert.equal(success.State,"success");
 assert.equal(resolveIconState({selected:true}).variant,"filled");
 assert.equal(resolveIconState({selected:false}).variant,"outline");
 assert.equal(resolveIconState({reducedMotion:true,selected:true}).animated,false);
});
test("native/web module exposes accessible UI and Rive renderer adapter",()=>{
 const body=readFileSync(new URL("../src/ForgeIcon.js",import.meta.url),"utf8");
 for(const marker of [
  "export function ForgeIcon(", "export function ForgeIconButton(",
  "renderRive","useNativeDriver:true","accessibilityLabel:label",
  "reducedMotion","React.createElement(Pressable","getGlyph(name,\"outline\")"
 ])assert.ok(body.includes(marker),marker);
});
