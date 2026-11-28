import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMotionCurve,evaluateMotionCurve,evaluateMotionVelocity,insertMotionKey,moveMotionKeys,removeMotionKeys,setMotionInterpolation,setMotionHandle,sampleMotionCurve} from '../src/motion/motion-curves.ts';
const key=(id,time,value,interpolation='linear')=>({id,time,value,interpolation,inHandle:null,outHandle:null});
const curve=()=>({id:'x',label:'Position X',minimum:-100,maximum:100,baseValue:10,keys:[key('a',0,0),key('b',1,10),key('c',2,0)]});
test('linear/hold values and velocities distinguish jumps from finite speed',()=>{
 const v=curve();validateMotionCurve(v);assert.equal(evaluateMotionCurve(v,.25),2.5);assert.equal(evaluateMotionVelocity(v,.25),10);assert.equal(evaluateMotionVelocity(v,1.5),-10);const held=setMotionInterpolation(v,'a','hold');assert.equal(evaluateMotionCurve(held,.99),0);assert.equal(evaluateMotionCurve(held,1),10);assert.equal(evaluateMotionVelocity(held,1),null);assert.equal(evaluateMotionCurve({...v,keys:[]},.5),10);
});
test('Bezier time inversion and exact subdivision preserve a nonuniform curve',()=>{
 let v=setMotionInterpolation(curve(),'a','bezier');v=setMotionHandle(v,'a','out',{time:.1,value:30});v=setMotionHandle(v,'b','in',{time:.9,value:-20});const before=Array.from({length:41},(_,i)=>evaluateMotionCurve(v,i/40));const split=insertMotionKey(v,.37,'split');before.forEach((value,i)=>assert.ok(Math.abs(evaluateMotionCurve(split,i/40)-value)<1e-9));assert.equal(split.keys.find(k=>k.id==='split').time,.37);assert.ok(Number.isFinite(evaluateMotionVelocity(v,.5)));
});
test('vertical tangents have no fabricated finite velocity; reverse remap slopes stay negative',()=>{
 let v=setMotionInterpolation(curve(),'a','bezier');v=setMotionHandle(v,'a','out',{time:0,value:20});assert.equal(evaluateMotionVelocity(v,0),null);assert.equal(evaluateMotionVelocity(curve(),1.5),-10);const samples=sampleMotionCurve(v,[0,2],32,true);assert.equal(samples[0].value,null);assert.ok(samples.length<=288);
});
test('group moves retain spacing, stop before neighbors and preserve untouched source data',()=>{
 const v={...curve(),keys:[key('a',0,0),key('b',1,10),key('c',2,20),key('d',3,30)]};const moved=moveMotionKeys(v,['b','c'],10,0,4,.25);assert.equal(moved.keys[1].time,1.75);assert.equal(moved.keys[2].time,2.75);assert.equal(moved.keys[3].time,3);assert.equal(v.keys[1].time,1);assert.equal(moveMotionKeys(v,['b'],0,200).keys[1].value,100);assert.equal(removeMotionKeys(v,['a','b','c','d']).keys.length,0);
});
test('invalid ordering, duplicate identities and crossed temporal handles are rejected',()=>{
 const v=curve();assert.throws(()=>validateMotionCurve({...v,keys:[v.keys[0],v.keys[0]]}));assert.throws(()=>validateMotionCurve({...v,keys:[{...v.keys[0],outHandle:{time:1.1,value:0}},v.keys[1]]}));assert.throws(()=>insertMotionKey(v,1,'duplicate-time'));assert.throws(()=>moveMotionKeys(v,['missing'],1));
});
