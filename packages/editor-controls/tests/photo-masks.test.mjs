import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PHOTO_BRUSH_POINTS,photoBrushPoint,validatePhotoBrush,validatePhotoBrushPoints,validatePhotoGradient,photoGradientCoverage,validatePhotoRange} from '../src/photo/photo-masks.ts';
test('brush mapping preserves source-independent normalized points and known/unknown pressure',()=>{
 assert.deepEqual(photoBrushPoint(50,25,100,50,.4),{x:.5,y:.5,pressure:.4});assert.deepEqual(photoBrushPoint(-10,90,100,50),{x:0,y:1,pressure:null});assert.equal(photoBrushPoint(1,1,10,10,0).pressure,0);assert.throws(()=>photoBrushPoint(1,1,0,20));
 validatePhotoBrush({radius:24,feather:.5,flow:.8});assert.throws(()=>validatePhotoBrush({radius:4097,feather:0,flow:1}));assert.throws(()=>validatePhotoBrush({radius:1,feather:NaN,flow:1}));assert.throws(()=>validatePhotoBrushPoints([]));assert.throws(()=>validatePhotoBrushPoints(Array(MAX_PHOTO_BRUSH_POINTS+1).fill({x:0,y:0,pressure:null})));
});
test('linear and radial coverage respect feather and inversion at reference points',()=>{
 const size={width:100,height:100},linear={geometry:{type:'linear',x0:0,y0:50,x1:100,y1:50},feather:1,invert:false,combine:'replace'};validatePhotoGradient(linear,size);assert.equal(photoGradientCoverage(linear,0,50),0);assert.equal(photoGradientCoverage(linear,50,50),.5);assert.equal(photoGradientCoverage(linear,100,50),1);assert.equal(photoGradientCoverage({...linear,invert:true},100,50),0);assert.equal(photoGradientCoverage({...linear,feather:0},49,50),0);assert.equal(photoGradientCoverage({...linear,feather:0},51,50),1);
 const radial={...linear,geometry:{type:'radial',cx:50,cy:50,radius:40}};validatePhotoGradient(radial,size);assert.equal(photoGradientCoverage(radial,50,50),1);assert.equal(photoGradientCoverage(radial,90,50),0);assert.equal(photoGradientCoverage(radial,70,50),.5);assert.throws(()=>validatePhotoGradient({...linear,geometry:{...linear.geometry,x1:0}},size));
});
test('color ranges retain floating profile channels and reject crossed or unbounded samples',()=>{
 const color={profileId:'linear-display-p3',channels:[-.25,1.5,.2],alpha:.8,preview:{r:0,g:255,b:80,alpha:.8}};const value={mode:'color',minimum:0,maximum:1,color,tolerance:.1,softness:.2,combine:'intersect',invert:false};validatePhotoRange(value);assert.deepEqual(value.color.channels,[-.25,1.5,.2]);assert.throws(()=>validatePhotoRange({...value,minimum:.9,maximum:.1}));assert.throws(()=>validatePhotoRange({...value,color:{...color,channels:[NaN]}}));
});
