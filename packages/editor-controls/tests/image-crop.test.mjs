import test from "node:test";
import assert from "node:assert/strict";
import {validateCrop,moveCrop,resizeCrop,cropToPixels} from "../src/graphics/crop.ts";
test("native crop rect moves and clamps without resizing",()=>{
 const r={x:.2,y:.3,width:.4,height:.5};
 assert.deepEqual(moveCrop(r,.1,-.2),{x:.30000000000000004,y:.09999999999999998,width:.4,height:.5});
 const near={x:.8,y:.8,width:.2,height:.2};
 assert.deepEqual(moveCrop(near,1,1),near);
 assert.throws(()=>validateCrop({x:1,y:0,width:.2,height:.5}),/Invalid/);
});
test("resize handles keep nonzero rect inside visible image and produce engine pixel coords",()=>{
 const rect={x:.2,y:.2,width:.5,height:.5};
 const resized=resizeCrop(rect,"se",.1,.1);
 assert.equal(resized.x,.2);
 assert.equal(resized.y,.2);
 assert.ok(Math.abs(resized.width-.6)<1e-9);
 assert.ok(Math.abs(resized.height-.6)<1e-9);
 const clip=resizeCrop(rect,"nw",.9,.9);
 assert.ok(clip.width>=.025-1e-9 && clip.height>=.025-1e-9);
 assert.deepEqual(cropToPixels(rect,1000,800),{x:200,y:160,width:500,height:400});
 assert.throws(()=>cropToPixels(rect,0,800),/image size/);
});
