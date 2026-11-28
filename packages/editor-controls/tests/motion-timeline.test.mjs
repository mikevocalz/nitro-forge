import test from 'node:test';
import assert from 'node:assert/strict';
import {motionSelectionBounds,moveMotionSelection,validateMotionTimeline} from '../src/motion/motion-timeline.ts';
const key=(id,time)=>({id,time,value:0,interpolation:'linear',inHandle:null,outHandle:null});
const curve=(id,times)=>({id,label:id,minimum:-1,maximum:1,baseValue:0,keys:times.map((time,i)=>key(`${id}${i}`,time))});
test('cross-property selection moves atomically and stops at the strictest neighboring track',()=>{
 const curves=[curve('x',[0,1,2,3]),curve('y',[0,.5,2.5])],selection=[{propertyId:'x',keyId:'x1'},{propertyId:'x',keyId:'x2'},{propertyId:'y',keyId:'y1'}];validateMotionTimeline(curves,selection,4);assert.deepEqual(motionSelectionBounds(curves,selection,4,.25),[-.25,.75]);const moved=moveMotionSelection(curves,selection,selection[0],20,4,.25);assert.equal(moved[0].keys[1].time,1.75);assert.equal(moved[0].keys[2].time,2.75);assert.equal(moved[1].keys[1].time,1.25);assert.equal(curves[0].keys[1].time,1);
});
test('group snapping uses the grabbed key while preserving off-grid relative offsets',()=>{
 const curves=[curve('x',[.1,1.1]),curve('y',[.2,2.2])],selection=[{propertyId:'x',keyId:'x0'},{propertyId:'y',keyId:'y0'}];const moved=moveMotionSelection(curves,selection,selection[1],.32,4,.25);assert.ok(Math.abs(moved[0].keys[0].time-.4)<1e-12);assert.equal(moved[1].keys[0].time,.5);assert.throws(()=>validateMotionTimeline(curves,[selection[0],selection[0]],4));assert.throws(()=>moveMotionSelection(curves,selection,{propertyId:'x',keyId:'x1'},1,4));
});
