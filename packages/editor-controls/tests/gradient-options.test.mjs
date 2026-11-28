import test from 'node:test';import assert from 'node:assert/strict';
import {sampleGradient,validateGradientOptions,rotateGradient,changeGradientType} from '../src/color/gradient-options.ts';
const paint={type:'linear',x0:10,y0:20,x1:110,y1:20,stops:[{offset:0,color:[0,0,0,255]},{offset:1,color:[255,255,255,255]}]};
test('gradient midpoint identifies half the color transition and interpolation is explicit',()=>{
 const options={interpolation:'srgb',midpoints:[.25]};assert.deepEqual(sampleGradient(paint,options,.25),[128,128,128,255]);assert.equal(sampleGradient(paint,{...options,interpolation:'linear-rgb'},.25)[0],188);assert.throws(()=>validateGradientOptions(paint,{...options,midpoints:[]}),RangeError);assert.throws(()=>validateGradientOptions(paint,{...options,midpoints:[0]}),RangeError);
});
test('gradient alpha interpolation is premultiplied and coincident end stops remain valid',()=>{
 const p={...paint,stops:[{offset:0,color:[255,0,0,0]},{offset:1,color:[0,0,255,255]}]};assert.deepEqual(sampleGradient(p,{interpolation:'srgb',midpoints:[.5]},.5),[0,0,255,128]);
 assert.deepEqual(sampleGradient({...paint,stops:[...paint.stops,{offset:1,color:[255,0,0,255]}]},{interpolation:'srgb',midpoints:[.5,.5]},1),[255,0,0,255]);
});
test('gradient angle/type edits preserve origin, length and stop identity',()=>{
 const rotated=rotateGradient(paint,90);assert.ok(Math.abs(rotated.x1-10)<1e-9);assert.equal(rotated.y1,120);assert.equal(rotated.stops,paint.stops);
 const radial=changeGradientType(paint,'radial');assert.equal(radial.cx,10);assert.equal(radial.r,100);assert.equal(changeGradientType(radial,'linear').x1,110);
});
