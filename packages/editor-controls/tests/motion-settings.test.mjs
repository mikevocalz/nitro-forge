import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultMotionTransform,validateMotionTransform,validateMotionCamera,validateMotionMatte,validateMotionParticles,validateMotionLight} from '../src/motion/motion-settings.ts';
test('3D transforms preserve spins and mirrored/zero scale without changing unrelated axes',()=>{
 const v=defaultMotionTransform();v.rotation.z=720;v.scale.x=-1;v.scale.y=0;validateMotionTransform(v);assert.equal(v.rotation.z,720);assert.equal(v.position.z,0);assert.throws(()=>validateMotionTransform({...v,opacity:1.01}));assert.throws(()=>validateMotionTransform({...v,rotation:{x:NaN,y:0,z:0}}));
});
test('camera projection depth and physical lens bounds reject degenerate views',()=>{
 const v={position:{x:0,y:0,z:10},target:{x:0,y:0,z:0},projection:'perspective',focalLengthMm:50,sensorWidthMm:36,near:.1,far:10000,orthographicSize:10,depthOfField:false,focusDistance:10,aperture:2.8};validateMotionCamera(v);assert.throws(()=>validateMotionCamera({...v,target:v.position}),/differ/);assert.throws(()=>validateMotionCamera({...v,far:.05}));assert.throws(()=>validateMotionCamera({...v,aperture:0}));
});
test('matte selection and deterministic particle settings preserve exact identities',()=>{
 validateMotionMatte({sourceId:'nested-comp',mode:'luma-inverted',enabled:true,feather:12});assert.throws(()=>validateMotionMatte({sourceId:null,mode:'alpha',enabled:true,feather:0}));
 const emitter={enabled:true,rate:100,lifetime:3,speed:20,spreadDegrees:90,gravity:{x:0,y:9.8,z:0},seed:4294967295,textureId:'spark-v2',size:4,opacity:1};validateMotionParticles(emitter);assert.throws(()=>validateMotionParticles({...emitter,seed:4294967296}));assert.throws(()=>validateMotionParticles({...emitter,lifetime:0}));
 const light={type:'point',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},intensity:4,colorProfileId:'acescg-linear',color:[1.5,.2,.1],coneDegrees:45,castsShadows:true};validateMotionLight(light);assert.equal(light.color[0],1.5);assert.throws(()=>validateMotionLight({...light,colorProfileId:''}));
});
