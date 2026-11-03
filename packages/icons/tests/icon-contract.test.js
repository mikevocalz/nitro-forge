import test from "node:test";
import assert from "node:assert/strict";
import {iconGroups,iconIds,searchIcons,iconsInCategory,hasIconId} from "../src/catalog.js";
import {glyphIds,getGlyph} from "../src/glyphs.js";
import {resolveIconState,riveIconInputs} from "../src/state.js";
test("suite inventory spans office, drawing, media and XR tools",()=>{
 assert.ok(Object.keys(iconGroups).length>=20);
 assert.ok(iconIds.length>=1000);
 assert.equal(new Set(iconIds).size,iconIds.length);
 for(const id of ["paint/eraser","paint/highlighter","slides/slide-master",
   "spreadsheet/pivot-table","pdf/pdf-redact","video/speed-ramp",
   "audio/piano-roll","spatial/pen-pair","accessibility/reduced-motion"])
   assert.equal(hasIconId(id),true,id);
 assert.ok(searchIcons("pressure").length>0);
 assert.ok(iconsInCategory("typography").length>40);
});
test("first authored glyphs have explicit outline and filled variants",()=>{
 assert.ok(glyphIds.length>=35);
 for(const id of glyphIds){
   for(const variant of ["outline","filled"]){
     const paths=getGlyph(id,variant);
     assert.ok(paths?.length>0,id+" "+variant);
     for(const p of paths){
       assert.equal(p.length,2);
       assert.ok(typeof p[0]==="string"&&p[0].startsWith("M")||p[0]?.startsWith("m"),id);
       assert.ok(["stroke","fill","knockout"].includes(p[1]));
     }
   }
 }
 assert.equal(getGlyph("charts/chart-funnel"),undefined);
});
test("inactive always outline, selected always filled; reduced motion still filled",()=>{
 assert.equal(resolveIconState().variant,"outline");
 assert.equal(resolveIconState({selected:true}).variant,"filled");
 assert.equal(resolveIconState({selected:true,reducedMotion:true}).animated,false);
 assert.equal(resolveIconState({selected:true,reducedMotion:true}).variant,"filled");
 assert.equal(resolveIconState({disabled:true,selected:true}).opacity,0.52);
 assert.equal(resolveIconState({appearance:"dark"}).color,"#F8FAFC");
 assert.equal(resolveIconState({selected:true,selectedColor:"#123ABC"}).color,"#123ABC");
 assert.equal(riveIconInputs({selected:true}).Selected,true);
 assert.equal(riveIconInputs({reducedMotion:true}).ReduceMotion,true);
 assert.throws(()=>resolveIconState({size:0}),RangeError);
});
