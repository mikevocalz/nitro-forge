import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 LAYER_NAME_MIN_WIDTH,LAYER_OPACITY_READOUT_WIDTH,LAYER_OPACITY_SLIDER_WIDTH,layerOpacityMode,layerRowMinWidth,
} from "../src/layers/layer-model.ts";

// Gaps nitro-forge's Design Studio (#36) found on v0.1.0-alpha.2.
// The LayerStack half of those gaps; NYC-Tron's studio-gaps.test.mjs keeps
// the popover, option-group, Select and TabBar half.
const full={thumbnail:true,removable:true};

test("a row with thumbnail and remove keeps the slider only when it fits beside a 96pt name",()=>{
 // handle 44 + visibility 44 + thumbnail 32 + name 96 + slider 120 + remove 44
 assert.equal(layerRowMinWidth(full,"slider"),380);
 assert.equal(layerRowMinWidth(full,"readout"),44+44+32+LAYER_NAME_MIN_WIDTH+LAYER_OPACITY_READOUT_WIDTH+44);
 assert.ok(layerRowMinWidth(full,"readout")<=320,"the readout row fits the narrowest panel Forge docks");
 assert.equal(layerOpacityMode(320,full),"readout");
 assert.equal(layerOpacityMode(360,full),"readout");
 assert.equal(layerOpacityMode(379,full),"readout");
 assert.equal(layerOpacityMode(380,full),"slider");
 assert.equal(layerOpacityMode(390,full),"slider");
});
test("rows without a thumbnail or remove need less room before giving up the slider",()=>{
 const plain={thumbnail:false,removable:false};
 assert.equal(layerRowMinWidth(plain,"slider"),44+44+LAYER_NAME_MIN_WIDTH+LAYER_OPACITY_SLIDER_WIDTH);
 assert.equal(layerOpacityMode(320,plain),"slider");
 assert.equal(layerOpacityMode(300,plain),"readout");
});
test("an unmeasured stack keeps the slider it drew before layout",()=>{
 assert.equal(layerOpacityMode(undefined,full),"slider");
 assert.equal(layerOpacityMode(Number.NaN,full),"slider");
});
test("LayerStack switches presentation from its own measured width and keeps one commit path",()=>{
 const source=readFileSync(new URL("../src/layers/LayerStack.tsx",import.meta.url),"utf8");
 assert.match(source,/onLayout=\{e=>\{store\.setState\(\{width:e\.nativeEvent\.layout\.width\}\);onLayout\?\.\(e\);\}\}/);
 assert.match(source,/layerOpacityMode\(width,\{thumbnail:thumbnailSlot,removable:onRemove!==undefined\}\)/);
 assert.match(source,/<PrecisionScrubber label=\{layer\.name\+" opacity"\}/);
 assert.match(source,/onCommit=\{value=>commit\(value\/100\)\}/);
 assert.doesNotMatch(source,/useWindowDimensions|Dimensions\.get/,"the stack measures its pane, never the window");
});
