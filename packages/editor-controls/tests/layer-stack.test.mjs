import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {
 LAYER_THUMBNAIL_SIZE,LAYER_TOUCH_TARGET,dragTargetIndex,formatOpacity,layerAccessibilityLabel,layerDetail,
 layerKindLabel,moveLayer,normalizeOpacity,opacityFromDrag,removeLayer,resolveRename,stepOpacity,validateLayers,
} from "../src/layers/layer-model.ts";

const layers=[
 {id:"title",name:"Title",visible:true,opacity:1,kind:"text"},
 {id:"logo",name:"Logo",visible:false,opacity:0.4,kind:"vector",locked:true},
 {id:"photo",name:"Photo",visible:true,opacity:0.85,kind:"raster"},
];
const source=readFileSync(new URL("../src/layers/LayerStack.tsx",import.meta.url),"utf8");
const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));

test("layer validation rejects rows the stack cannot render honestly",()=>{
 assert.doesNotThrow(()=>validateLayers(layers));
 assert.throws(()=>validateLayers([...layers,layers[0]]),/Duplicate/);
 assert.throws(()=>validateLayers([{...layers[0],id:""}]),/Duplicate or empty/);
 assert.throws(()=>validateLayers([{...layers[0],name:"  "}]),/blank/);
 for(const opacity of [-0.1,1.01,Number.NaN])assert.throws(()=>validateLayers([{...layers[0],opacity}]),/0\.\.1/);
 for(const kind of ["mask","toString"])assert.throws(()=>validateLayers([{...layers[0],kind}]),/kind/);
});
test("opacity math clamps, steps and drags in whole percent",()=>{
 assert.equal(normalizeOpacity(1.4),1);
 assert.equal(normalizeOpacity(-1),0);
 assert.equal(normalizeOpacity(0.333),0.33);
 assert.equal(stepOpacity(0.4,1),0.45);
 assert.equal(stepOpacity(0.02,-1),0);
 assert.equal(stepOpacity(1,1),1);
 assert.equal(opacityFromDrag(0.5,50,100),1);
 assert.equal(opacityFromDrag(0.5,-25,100),0.25);
 assert.equal(opacityFromDrag(0.5,22,0),1,"zero-width track falls back to the touch target width");
 assert.equal(formatOpacity(0.854),"85%");
 assert.throws(()=>opacityFromDrag(0.5,Number.NaN,100),RangeError);
});
test("drag targets and moves treat index 0 as the top layer",()=>{
 assert.equal(dragTargetIndex(2,-112,56,3),0);
 assert.equal(dragTargetIndex(0,20,56,3),0,"under half a row stays put");
 assert.equal(dragTargetIndex(0,30,56,3),1);
 assert.equal(dragTargetIndex(0,9999,56,3),2);
 assert.throws(()=>dragTargetIndex(3,0,56,3),RangeError);
 assert.deepEqual(moveLayer(layers,"photo",0).map(l=>l.id),["photo","title","logo"]);
 assert.deepEqual(moveLayer(layers,"title",2).map(l=>l.id),["logo","photo","title"]);
 assert.deepEqual(layers.map(l=>l.id),["title","logo","photo"],"input is not mutated");
 assert.throws(()=>moveLayer(layers,"nope",0),/Unknown/);
 assert.throws(()=>moveLayer(layers,"title",3),/range/);
});
test("rename drops blank and unchanged drafts",()=>{
 assert.equal(resolveRename("Logo","  Logo mark "),"Logo mark");
 assert.equal(resolveRename("Logo","Logo"),undefined);
 assert.equal(resolveRename("Logo","   "),undefined);
});
test("screen-reader labels carry position, visibility, opacity and lock",()=>{
 assert.equal(layerAccessibilityLabel(layers[1],1,3),"Logo, Shape layer, 2 of 3, hidden, 40% opacity, locked");
 assert.equal(layerAccessibilityLabel(layers[0],0,3),"Title, Text layer, 1 of 3, visible, 100% opacity");
});
test("opacity drag previews live, commits once on release and restores on cancel",()=>{
 assert.equal(LAYER_TOUCH_TARGET,44);
 assert.match(source,/onPanResponderTerminate:cancelOpacity/);
 assert.match(source,/cancelPreview\(p\.layer\.opacity,/);
 assert.match(source,/onPanResponderRelease:\(\)=>\{\s*const current=store\.getState\(\)\.opacity;\s*if\(current\?\.id===latest\.current\.layer\.id\)void commitOpacity/);
 assert.equal(source.slice(source.indexOf("function LayerStackBody")).match(/onOpacityCommit\(/g)?.length,1,"one row commit site; the ownership wrapper delegates it");
 assert.match(source,/p\.onOpacityPreview\?\.\(p\.layer\.id,next\)/);
});
test("rows expose 44pt targets and screen-reader actions for every gesture",()=>{
 assert.match(source,/accessibilityRole="adjustable"/);
 assert.match(source,/\{name:"increment"\},\{name:"decrement"\}/);
 for(const action of ["moveUp","moveDown","rename","activate"])assert.match(source,new RegExp('name:"'+action+'"'));
 assert.match(source,/accessibilityRole="switch"/);
 assert.match(source,/onPanResponderTerminate:\(\)=>store\.setState\(\{drag:null\}\)/,"cancelled drag never reorders");
 assert.doesNotMatch(source,/#[0-9a-fA-F]{3,8}\b|rgba?\(/,"tokens only");
 assert.doesNotMatch(source,/from\s+["'](?:@nitro-forge\/|@acme\/|@reactvision\/)/);
});
test("kindLabel replaces the built-in kind label on screen and in the spoken label",()=>{
 const rect={...layers[1],kindLabel:"Rectangle",locked:false};
 assert.equal(layerDetail(rect),"Rectangle");
 assert.equal(layerDetail({kind:"raster",kindLabel:" Raster "}),"Raster","trimmed");
 assert.equal(layerDetail(layers[2]),layerKindLabel("raster"),"falls back to the kind");
 assert.equal(layerDetail(layers[1]),"Shape");
 assert.equal(layerAccessibilityLabel(rect,1,3),"Logo, Rectangle layer, 2 of 3, hidden, 40% opacity");
 assert.throws(()=>validateLayers([{...layers[0],kindLabel:"  "}]),/kindLabel is blank/);
 assert.doesNotThrow(()=>validateLayers([rect]));
});
test("thumbnails take a fill or a node, never both or neither, and speak only through the row",()=>{
 assert.equal(LAYER_THUMBNAIL_SIZE,28);
 assert.ok(LAYER_THUMBNAIL_SIZE<LAYER_TOUCH_TARGET,"thumbnail fits inside the 44pt row");
 const node={type:"View",props:{}};
 assert.doesNotThrow(()=>validateLayers([{...layers[0],thumbnail:{fill:"#e0402a"}}]));
 assert.doesNotThrow(()=>validateLayers([{...layers[0],thumbnail:{node,label:"skyline photo"}}]));
 assert.throws(()=>validateLayers([{...layers[0],thumbnail:{}}]),/exactly one/);
 assert.throws(()=>validateLayers([{...layers[0],thumbnail:{fill:"  "}}]),/exactly one/);
 assert.throws(()=>validateLayers([{...layers[0],thumbnail:{node:null}}]),/exactly one/);
 assert.throws(()=>validateLayers([{...layers[0],thumbnail:{fill:"red",node}}]),/exactly one/);
 assert.throws(()=>validateLayers([{...layers[0],thumbnail:{fill:"red",label:" "}}]),/label is blank/);
 assert.equal(layerAccessibilityLabel({...layers[2],thumbnail:{fill:"red",label:"red fill"}},2,3),
  "Photo, Pixel layer, red fill, 3 of 3, visible, 85% opacity");
 assert.equal(layerAccessibilityLabel({...layers[2],thumbnail:{fill:"red"}},2,3),
  "Photo, Pixel layer, 3 of 3, visible, 85% opacity","an unlabelled thumbnail is decorative");
});
test("removeLayer returns a new array without the row and rejects unknown ids",()=>{
 assert.deepEqual(removeLayer(layers,"logo").map(l=>l.id),["title","photo"]);
 assert.deepEqual(layers.map(l=>l.id),["title","logo","photo"],"input is not mutated");
 assert.throws(()=>removeLayer(layers,"nope"),/Unknown/);
});
test("remove is optional, confirm-free, and reachable by pointer, keyboard and screen reader",()=>{
 assert.match(source,/onRemove\?:\(id:string\)=>void\|Promise<unknown>/);
 assert.match(source,/\{props\.onRemove\?<Pressable accessibilityRole="button" accessibilityLabel=\{"Remove "\+layer\.name\}/);
 assert.match(source,/\.\.\.\(removable\?\[\{name:"remove",label:"Remove"\}\]:\[\]\)/);
 assert.match(source,/key!=="Delete"&&key!=="Backspace"/);
 assert.doesNotMatch(source,/Alert\.|Modal|confirm\(/,"no confirmation dialog");
});
// NYC-Tron shipped these as compiled .js/.d.ts targets; @nitro-forge/editor-controls
// exports the same subpaths without the components/forge prefix. Check that each
// target is a real file (a compiled one, or its .ts/.tsx source) and that native
// and web resolve to the same module.
test("layer subpaths ship explicit targets",()=>{
 const target=entry=>{
  const src=entry.replace("/dist/","/src/").replace(/\.d\.ts$|\.js$/,"");
  return [entry,src+".ts",src+".tsx"].some(p=>existsSync(new URL("../"+p,import.meta.url)));
 };
 for(const name of ["layers/LayerStack","layers/layer-model"]){
  const entry=pkg.exports["./"+name];
  assert.ok(entry,name);
  assert.ok(target(entry.default),name+" default");
  assert.equal(entry["react-native"],entry.default);
  assert.ok(target(entry.types),name+" types");
 }
});
